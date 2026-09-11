-- 0010: 媒合通知修正與承運人資料鎖定
-- 2026-09-11 依 Tim 手機實測回饋。可重複執行。
--
-- 1. 逾時未回應 ≠ 拒絕：以前逾時（或帶著未回應的通知下線）會把承運人永久加進 declined_driver_ids，
--    之後這張單再也不會通知他 → 「符合條件卻沒顯示，要下線再上線」。現在逾時記在 expired_driver_ids，
--    媒合先排除「拒絕＋逾時」，找不到人時再給逾時者第二次機會（只排除明確拒絕）。
-- 2. 通知回應時間 15 → 30 秒。
-- 3. 審核通過後，承運人不能自己改級距、撥款帳戶、駕照、營業資格（要改請聯絡客服，由後台改）。
-- 4. 駕照加反面（職業駕照審驗紀錄在反面）。

alter table public.orders add column if not exists expired_driver_ids uuid[] not null default '{}';
alter table public.pricing_config alter column offer_timeout_seconds set default 30;
update public.pricing_config set offer_timeout_seconds = 30 where id = 1 and offer_timeout_seconds < 30;

-- ---------- dispatch：兩輪 ------------------------------------------------------
create or replace function public.dispatch_order(p_order uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  c public.pricing_config%rowtype;
  v_driver uuid;
  v_round int;
  v_found_round int := 0;   -- the FOR variable is loop-local in PL/pgSQL; copy it out
begin
  select * into o from public.orders where id = p_order for update;
  if o.status <> 'searching' then return o; end if;
  select * into c from public.pricing_config where id = 1;

  for v_round in 1..2 loop
    select d.id into v_driver
    from public.drivers d
    join public.vehicles v on v.driver_id = d.id and v.active
    left join public.driver_locations l on l.driver_id = d.id
    where d.online
      and not (d.id = any (o.declined_driver_ids))
      and (v_round = 2 or not (d.id = any (o.expired_driver_ids)))
      and v.class_id = o.class_id
      and (not o.need_tail_lift or v.has_tail_lift)
      and (not c.require_verification or (d.verification_status = 'verified' and v.verification_status = 'verified'))
      and not exists (select 1 from public.orders x where (x.driver_id = d.id or x.offered_driver_id = d.id)
                      and x.status in ('offered', 'accepted', 'arrived', 'in_transit', 'delivered'))
      and (l.driver_id is null or l.updated_at < now() - interval '15 minutes'
           or public.distance_km(l.lat, l.lng, o.pickup_lat, o.pickup_lng) <= c.service_radius_km)
    order by case when l.driver_id is not null and l.updated_at >= now() - interval '15 minutes' then 0 else 1 end,
             public.distance_km(coalesce(l.lat, o.pickup_lat), coalesce(l.lng, o.pickup_lng), o.pickup_lat, o.pickup_lng)
    limit 1;
    if v_driver is not null then v_found_round := v_round; exit; end if;
  end loop;

  if v_driver is null then return o; end if;

  update public.orders
     set status = 'offered', offered_driver_id = v_driver,
         offer_expires_at = now() + make_interval(secs => c.offer_timeout_seconds),
         -- second round: this driver gets a fresh chance, drop him from the expired list
         expired_driver_ids = array_remove(expired_driver_ids, v_driver)
   where id = p_order returning * into o;
  perform public.log_event(p_order, 'offered', null, null, null, jsonb_build_object('driver_id', v_driver, 'round', v_found_round));
  return o;
end $$;
revoke execute on function public.dispatch_order(uuid) from public, anon, authenticated;

-- ---------- poll：逾時記 expired，不是 declined ----------------------------------
create or replace function public.poll_order(p_order uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order
    and (customer_id = auth.uid() or public.is_admin()) for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status = 'offered' and o.offer_expires_at < now() then
    perform public.log_event(o.id, 'offer_expired', null, null, null, jsonb_build_object('driver_id', o.offered_driver_id));
    update public.orders set status = 'searching', expired_driver_ids = array_append(expired_driver_ids, offered_driver_id),
           offered_driver_id = null, offer_expires_at = null where id = o.id;
    return public.dispatch_order(o.id);
  elsif o.status = 'searching' then
    return public.dispatch_order(o.id);
  end if;
  return o;
end $$;

-- ---------- 下線時未回應的通知：也算逾時 ---------------------------------------
create or replace function public.driver_set_online(p_online boolean, p_lat double precision default null, p_lng double precision default null)
returns public.drivers language plpgsql security definer set search_path = public as $$
declare d public.drivers%rowtype; r record; c public.pricing_config%rowtype;
begin
  select * into d from public.drivers where profile_id = auth.uid() for update;
  if d.id is null then raise exception 'not a driver'; end if;
  select * into c from public.pricing_config where id = 1;
  if p_online and c.require_verification and d.onboarding_status <> 'approved' then
    raise exception '資格審核通過後才能上線接單（目前狀態：%）', d.onboarding_status;
  end if;
  update public.drivers set online = p_online where id = d.id returning * into d;
  if p_lat is not null and p_lng is not null then
    insert into public.driver_locations (driver_id, lat, lng) values (d.id, p_lat, p_lng)
    on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
  end if;
  if p_online then
    for r in select id from public.orders where status = 'searching' order by created_at loop
      perform public.dispatch_order(r.id);
    end loop;
  else
    update public.orders set status = 'searching', offered_driver_id = null, offer_expires_at = null,
           expired_driver_ids = array_append(expired_driver_ids, d.id)
     where offered_driver_id = d.id and status = 'offered';
  end if;
  return d;
end $$;

-- ---------- 審核通過後鎖定關鍵資料 ----------------------------------------------
create or replace function public.driver_set_vehicle_class(p_class text)
returns void language plpgsql security definer set search_path = public as $$
declare k public.vehicle_classes%rowtype; d public.drivers%rowtype;
begin
  select * into d from public.drivers where profile_id = auth.uid();
  if d.id is null then raise exception 'not a driver'; end if;
  if d.onboarding_status in ('submitted', 'approved') and not public.is_admin() then
    raise exception '送審後車型級距由平台審核變更，請聯絡客服';
  end if;
  select * into k from public.vehicle_classes where id = p_class and active;
  if k.id is null then raise exception 'unknown vehicle class %', p_class; end if;
  update public.vehicles set class_id = k.id, capacity_pallets = k.max_pallets, capacity_tons = k.max_weight_t
   where driver_id = d.id and active;
end $$;

create or replace function public.drivers_guard_review_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;
  if new.onboarding_status is distinct from old.onboarding_status
     or new.verification_status is distinct from old.verification_status
     or new.reviewed_at is distinct from old.reviewed_at
     or new.review_note is distinct from old.review_note
     or new.submitted_at is distinct from old.submitted_at
     or new.phone_verified_at is distinct from old.phone_verified_at
     or new.rating is distinct from old.rating or new.rating_count is distinct from old.rating_count
     or new.trips_count is distinct from old.trips_count or new.operator_id is distinct from old.operator_id then
    raise exception 'review fields can only be changed by the platform';
  end if;
  -- once submitted/approved the reviewed facts are frozen for the carrier (bank account, licence, business, areas)
  if old.onboarding_status in ('submitted', 'approved') and (
       new.bank_code is distinct from old.bank_code or new.bank_account_no is distinct from old.bank_account_no
    or new.bank_account_name is distinct from old.bank_account_name
    or new.license_class is distinct from old.license_class or new.license_expires_on is distinct from old.license_expires_on
    or new.business_type is distinct from old.business_type or new.operator_name is distinct from old.operator_name
    or new.operator_tax_id is distinct from old.operator_tax_id) then
    raise exception '已送審／核可的資料（撥款帳戶、駕照、營業資格）不能自行修改，請聯絡客服由平台審核變更';
  end if;
  return new;
end $$;

-- 車輛表：核可後承運人不能自己改（級距、車牌）；尾門旗標仍可自己開關
create or replace function public.vehicles_guard_after_approval()
returns trigger language plpgsql as $$
declare d public.drivers%rowtype;
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;
  select * into d from public.drivers where id = old.driver_id;
  if d.onboarding_status in ('submitted', 'approved') and (
       new.class_id is distinct from old.class_id or new.plate is distinct from old.plate
    or new.capacity_pallets is distinct from old.capacity_pallets or new.capacity_tons is distinct from old.capacity_tons
    or new.verification_status is distinct from old.verification_status) then
    raise exception '送審後車輛資料由平台審核變更，請聯絡客服';
  end if;
  return new;
end $$;
drop trigger if exists vehicles_guard_after_approval_trg on public.vehicles;
create trigger vehicles_guard_after_approval_trg before update on public.vehicles
  for each row execute function public.vehicles_guard_after_approval();

-- ---------- 駕照反面 --------------------------------------------------------------
alter table public.carrier_documents drop constraint if exists carrier_documents_kind_check;
alter table public.carrier_documents add constraint carrier_documents_kind_check check (kind in (
  'id_front', 'id_back', 'license', 'license_back', 'vehicle_reg', 'vehicle_front', 'vehicle_bed',
  'business_proof', 'affiliation_proof', 'insurance_compulsory', 'insurance_liability', 'insurance_cargo', 'bank_passbook'));
create or replace function public.required_carrier_docs(p_business_type text)
returns text[] language sql immutable as $$
  select array['id_front', 'id_back', 'license', 'license_back', 'vehicle_reg', 'vehicle_front', 'vehicle_bed', 'insurance_compulsory', 'bank_passbook']
         || case p_business_type when 'own_operator' then array['business_proof']
                                 when 'affiliated'   then array['affiliation_proof']
                                 when 'employee'     then array['business_proof']
                                 else array[]::text[] end;
$$;

-- ---------- 條款全文給 App 讀（最新版）------------------------------------------
create or replace function public.latest_contract_terms()
returns public.contract_terms language sql stable security definer set search_path = public as $$
  select * from public.contract_terms where effective_from <= now() order by version desc limit 1;
$$;
grant execute on function public.latest_contract_terms() to anon, authenticated;

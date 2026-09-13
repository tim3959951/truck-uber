-- 0015: scalability 與併發正確性修正（2026-09-13）
-- 來源：對 0001–0014 做的效能檢視（實測 50,000 筆訂單 / 2,000 位司機 / 999 位在線）。
-- 這支 migration 不改任何商業邏輯，只改「同樣的結果怎麼算比較快」與一個併發 bug。
--
-- 1. RLS policy 把 auth.uid() / is_admin() / my_driver_id() 包成 (select ...)：
--    stable 函數寫在 Filter 裡是「每一列各算一次」，包成 subquery 後 planner 會提成 InitPlan 只算一次。
--    實測 50,000 筆訂單：680 ms → 6 ms。後台訂單列表受益最大。
-- 2. 補索引：司機端每 4 秒查一次待接訂單（Seq Scan 50,000 列 → index 0.5 ms）；
--    vehicles.driver_id 是 FK 卻完全沒有索引（respond_offer、審核、RLS 都靠它）。
-- 3. dispatch_order 的「這位司機忙不忙」原本是一個 OR 條件 → 無法用 index anti-join，每次派單全掃訂單表。
--    拆成兩個 not exists + partial index：16 ms → 1.6 ms。
-- 4. 併發 bug：兩張單同時派單時，「司機忙不忙」是無鎖讀，實測會把同一位司機同時派給兩張單。
--    加 unique partial index 當硬保證；撞到就這輪不派（客戶端 5 秒後會再試一次）。
-- 5. driver_set_online(true) 原本在同一個交易裡對「所有」待媒合訂單迴圈派單（實測 199 張 = 1.8 秒，
--    期間擋住其他人的 poll）。限制一次最多 20 張，其餘交給後續輪詢。

-- ---------- 1. RLS：把每列呼叫的函數包成 InitPlan -------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists operators_admin on public.operators;
create policy operators_admin on public.operators for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists drivers_select on public.drivers;
create policy drivers_select on public.drivers for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists drivers_admin_update on public.drivers;
create policy drivers_admin_update on public.drivers for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists drivers_update_own on public.drivers;
create policy drivers_update_own on public.drivers for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated
  using (driver_id = (select public.my_driver_id()) or (select public.is_admin()));
drop policy if exists vehicles_insert_own on public.vehicles;
create policy vehicles_insert_own on public.vehicles for insert to authenticated
  with check (driver_id = (select public.my_driver_id()));
drop policy if exists vehicles_admin_update on public.vehicles;
create policy vehicles_admin_update on public.vehicles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists vehicles_update_own on public.vehicles;
create policy vehicles_update_own on public.vehicles for update to authenticated
  using (driver_id = (select public.my_driver_id())) with check (driver_id = (select public.my_driver_id()));

drop policy if exists driver_locations_select on public.driver_locations;
create policy driver_locations_select on public.driver_locations for select to authenticated
  using (driver_id = (select public.my_driver_id()) or (select public.is_admin())
         or exists (select 1 from public.orders o where o.driver_id = driver_locations.driver_id
                    and o.customer_id = (select auth.uid())
                    and o.status in ('accepted','arrived','in_transit','delivered')));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (customer_id = (select auth.uid()) or driver_id = (select public.my_driver_id())
         or offered_driver_id = (select public.my_driver_id()) or (select public.is_admin()));

drop policy if exists order_events_select on public.order_events;
create policy order_events_select on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_events.order_id
                 and (o.customer_id = (select auth.uid()) or o.driver_id = (select public.my_driver_id())
                      or (select public.is_admin()))));

drop policy if exists order_track_points_select on public.order_track_points;
create policy order_track_points_select on public.order_track_points for select to authenticated
  using (driver_id = (select public.my_driver_id()) or (select public.is_admin())
         or exists (select 1 from public.orders o where o.id = order_track_points.order_id
                    and o.customer_id = (select auth.uid())));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (customer_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists driver_earnings_select on public.driver_earnings;
create policy driver_earnings_select on public.driver_earnings for select to authenticated
  using (driver_id = (select public.my_driver_id()) or (select public.is_admin()));
drop policy if exists driver_earnings_admin_update on public.driver_earnings;
create policy driver_earnings_admin_update on public.driver_earnings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists device_tokens_own on public.device_tokens;
create policy device_tokens_own on public.device_tokens for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists pricing_config_admin on public.pricing_config;
create policy pricing_config_admin on public.pricing_config for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists vehicle_classes_admin on public.vehicle_classes;
create policy vehicle_classes_admin on public.vehicle_classes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists contract_terms_admin on public.contract_terms;
create policy contract_terms_admin on public.contract_terms for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists contracts_select_party on public.contracts;
create policy contracts_select_party on public.contracts for select to authenticated
  using (customer_id = (select auth.uid()) or carrier_driver_id = (select public.my_driver_id())
         or (select public.is_admin()));

drop policy if exists carrier_documents_own on public.carrier_documents;
create policy carrier_documents_own on public.carrier_documents for all to authenticated
  using (driver_id = (select public.my_driver_id()) or (select public.is_admin()))
  with check (driver_id = (select public.my_driver_id()) or (select public.is_admin()));

-- ---------- 2. 缺的索引 ---------------------------------------------------------
-- 司機端每 4 秒 getActiveOrder()：status in (7 值) and (driver_id = me or offered_driver_id = me)
create index if not exists orders_offered_any_idx on public.orders (offered_driver_id);
-- dispatch_order 的「這位司機還有沒有在跑的單」
create index if not exists orders_live_driver_idx on public.orders (driver_id)
  where status in ('offered', 'accepted', 'arrived', 'in_transit', 'delivered');
create index if not exists orders_live_offered_idx on public.orders (offered_driver_id)
  where status in ('offered', 'accepted', 'arrived', 'in_transit', 'delivered');
-- vehicles.driver_id 是 FK 但沒有索引
create index if not exists vehicles_driver_idx on public.vehicles (driver_id);
-- 0006 在 (driver_id, kind) 上建了兩個一樣的索引，留 unique 的那個
drop index if exists public.carrier_documents_driver_idx;

-- ---------- 3+4. dispatch_order：anti-join 拆開，並防止同一位司機被同時派兩張單 ----
-- 硬保證：同一位司機最多只能有一張 status='offered' 的單
drop index if exists public.orders_offered_idx;
create unique index if not exists orders_offered_idx on public.orders (offered_driver_id)
  where status = 'offered';

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
      -- split on purpose: one OR over two columns cannot use either partial index
      and not exists (select 1 from public.orders x where x.driver_id = d.id
                      and x.status in ('offered', 'accepted', 'arrived', 'in_transit', 'delivered'))
      and not exists (select 1 from public.orders x where x.offered_driver_id = d.id
                      and x.status in ('offered', 'accepted', 'arrived', 'in_transit', 'delivered'))
      and (l.driver_id is null or l.updated_at < now() - interval '15 minutes'
           or public.distance_km(l.lat, l.lng, o.pickup_lat, o.pickup_lng) <= c.service_radius_km)
    order by case when l.driver_id is not null and l.updated_at >= now() - interval '15 minutes' then 0 else 1 end,
             public.distance_km(coalesce(l.lat, o.pickup_lat), coalesce(l.lng, o.pickup_lng), o.pickup_lat, o.pickup_lng)
    limit 1;
    if v_driver is not null then v_found_round := v_round; exit; end if;
  end loop;

  if v_driver is null then return o; end if;

  begin
    update public.orders
       set status = 'offered', offered_driver_id = v_driver,
           offer_expires_at = now() + make_interval(secs => c.offer_timeout_seconds),
           -- second round: this driver gets a fresh chance, drop him from the expired list
           expired_driver_ids = array_remove(expired_driver_ids, v_driver)
     where id = p_order returning * into o;
  exception when unique_violation then
    -- another transaction offered this driver a different order a moment ago; leave this one
    -- in 'searching' and let the next poll (≤5 s) try again with someone else.
    return o;
  end;
  perform public.log_event(p_order, 'offered', null, null, null, jsonb_build_object('driver_id', v_driver, 'round', v_found_round));
  return o;
end $$;
revoke execute on function public.dispatch_order(uuid) from public, anon, authenticated;

-- ---------- 5. 上線時不要在同一個交易裡派完所有待媒合訂單 -------------------------
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
    -- bounded: the rest are picked up by the customers' polling a few seconds later
    for r in select id from public.orders where status = 'searching' order by created_at limit 20 loop
      perform public.dispatch_order(r.id);
    end loop;
  else
    update public.orders set status = 'searching', offered_driver_id = null, offer_expires_at = null,
           expired_driver_ids = array_append(expired_driver_ids, d.id)
     where offered_driver_id = d.id and status = 'offered';
  end if;
  return d;
end $$;

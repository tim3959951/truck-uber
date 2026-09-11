-- 0006: 承運人（司機／車行）資格驗證：註冊後分步驟填資料、上傳證件到私密儲存空間、送審、後台人工審核
-- 2026-09-11。可重複執行。
--
-- 平台只驗「有沒有合法資格」（身分、職業駕照、車籍、營業資格／靠行關係、保險、撥款帳戶、聲明），
-- 不驗「做得好不好」。審核通過（drivers.onboarding_status = 'approved'）才能上線接單。
-- 身分證字號不存文字，只存證件照片；照片放私密 bucket `carrier-docs`，本人與管理員才看得到。

-- ---------- 1. drivers 補欄位 --------------------------------------------------
alter table public.drivers
  add column if not exists onboarding_status   text not null default 'draft'
      check (onboarding_status in ('draft', 'submitted', 'needs_fix', 'approved', 'rejected')),
  add column if not exists phone_verified_at    timestamptz,
  add column if not exists license_class        text check (license_class in ('大貨車', '聯結車')),
  add column if not exists license_expires_on   date,
  add column if not exists business_type        text check (business_type in ('own_operator', 'affiliated', 'employee')),
      -- own_operator 自營貨運行 | affiliated 靠行 | employee 受僱於貨運公司
  add column if not exists operator_name        text not null default '',
  add column if not exists operator_tax_id      text not null default '',
  add column if not exists accept_external_loads boolean not null default true,
  add column if not exists service_areas        text[] not null default '{}',
  add column if not exists bank_code            text not null default '',
  add column if not exists bank_account_no      text not null default '',
  add column if not exists bank_account_name    text not null default '',
  add column if not exists declaration_accepted_at timestamptz,
  add column if not exists terms_accepted_at    timestamptz,
  add column if not exists terms_version        integer,
  add column if not exists submitted_at         timestamptz,
  add column if not exists reviewed_at          timestamptz,
  add column if not exists review_note          text not null default '';

-- 司機可以改自己的申請資料（草稿／退件補件時）；審核狀態與驗證欄位只能由 RPC／管理員改
drop policy if exists drivers_update_own on public.drivers;
create policy drivers_update_own on public.drivers for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- 保護：非管理員不能透過直接 update 改審核／驗證欄位
-- security INVOKER on purpose: current_user is the caller's role. Platform RPCs are security definer
-- (run as the owner), so they pass; a direct update from the App runs as 'authenticated' and is checked.
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
  return new;
end $$;
drop trigger if exists drivers_guard_review_trg on public.drivers;
create trigger drivers_guard_review_trg before update on public.drivers
  for each row execute function public.drivers_guard_review_columns();

-- ---------- 2. 證件表 ---------------------------------------------------------
create table if not exists public.carrier_documents (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references public.drivers (id) on delete cascade,
  kind         text not null check (kind in (
                 'id_front', 'id_back',                       -- 身分證
                 'license',                                   -- 職業大貨車／聯結車駕照
                 'vehicle_reg', 'vehicle_front', 'vehicle_bed', -- 行照、車頭含車牌、車斗
                 'business_proof',                            -- 貨運行登記／在職證明
                 'affiliation_proof',                         -- 靠行合約／靠行證明
                 'insurance_compulsory', 'insurance_liability', 'insurance_cargo',
                 'bank_passbook')),
  storage_path text not null,                                 -- carrier-docs/<profile uuid>/<kind>-<ts>.jpg
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note         text not null default '',
  uploaded_at  timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index if not exists carrier_documents_driver_idx on public.carrier_documents (driver_id, kind);
alter table public.carrier_documents enable row level security;
drop policy if exists carrier_documents_own on public.carrier_documents;
create policy carrier_documents_own on public.carrier_documents for all to authenticated
  using (driver_id = public.my_driver_id() or public.is_admin())
  with check (driver_id = public.my_driver_id() or public.is_admin());
grant select, insert, update, delete on public.carrier_documents to authenticated;

-- 同一種證件重傳就覆蓋（保留最新一張）
create unique index if not exists carrier_documents_driver_kind_idx on public.carrier_documents (driver_id, kind);

-- ---------- 3. 私密 Storage bucket：carrier-docs ----------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not present (local test db) - skipping bucket setup';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('carrier-docs', 'carrier-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "carrier docs own read" on storage.objects';
  execute $p$create policy "carrier docs own read" on storage.objects for select to authenticated
            using (bucket_id = 'carrier-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute 'drop policy if exists "carrier docs own write" on storage.objects';
  execute $p$create policy "carrier docs own write" on storage.objects for insert to authenticated
            with check (bucket_id = 'carrier-docs' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute 'drop policy if exists "carrier docs own update" on storage.objects';
  execute $p$create policy "carrier docs own update" on storage.objects for update to authenticated
            using (bucket_id = 'carrier-docs' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute 'drop policy if exists "carrier docs own delete" on storage.objects';
  execute $p$create policy "carrier docs own delete" on storage.objects for delete to authenticated
            using (bucket_id = 'carrier-docs' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end $$;

-- ---------- 4. 送審與審核 ---------------------------------------------------------
-- 必要證件：依營業型態不同
create or replace function public.required_carrier_docs(p_business_type text)
returns text[] language sql immutable as $$
  select array['id_front', 'id_back', 'license', 'vehicle_reg', 'vehicle_front', 'vehicle_bed', 'insurance_compulsory', 'bank_passbook']
         || case p_business_type when 'own_operator' then array['business_proof']
                                 when 'affiliated'   then array['affiliation_proof']
                                 when 'employee'     then array['business_proof']
                                 else array[]::text[] end;
$$;

create or replace function public.submit_onboarding()
returns public.drivers language plpgsql security definer set search_path = public as $$
declare d public.drivers%rowtype; v public.vehicles%rowtype; pr public.profiles%rowtype; missing text[]; req text[];
begin
  select * into d from public.drivers where profile_id = auth.uid() for update;
  if d.id is null then raise exception 'not a driver'; end if;
  if d.onboarding_status in ('submitted', 'approved') then return d; end if;
  select * into pr from public.profiles where id = auth.uid();
  select * into v from public.vehicles where driver_id = d.id and active order by created_at limit 1;
  if coalesce(pr.name, '') = '' or coalesce(pr.phone, '') = '' then raise exception '請填寫姓名與手機'; end if;
  if d.license_class is null or d.license_expires_on is null then raise exception '請填寫駕照類別與到期日'; end if;
  if d.license_expires_on < current_date then raise exception '駕照已過期'; end if;
  if v.id is null or coalesce(v.plate, '') = '' then raise exception '請填寫車牌'; end if;
  if d.business_type is null then raise exception '請選擇營業型態'; end if;
  if d.business_type in ('affiliated', 'employee') and coalesce(d.operator_name, '') = '' then raise exception '請填寫所屬貨運業者'; end if;
  if cardinality(d.service_areas) = 0 then raise exception '請選擇可服務區域'; end if;
  if coalesce(d.bank_code, '') = '' or coalesce(d.bank_account_no, '') = '' or coalesce(d.bank_account_name, '') = '' then raise exception '請填寫撥款帳戶'; end if;
  if d.declaration_accepted_at is null or d.terms_accepted_at is null then raise exception '請勾選聲明與平台條款'; end if;
  req := public.required_carrier_docs(d.business_type);
  select array_agg(k) into missing from unnest(req) k
   where not exists (select 1 from public.carrier_documents cd where cd.driver_id = d.id and cd.kind = k);
  if missing is not null then raise exception '缺少證件：%', array_to_string(missing, ', '); end if;

  update public.drivers set onboarding_status = 'submitted', submitted_at = now(), review_note = '' where id = d.id returning * into d;
  return d;
end $$;
grant execute on function public.submit_onboarding() to authenticated;

-- 管理員審核整份申請：approved → 司機與車輛都標 verified；needs_fix / rejected 附原因
create or replace function public.review_onboarding(p_driver uuid, p_decision text, p_note text default '')
returns public.drivers language plpgsql security definer set search_path = public as $$
declare d public.drivers%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_decision not in ('approved', 'needs_fix', 'rejected') then raise exception 'bad decision'; end if;
  update public.drivers
     set onboarding_status = p_decision, reviewed_at = now(), review_note = coalesce(p_note, ''),
         verification_status = case p_decision when 'approved' then 'verified'::public.verification_status
                                               when 'rejected' then 'rejected'::public.verification_status
                                               else 'pending'::public.verification_status end,
         online = case when p_decision = 'approved' then online else false end
   where id = p_driver returning * into d;
  if d.id is null then raise exception 'no such driver'; end if;
  if p_decision = 'approved' then
    update public.vehicles set verification_status = 'verified' where driver_id = d.id and active;
    update public.carrier_documents set status = 'approved', reviewed_at = now() where driver_id = d.id and status = 'pending';
  end if;
  return d;
end $$;
grant execute on function public.review_onboarding(uuid, text, text) to authenticated;

-- 管理員標單一證件
create or replace function public.review_document(p_doc uuid, p_status text, p_note text default '')
returns public.carrier_documents language plpgsql security definer set search_path = public as $$
declare cd public.carrier_documents%rowtype;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.carrier_documents set status = p_status, note = coalesce(p_note, ''), reviewed_at = now()
   where id = p_doc returning * into cd;
  return cd;
end $$;
grant execute on function public.review_document(uuid, text, text) to authenticated;

-- ---------- 5. 沒審核通過不能上線 ---------------------------------------------------
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
           declined_driver_ids = array_append(declined_driver_ids, d.id)
     where offered_driver_id = d.id and status = 'offered';
  end if;
  return d;
end $$;

-- 派單也只派審核通過的承運人（require_verification 開啟時）；已在 dispatch_order 用 verification_status 判斷，
-- review_onboarding 會同步 verification_status，這裡不再改 dispatch_order。

-- 正式：開啟資格檢查。測試期若要暫時關掉，後台「計價與派單設定」把「只派給已驗證司機/車輛」改為否。
update public.pricing_config set require_verification = true where id = 1;

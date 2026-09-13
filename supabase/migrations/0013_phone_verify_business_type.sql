-- 0013: 手機驗證（雙方 App）、營業型態改為白話二選一、發票由誰開
-- 2026-09-13 依 Tim 回饋。可重複執行。
--
-- 1. 手機驗證：App 用 Supabase Auth 的 phone_change OTP（updateUser({phone}) → verifyOtp），驗完呼叫
--    sync_phone_verified() 把 auth.users.phone / phone_confirmed_at 抄到 profiles（司機另抄到 drivers）。
--    pricing_config.require_phone_verification = true 時，未驗證手機不能下單／不能送出資格審核。
-- 2. 營業型態只剩兩種：own_operator（自營貨運行，可自己開發票）／ affiliated（靠行，發票由靠行公司代開或不開）。
--    「受僱」拿掉：平台不跟車行合作、不媒合受僱司機；accept_external_loads 欄位保留但 App 不再顯示。
-- 3. invoice_by：self（自己開統一發票）／ operator（靠行公司代開）／ none（無法開發票，只能收據）。

-- ---------- 1. 手機驗證 ------------------------------------------------------------
alter table public.profiles add column if not exists phone_verified_at timestamptz;
alter table public.pricing_config add column if not exists require_phone_verification boolean not null default false;

create or replace function public.sync_phone_verified()
returns public.profiles language plpgsql security definer set search_path = public as $$
declare u record; p public.profiles%rowtype; v_local text;
begin
  select phone, phone_confirmed_at into u from auth.users where id = auth.uid();
  if u.phone is null or u.phone_confirmed_at is null then raise exception '手機尚未完成驗證'; end if;
  -- +886912345678 → 0912345678（台灣門號顯示用）
  v_local := case when u.phone like '886%' then '0' || substr(u.phone, 4) when u.phone like '+886%' then '0' || substr(u.phone, 5) else u.phone end;
  update public.profiles set phone = v_local, phone_verified_at = coalesce(phone_verified_at, u.phone_confirmed_at)
   where id = auth.uid() returning * into p;
  update public.drivers set phone_verified_at = coalesce(phone_verified_at, u.phone_confirmed_at) where profile_id = auth.uid();
  return p;
end $$;
grant execute on function public.sync_phone_verified() to authenticated;

-- 使用者改了 profiles.phone（例如驗證後又手動改），驗證紀錄作廢
create or replace function public.profiles_phone_guard()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;
  if new.phone_verified_at is distinct from old.phone_verified_at then
    raise exception 'phone_verified_at can only be set by the platform';
  end if;
  if new.phone is distinct from old.phone then new.phone_verified_at := null; end if;
  return new;
end $$;
drop trigger if exists profiles_phone_guard_trg on public.profiles;
create trigger profiles_phone_guard_trg before update on public.profiles
  for each row execute function public.profiles_phone_guard();

-- ---------- 2. 營業型態二選一 + 發票 ------------------------------------------------
update public.drivers set business_type = 'affiliated' where business_type = 'employee';
alter table public.drivers drop constraint if exists drivers_business_type_check;
alter table public.drivers add constraint drivers_business_type_check check (business_type in ('own_operator', 'affiliated'));
alter table public.drivers add column if not exists invoice_by text check (invoice_by in ('self', 'operator', 'none'));
update public.drivers set invoice_by = 'self' where business_type = 'own_operator' and invoice_by is null;

create or replace function public.required_carrier_docs(p_business_type text)
returns text[] language sql immutable as $$
  select array['id_front', 'id_back', 'license', 'license_back', 'vehicle_reg', 'vehicle_front', 'vehicle_bed', 'insurance_compulsory', 'bank_passbook']
         || case p_business_type when 'own_operator' then array['business_proof']
                                 when 'affiliated'   then array['affiliation_proof']
                                 else array[]::text[] end;
$$;

create or replace function public.submit_onboarding()
returns public.drivers language plpgsql security definer set search_path = public as $$
declare d public.drivers%rowtype; v public.vehicles%rowtype; pr public.profiles%rowtype; c public.pricing_config%rowtype; missing text[]; req text[];
begin
  select * into d from public.drivers where profile_id = auth.uid() for update;
  if d.id is null then raise exception 'not a driver'; end if;
  if d.onboarding_status in ('submitted', 'approved') then return d; end if;
  select * into pr from public.profiles where id = auth.uid();
  select * into c from public.pricing_config where id = 1;
  select * into v from public.vehicles where driver_id = d.id and active order by created_at limit 1;
  if coalesce(pr.name, '') = '' or coalesce(pr.phone, '') = '' then raise exception '請填寫姓名與手機'; end if;
  if c.require_phone_verification and pr.phone_verified_at is null then raise exception '請先完成手機驗證'; end if;
  if d.license_class is null or d.license_expires_on is null then raise exception '請填寫駕照類別與到期日'; end if;
  if d.license_expires_on < current_date then raise exception '駕照已過期'; end if;
  if v.id is null or coalesce(v.plate, '') = '' then raise exception '請填寫車牌'; end if;
  if d.business_type is null then raise exception '請選擇營業型態（自營貨運行或靠行）'; end if;
  if coalesce(d.operator_name, '') = '' then
    raise exception '%', case d.business_type when 'own_operator' then '請填寫貨運行名稱' else '請填寫靠行的公司名稱' end;
  end if;
  if d.business_type = 'own_operator' and d.invoice_by is distinct from 'self' then d.invoice_by := 'self'; end if;
  if d.business_type = 'affiliated' and coalesce(d.invoice_by, '') not in ('operator', 'none') then raise exception '請選擇發票方式（靠行公司代開或無法開發票）'; end if;
  if cardinality(d.service_areas) = 0 then raise exception '請選擇可服務區域'; end if;
  if coalesce(d.bank_code, '') = '' or coalesce(d.bank_account_no, '') = '' or coalesce(d.bank_account_name, '') = '' then raise exception '請填寫撥款帳戶'; end if;
  if d.declaration_accepted_at is null or d.terms_accepted_at is null then raise exception '請勾選聲明與平台條款'; end if;
  req := public.required_carrier_docs(d.business_type);
  select array_agg(k) into missing from unnest(req) k
   where not exists (select 1 from public.carrier_documents cd where cd.driver_id = d.id and cd.kind = k);
  if missing is not null then raise exception '缺少證件：%', array_to_string(missing, ', '); end if;

  update public.drivers set onboarding_status = 'submitted', submitted_at = now(), review_note = '', invoice_by = d.invoice_by
   where id = d.id returning * into d;
  return d;
end $$;
grant execute on function public.submit_onboarding() to authenticated;

-- 送審後 invoice_by 也鎖定（跟營業資格一起）
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
  if old.onboarding_status in ('submitted', 'approved') and (
       new.bank_code is distinct from old.bank_code or new.bank_account_no is distinct from old.bank_account_no
    or new.bank_account_name is distinct from old.bank_account_name
    or new.license_class is distinct from old.license_class or new.license_expires_on is distinct from old.license_expires_on
    or new.business_type is distinct from old.business_type or new.operator_name is distinct from old.operator_name
    or new.operator_tax_id is distinct from old.operator_tax_id or new.invoice_by is distinct from old.invoice_by) then
    raise exception '已送審／核可的資料（撥款帳戶、駕照、營業資格）不能自行修改，請聯絡客服由平台審核變更';
  end if;
  return new;
end $$;

-- ---------- 3. 下單要求手機已驗證 -----------------------------------------------------
-- create_order 的簽名在 0003/0004 定義；這裡只加一個前置檢查 trigger，不改 RPC。
create or replace function public.orders_require_verified_phone()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.pricing_config%rowtype; p public.profiles%rowtype;
begin
  select * into c from public.pricing_config where id = 1;
  if not c.require_phone_verification then return new; end if;
  select * into p from public.profiles where id = new.customer_id;
  if p.role = 'admin' then return new; end if;
  if p.phone_verified_at is null then raise exception '下單前請先完成手機驗證'; end if;
  return new;
end $$;
drop trigger if exists orders_require_verified_phone_trg on public.orders;
create trigger orders_require_verified_phone_trg before insert on public.orders
  for each row execute function public.orders_require_verified_phone();

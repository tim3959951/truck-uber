-- 0011: 註冊時同意平台服務條款（雙方 App）記錄在 profiles；註冊 metadata 帶 terms_version
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := 'customer';
  v_driver uuid;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_class text := coalesce(nullif(v_meta->>'class_id', ''), '17t');
begin
  if v_meta->>'role' in ('customer', 'driver') then
    v_role := (v_meta->>'role')::public.user_role;
  end if;
  if not exists (select 1 from public.vehicle_classes where id = v_class) then v_class := '17t'; end if;
  insert into public.profiles (id, role, name, phone, company, terms_accepted_at, terms_version)
  values (new.id, v_role, coalesce(v_meta->>'name', ''), coalesce(v_meta->>'phone', ''), coalesce(v_meta->>'company', ''),
          case when coalesce(v_meta->>'terms_version', '') <> '' then now() else null end, nullif(v_meta->>'terms_version', ''));
  if v_role = 'driver' then
    insert into public.drivers (profile_id) values (new.id) returning id into v_driver;
    if coalesce(v_meta->>'plate', '') <> '' then
      insert into public.vehicles (driver_id, plate, make_model, has_tail_lift, class_id, capacity_pallets, capacity_tons)
      select v_driver, upper(v_meta->>'plate'), coalesce(v_meta->>'make_model', ''),
             coalesce((v_meta->>'has_tail_lift')::boolean, false), k.id, k.max_pallets, k.max_weight_t
      from public.vehicle_classes k where k.id = v_class;
    end if;
  end if;
  return new;
end $$;

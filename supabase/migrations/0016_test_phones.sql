-- 0016: 測試用手機號碼白名單（2026-09-13）
-- 問題：Supabase 的 auth.users.phone 是唯一的，一支手機只能綁一個帳號。開發期間要反覆用同一支
-- 手機註冊不同的測試帳號（客戶端、司機端各好幾個），第二次就會被「這支號碼已經註冊過」擋住。
--
-- 作法：只有列在 test_phones 的號碼，才可以在開始驗證前把自己從舊帳號上解開。
-- 白名單只有管理員能看、能改；不在名單上的號碼呼叫這支函數是 no-op（回 false），
-- 所以一般使用者的號碼永遠不會被別人搶走。號碼本身不寫進 migration（repo 是公開的），
-- 上線後由管理員自己 insert。
create table if not exists public.test_phones (
  phone      text primary key,          -- E.164 數字，不含 +，例如 886912345678
  note       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.test_phones enable row level security;
drop policy if exists test_phones_admin on public.test_phones;
create policy test_phones_admin on public.test_phones for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.test_phones to authenticated;

-- 把 09xxxxxxxx / +886xxxxxxxxx / 886xxxxxxxxx 一律正規化成 886xxxxxxxxx
create or replace function public.normalize_tw_phone(p_phone text)
returns text language sql immutable as $$
  select case
    when d like '886%' then d
    when d like '0%'   then '886' || substr(d, 2)
    else d end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) s;
$$;

-- App 在送出簡訊驗證碼之前呼叫。號碼在白名單上就把它從舊帳號解開，讓同一支手機能再驗一次。
-- 回 true = 有解開（是測試號碼）；回 false = 一般號碼，什麼都沒做。
create or replace function public.claim_test_phone(p_phone text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_norm text; v_me uuid := auth.uid(); v_freed int := 0;
begin
  if v_me is null then return false; end if;
  v_norm := public.normalize_tw_phone(p_phone);
  if v_norm = '' or not exists (select 1 from public.test_phones where phone = v_norm) then return false; end if;

  -- 別的帳號正拿著這支號碼 → 解開它（連同 profiles / drivers 上的驗證紀錄）
  update public.profiles p set phone_verified_at = null
   where p.id <> v_me and p.id in (select u.id from auth.users u where u.phone = v_norm);
  update public.drivers d set phone_verified_at = null
   where d.profile_id <> v_me and d.profile_id in (select u.id from auth.users u where u.phone = v_norm);
  update auth.users u set phone = null, phone_confirmed_at = null
   where u.phone = v_norm and u.id <> v_me;
  get diagnostics v_freed = row_count;
  return true;
end $$;
grant execute on function public.claim_test_phone(text) to authenticated;

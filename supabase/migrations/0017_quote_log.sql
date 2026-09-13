-- 0017: 報價紀錄（2026-09-13）
-- 為什麼要有這張表：現在只看得到「成交的訂單」，看不到「報價了但客戶沒下單」。
-- 而「看了價格就走掉」正是價格敏感度最重要的訊號，也是未來要做動態定價（ML）唯一能用的訓練資料。
-- 沒有這張表，半年後要做動態定價只能從零開始再收集半年。
--
-- 第二個用途：拼車（一台車載不同客戶的貨）。這張表會告訴你「有多少小單（3–6 托）被報價後放棄」，
-- 那就是拼車需求的實證；等資料夠了再決定要不要做，而不是憑感覺做。
--
-- 寫入時機：客戶在選車種／看到價格的畫面時寫一筆（App 呼叫 log_quote）。
-- 成交連結：訂單建立時由 trigger 自動把該客戶最近一小時、還沒連結的報價指到這張訂單，
-- 所以 App 不需要傳任何 id，也不會因為漏傳而少記。

create table if not exists public.quote_log (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references public.profiles (id) on delete set null,
  -- 起訖點（只留名稱與座標，不留完整地址，降低個資量）
  pickup_name    text not null default '',
  pickup_lat     double precision,
  pickup_lng     double precision,
  dest_name      text not null default '',
  dest_lat       double precision,
  dest_lng       double precision,
  estimated_km   numeric(8,1),
  -- 報價輸入
  class_id       text,
  load_mode      text not null default 'pallet',
  pallets        integer not null default 0,
  weight_t       numeric(5,1),
  tier           text not null default 'dedicated',
  need_tail_lift boolean not null default false,
  helpers        integer not null default 0,
  -- 報價輸出
  quoted_price   integer not null default 0,
  -- 有沒有變成訂單（trigger 填）
  order_id       uuid references public.orders (id) on delete set null,
  converted_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists quote_log_customer_idx on public.quote_log (customer_id, created_at desc);
create index if not exists quote_log_created_idx on public.quote_log (created_at desc);
-- 還沒成交的報價（trigger 連結時用；也是「流失報價」的查詢入口）
create index if not exists quote_log_open_idx on public.quote_log (customer_id, created_at desc) where order_id is null;

alter table public.quote_log enable row level security;
-- 使用者看得到自己的報價紀錄，管理員看得到全部；寫入只能透過 RPC
drop policy if exists quote_log_select on public.quote_log;
create policy quote_log_select on public.quote_log for select to authenticated
  using (customer_id = (select auth.uid()) or (select public.is_admin()));
grant select on public.quote_log to authenticated;

-- App 在客戶看到價格時呼叫。故意設計成「失敗也不影響下單」：回傳 uuid，錯誤由 App 忽略。
create or replace function public.log_quote(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_me uuid := auth.uid(); v_last timestamptz;
begin
  if v_me is null then return null; end if;
  -- 防灌水：同一位客戶 10 秒內只記一筆（畫面重繪、切換車種不該各記一筆）
  select created_at into v_last from public.quote_log
   where customer_id = v_me order by created_at desc limit 1;
  if v_last is not null and v_last > now() - interval '10 seconds' then return null; end if;

  insert into public.quote_log (
    customer_id, pickup_name, pickup_lat, pickup_lng, dest_name, dest_lat, dest_lng,
    estimated_km, class_id, load_mode, pallets, weight_t, tier, need_tail_lift, helpers, quoted_price)
  values (
    v_me,
    coalesce(p->'pickup'->>'name', ''), (p->'pickup'->>'lat')::double precision, (p->'pickup'->>'lng')::double precision,
    coalesce(p->'dest'->>'name', ''),   (p->'dest'->>'lat')::double precision,   (p->'dest'->>'lng')::double precision,
    nullif(p->>'km', '')::numeric,
    nullif(p->>'class_id', ''),
    coalesce(nullif(p->>'load_mode', ''), 'pallet'),
    coalesce((p->>'pallets')::integer, 0),
    nullif(p->>'weight_t', '')::numeric,
    coalesce(nullif(p->>'tier', ''), 'dedicated'),
    coalesce((p->>'need_tail_lift')::boolean, false),
    coalesce((p->>'helpers')::integer, 0),
    coalesce((p->>'price')::integer, 0))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.log_quote(jsonb) to authenticated;

-- 訂單一成立，就把這位客戶最近一小時內還沒連結的報價指過去（最多 5 筆，涵蓋他比價的過程）
create or replace function public.link_quotes_to_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.quote_log q
     set order_id = new.id, converted_at = now()
   where q.id in (
     select id from public.quote_log
      where customer_id = new.customer_id and order_id is null
        and created_at > now() - interval '1 hour'
      order by created_at desc limit 5);
  return new;
end $$;
drop trigger if exists orders_link_quotes_trg on public.orders;
create trigger orders_link_quotes_trg after insert on public.orders
  for each row execute function public.link_quotes_to_order();

-- 後台用：每天的報價數、成交數、成交率、流失報價的平均金額與托數
create or replace view public.quote_funnel as
  select (created_at at time zone 'Asia/Taipei')::date as day,
         count(*)                                          as quotes,
         count(*) filter (where order_id is not null)      as converted,
         round(100.0 * count(*) filter (where order_id is not null) / nullif(count(*), 0), 1) as convert_pct,
         round(avg(quoted_price) filter (where order_id is null))   as lost_avg_price,
         round(avg(pallets)      filter (where order_id is null), 1) as lost_avg_pallets,
         count(*) filter (where order_id is null and load_mode = 'pallet' and pallets between 1 and 6) as lost_small_loads
    from public.quote_log
   group by 1 order by 1 desc;
grant select on public.quote_funnel to authenticated;

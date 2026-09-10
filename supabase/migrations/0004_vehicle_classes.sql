-- 0004: 車型級距（11噸級 / 17噸級 / 26噸級 / 35噸拖板）＋ 整車模式
-- 2026-09-11。可重複執行。
--
-- 設計（與 Tim 確認過）：客戶先填貨（托數、選填總重量、或切「整車」），系統依托數與重量預選
-- 最小能載的級距，畫面同時列出所有級距與價格讓客戶自己換。每個級距有自己的起步／每公里／每托／
-- 上限；司機註冊時選自己的車屬於哪一級，派單只派同級距的車。
-- 台灣貨運講的噸數是「總重」，載重約為總重的一半多一點；棧板上限同時受車斗長度與載重限制。

-- ---------- 1. 級距表 ---------------------------------------------------------
create table if not exists public.vehicle_classes (
  id            text primary key,                 -- '11t' | '17t' | '26t' | '35t'
  name          text not null,                    -- 顯示名稱
  nickname      text not null default '',         -- 俗稱（六輪、十輪、三軸、拖板）
  sort          integer not null default 0,
  active        boolean not null default true,
  base_fare     integer not null,                 -- 起步價 NT$
  per_km        numeric(8,2) not null,            -- 每公里 NT$
  per_pallet    integer not null,                 -- 每托 NT$（整車 = max_pallets × per_pallet）
  max_pallets   integer not null,                 -- 單層可載棧板數（110×110 cm，受車斗長與載重限制）
  max_weight_t  numeric(5,1) not null,            -- 載重上限（噸，不是總重）
  deck_m        numeric(4,1) not null default 0,  -- 車斗長（公尺，僅顯示用）
  gross_t       text not null default '',         -- 總重級距說明，僅顯示用（例：'23–26噸'）
  updated_at    timestamptz not null default now()
);
alter table public.vehicle_classes enable row level security;
drop policy if exists vehicle_classes_select on public.vehicle_classes;
create policy vehicle_classes_select on public.vehicle_classes for select to anon, authenticated using (true);
drop policy if exists vehicle_classes_admin on public.vehicle_classes;
create policy vehicle_classes_admin on public.vehicle_classes for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.vehicle_classes to anon, authenticated;
grant insert, update, delete on public.vehicle_classes to authenticated;

-- 佔位價格：17噸級沿用原本 pricing_config 的數字（起步 1500 / 38 / 150），其餘等 Tim 問過司機再改。
insert into public.vehicle_classes (id, name, nickname, sort, base_fare, per_km, per_pallet, max_pallets, max_weight_t, deck_m, gross_t) values
  ('11t', '11噸級',   '六輪中型',       1, 1200, 30, 120,  8,  6.0,  6.0, '8.8–11噸'),
  ('17t', '17噸級',   '十輪大貨車',     2, 1500, 38, 150, 12, 10.0,  7.5, '15–17噸'),
  ('26t', '26噸級',   '三軸十二輪',     3, 2000, 48, 150, 16, 15.0,  9.6, '23–26噸'),
  ('35t', '35噸拖板', '半聯結車／平板', 4, 2600, 60, 150, 22, 24.0, 12.2, '35噸')
on conflict (id) do nothing;

-- ---------- 2. 車輛與訂單多級距欄位 --------------------------------------------
alter table public.vehicles add column if not exists class_id text not null default '17t' references public.vehicle_classes (id);
alter table public.orders   add column if not exists class_id text not null default '17t' references public.vehicle_classes (id);
alter table public.orders   add column if not exists load_mode text not null default 'pallet' check (load_mode in ('pallet', 'full'));
alter table public.orders   add column if not exists weight_t numeric(6,1);          -- 客戶填的總重量（噸），選填
alter table public.orders   add column if not exists quantity_desc text not null default '';  -- 整車模式：數量描述（例：H型鋼 12 支）
alter table public.orders   drop constraint if exists orders_pallets_check;
alter table public.orders   add constraint orders_pallets_check check (pallets >= 0);
create index if not exists vehicles_class_idx on public.vehicles (class_id) where active;

-- ---------- 3. 報價：級距價格 + 整車 -----------------------------------------
create or replace function public.quote_price(p_km numeric, p_pallets integer, p_tier public.truck_tier,
                                              p_tail_lift boolean, p_helpers integer,
                                              p_class text, p_load_mode text default 'pallet')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.pricing_config%rowtype;
  k public.vehicle_classes%rowtype;
  v_pallets integer; v_dist integer; v_pal integer; v_sub integer; v_mult numeric; v_base integer;
  v_lift integer; v_help integer; v_total integer; v_fee integer;
begin
  select * into c from public.pricing_config where id = 1;
  select * into k from public.vehicle_classes where id = coalesce(p_class, '17t');
  if k.id is null then raise exception 'unknown vehicle class %', p_class; end if;
  v_pallets := case when p_load_mode = 'full' then k.max_pallets else p_pallets end;
  v_dist := k.base_fare + round(p_km * k.per_km);
  v_pal  := v_pallets * k.per_pallet;
  v_sub  := v_dist + v_pal;
  v_mult := case p_tier when 'backhaul' then c.backhaul_multiplier else c.dedicated_multiplier end;
  v_base := round(v_sub * v_mult / 10) * 10;
  v_lift := case when p_tail_lift then c.tail_lift_fee else 0 end;
  v_help := greatest(0, least(2, coalesce(p_helpers, 0))) * c.helper_fee;
  v_total := v_base + v_lift + v_help;
  v_fee := round(v_total * c.platform_fee_rate);
  return jsonb_build_object(
    'km', p_km, 'pallets', p_pallets, 'tier', p_tier, 'class_id', k.id, 'load_mode', coalesce(p_load_mode, 'pallet'),
    'distance_fee', v_dist, 'pallet_fee', v_pal, 'subtotal', v_sub,
    'multiplier', v_mult, 'base_total', v_base,
    'tail_lift', p_tail_lift, 'tail_lift_fee', v_lift,
    'helpers', greatest(0, least(2, coalesce(p_helpers, 0))), 'helper_fee', v_help,
    'total', v_total, 'platform_fee', v_fee, 'driver_amount', v_total - v_fee,
    'config', jsonb_build_object('base_fare', k.base_fare, 'per_km', k.per_km, 'per_pallet', k.per_pallet,
                                 'max_pallets', k.max_pallets,
                                 'tail_lift_fee', c.tail_lift_fee, 'helper_fee', c.helper_fee));
end $$;

-- 舊簽章保留：等於 17噸級、棧板模式（0002 的測試與舊 client 仍可呼叫）
create or replace function public.quote_price(p_km numeric, p_pallets integer, p_tier public.truck_tier,
                                              p_tail_lift boolean default false, p_helpers integer default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.quote_price(p_km, p_pallets, p_tier, p_tail_lift, p_helpers, '17t', 'pallet');
$$;
grant execute on function public.quote_price(numeric, integer, public.truck_tier, boolean, integer, text, text) to anon, authenticated;

-- ---------- 4. create_order：級距、整車、重量檢查 ------------------------------
create or replace function public.create_order(p jsonb)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  pr public.profiles%rowtype;
  k public.vehicle_classes%rowtype;
  v_km numeric; v_straight numeric; q jsonb;
  v_lift boolean := coalesce((p->>'need_tail_lift')::boolean, false);
  v_helpers integer := greatest(0, least(2, coalesce((p->>'helpers')::int, 0)));
  v_photo text := nullif(trim(coalesce(p->>'cargo_photo_url', '')), '');
  v_class text := coalesce(nullif(p->>'class_id', ''), '17t');
  v_mode text := case when p->>'load_mode' = 'full' then 'full' else 'pallet' end;
  v_pallets integer := case when p->>'load_mode' = 'full' then 0 else coalesce((p->>'pallets')::int, 0) end;
  v_weight numeric := nullif(p->>'weight_t', '')::numeric;
begin
  select * into pr from public.profiles where id = auth.uid();
  if pr.id is null or pr.role <> 'customer' then raise exception 'only customers can create orders'; end if;
  select * into k from public.vehicle_classes where id = v_class and active;
  if k.id is null then raise exception 'unknown vehicle class %', v_class; end if;
  if v_mode = 'pallet' and v_pallets < 1 then raise exception 'pallets must be >= 1'; end if;
  if v_mode = 'pallet' and v_pallets > k.max_pallets then
    raise exception '% 最多 % 托，請選更大的車型', k.name, k.max_pallets;
  end if;
  if v_weight is not null and v_weight > k.max_weight_t then
    raise exception '% 載重上限 % 噸，請選更大的車型', k.name, k.max_weight_t;
  end if;

  v_straight := public.distance_km((p->'pickup'->>'lat')::float8, (p->'pickup'->>'lng')::float8,
                                   (p->'dest'->>'lat')::float8, (p->'dest'->>'lng')::float8);
  v_km := round(coalesce((p->>'km')::numeric, v_straight * 1.28), 1);
  if v_km < v_straight * 0.95 or v_km > greatest(v_straight * 2.5, v_straight + 15) then
    v_km := round(v_straight * 1.28, 1);
  end if;
  q := public.quote_price(v_km, v_pallets, (p->>'tier')::public.truck_tier, v_lift, v_helpers, k.id, v_mode);

  insert into public.orders (customer_id, pickup_name, pickup_addr, pickup_lat, pickup_lng,
                             dest_name, dest_addr, dest_lat, dest_lng, pallets, cargo_type, note, truck_tier,
                             need_tail_lift, helpers, cargo_photo_url, class_id, load_mode, weight_t, quantity_desc,
                             estimated_km, distance_source, route_polyline, quoted_price, quote_breakdown,
                             platform_fee, driver_amount, customer_name, customer_phone, customer_company)
  values (pr.id, p->'pickup'->>'name', coalesce(p->'pickup'->>'addr', ''), (p->'pickup'->>'lat')::float8, (p->'pickup'->>'lng')::float8,
          p->'dest'->>'name', coalesce(p->'dest'->>'addr', ''), (p->'dest'->>'lat')::float8, (p->'dest'->>'lng')::float8,
          v_pallets, p->>'cargo_type', coalesce(p->>'note', ''), (p->>'tier')::public.truck_tier,
          v_lift, v_helpers, v_photo, k.id, v_mode, v_weight, coalesce(p->>'quantity_desc', ''),
          v_km, coalesce(p->>'distance_source', 'estimate'), p->'route_polyline', (q->>'total')::int, q,
          (q->>'platform_fee')::int, (q->>'driver_amount')::int, pr.name, pr.phone, pr.company)
  returning * into o;

  insert into public.payments (order_id, customer_id, amount, platform_fee, driver_amount)
  values (o.id, pr.id, o.quoted_price, o.platform_fee, o.driver_amount);
  perform public.log_event(o.id, 'created', pr.id, o.pickup_lat, o.pickup_lng, jsonb_build_object('quote', q));
  return o;
end $$;

-- ---------- 5. 派單：只派同級距的車 ------------------------------------------
create or replace function public.dispatch_order(p_order uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  c public.pricing_config%rowtype;
  v_driver uuid;
begin
  select * into o from public.orders where id = p_order for update;
  if o.status <> 'searching' then return o; end if;
  select * into c from public.pricing_config where id = 1;

  select d.id into v_driver
  from public.drivers d
  join public.vehicles v on v.driver_id = d.id and v.active
  left join public.driver_locations l on l.driver_id = d.id
  where d.online
    and not (d.id = any (o.declined_driver_ids))
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

  if v_driver is null then return o; end if;

  update public.orders
     set status = 'offered', offered_driver_id = v_driver,
         offer_expires_at = now() + make_interval(secs => c.offer_timeout_seconds)
   where id = p_order returning * into o;
  perform public.log_event(p_order, 'offered', null, null, null, jsonb_build_object('driver_id', v_driver));
  return o;
end $$;
revoke execute on function public.dispatch_order(uuid) from public, anon, authenticated;

-- ---------- 6. 司機註冊可選級距 ------------------------------------------------
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
  insert into public.profiles (id, role, name, phone, company)
  values (new.id, v_role, coalesce(v_meta->>'name', ''), coalesce(v_meta->>'phone', ''), coalesce(v_meta->>'company', ''));
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

-- ---------- 7. 司機可改自己車輛的級距（沿用 vehicles_update_own）；管理員可改任何車 ----
create or replace function public.driver_set_vehicle_class(p_class text)
returns void language plpgsql security definer set search_path = public as $$
declare k public.vehicle_classes%rowtype;
begin
  select * into k from public.vehicle_classes where id = p_class and active;
  if k.id is null then raise exception 'unknown vehicle class %', p_class; end if;
  update public.vehicles set class_id = k.id, capacity_pallets = k.max_pallets, capacity_tons = k.max_weight_t
   where driver_id = public.my_driver_id() and active;
end $$;
grant execute on function public.driver_set_vehicle_class(text) to authenticated;

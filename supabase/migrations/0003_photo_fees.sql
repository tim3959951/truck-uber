-- 0003: 加價項目調價（尾門 1000、搬運工 3000）＋ 現場貨物照片
-- 2026-09-11 依 Tim 要求。可重複執行。

-- ---------- 1. 加價項目調價 ------------------------------------------------
alter table public.pricing_config
  alter column tail_lift_fee set default 1000,
  alter column helper_fee    set default 3000;
update public.pricing_config set tail_lift_fee = 1000, helper_fee = 3000 where id = 1;

-- ---------- 2. 訂單多一張「現場貨物照片」 ----------------------------------
-- 客戶下單前拍的實際貨態；司機接單前可看，也是出貨證明／理賠責任釐清依據。
alter table public.orders add column if not exists cargo_photo_url text;

-- create_order 多讀 p->>'cargo_photo_url'（其餘與 0002 相同）
create or replace function public.create_order(p jsonb)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  pr public.profiles%rowtype;
  v_km numeric; v_straight numeric; q jsonb;
  v_lift boolean := coalesce((p->>'need_tail_lift')::boolean, false);
  v_helpers integer := greatest(0, least(2, coalesce((p->>'helpers')::int, 0)));
  v_photo text := nullif(trim(coalesce(p->>'cargo_photo_url', '')), '');
begin
  select * into pr from public.profiles where id = auth.uid();
  if pr.id is null or pr.role <> 'customer' then raise exception 'only customers can create orders'; end if;

  v_straight := public.distance_km((p->'pickup'->>'lat')::float8, (p->'pickup'->>'lng')::float8,
                                   (p->'dest'->>'lat')::float8, (p->'dest'->>'lng')::float8);
  v_km := round(coalesce((p->>'km')::numeric, v_straight * 1.28), 1);
  if v_km < v_straight * 0.95 or v_km > greatest(v_straight * 2.5, v_straight + 15) then
    v_km := round(v_straight * 1.28, 1);
  end if;
  q := public.quote_price(v_km, (p->>'pallets')::int, (p->>'tier')::public.truck_tier, v_lift, v_helpers);

  insert into public.orders (customer_id, pickup_name, pickup_addr, pickup_lat, pickup_lng,
                             dest_name, dest_addr, dest_lat, dest_lng, pallets, cargo_type, note, truck_tier,
                             need_tail_lift, helpers, cargo_photo_url,
                             estimated_km, distance_source, route_polyline, quoted_price, quote_breakdown,
                             platform_fee, driver_amount, customer_name, customer_phone, customer_company)
  values (pr.id, p->'pickup'->>'name', coalesce(p->'pickup'->>'addr', ''), (p->'pickup'->>'lat')::float8, (p->'pickup'->>'lng')::float8,
          p->'dest'->>'name', coalesce(p->'dest'->>'addr', ''), (p->'dest'->>'lat')::float8, (p->'dest'->>'lng')::float8,
          (p->>'pallets')::int, p->>'cargo_type', coalesce(p->>'note', ''), (p->>'tier')::public.truck_tier,
          v_lift, v_helpers, v_photo,
          v_km, coalesce(p->>'distance_source', 'estimate'), p->'route_polyline', (q->>'total')::int, q,
          (q->>'platform_fee')::int, (q->>'driver_amount')::int, pr.name, pr.phone, pr.company)
  returning * into o;

  insert into public.payments (order_id, customer_id, amount, platform_fee, driver_amount)
  values (o.id, pr.id, o.quoted_price, o.platform_fee, o.driver_amount);
  perform public.log_event(o.id, 'created', pr.id, o.pickup_lat, o.pickup_lng, jsonb_build_object('quote', q));
  return o;
end $$;

-- ---------- 3. Storage bucket：cargo-photos ---------------------------------
-- 公開讀（網址直接可看，司機端／後台不需簽章）；只有登入的客戶能上傳到自己的資料夾
-- （物件路徑：<customer uuid>/<timestamp>.jpg）。本機測試用的純 Postgres 沒有 storage schema，故整段守護。
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not present (local test db) - skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('cargo-photos', 'cargo-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do update set public = excluded.public,
                                file_size_limit = excluded.file_size_limit,
                                allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "cargo photos public read" on storage.objects';
  execute $p$create policy "cargo photos public read" on storage.objects
            for select using (bucket_id = 'cargo-photos')$p$;

  execute 'drop policy if exists "cargo photos owner upload" on storage.objects';
  execute $p$create policy "cargo photos owner upload" on storage.objects
            for insert to authenticated
            with check (bucket_id = 'cargo-photos' and (storage.foldername(name))[1] = auth.uid()::text)$p$;

  execute 'drop policy if exists "cargo photos owner delete" on storage.objects';
  execute $p$create policy "cargo photos owner delete" on storage.objects
            for delete to authenticated
            using (bucket_id = 'cargo-photos' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end $$;

-- 0009: 管理員帳號也能以客戶身分下單（測試用同一個帳號）；並把 Tim 的帳號設為管理員
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
  if pr.id is null or pr.role not in ('customer', 'admin') then raise exception 'only customers can create orders'; end if;
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

update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'tim909tim909@gmail.com');

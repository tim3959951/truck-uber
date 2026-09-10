-- ============================================================================
-- 0002 · Add-ons: 升降尾門 (tail lift) + 隨車搬運工 (helpers)
-- Two customer-selectable extras with configurable fees; tail lift is also a
-- dispatch filter (only vehicles that have one receive such orders).
-- ============================================================================

alter table public.pricing_config
  add column if not exists tail_lift_fee integer not null default 1000,    -- 每趟：車輛需配備油壓升降尾門
  add column if not exists helper_fee    integer not null default 3000;   -- 每人每趟：專業隨車搬運工

alter table public.vehicles
  add column if not exists has_tail_lift boolean not null default false;

alter table public.orders
  add column if not exists need_tail_lift boolean not null default false,
  add column if not exists helpers integer not null default 0 check (helpers between 0 and 2);

-- ---------- sign-up metadata now accepts has_tail_lift ----------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := 'customer';
  v_driver uuid;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if v_meta->>'role' in ('customer', 'driver') then
    v_role := (v_meta->>'role')::public.user_role;
  end if;
  insert into public.profiles (id, role, name, phone, company)
  values (new.id, v_role, coalesce(v_meta->>'name', ''), coalesce(v_meta->>'phone', ''), coalesce(v_meta->>'company', ''));
  if v_role = 'driver' then
    insert into public.drivers (profile_id) values (new.id) returning id into v_driver;
    if coalesce(v_meta->>'plate', '') <> '' then
      insert into public.vehicles (driver_id, plate, make_model, has_tail_lift)
      values (v_driver, upper(v_meta->>'plate'), coalesce(v_meta->>'make_model', ''),
              coalesce((v_meta->>'has_tail_lift')::boolean, false));
    end if;
  end if;
  return new;
end $$;

-- ---------- pricing: base + pallets get the tier multiplier; add-ons are flat ---
drop function if exists public.quote_price(numeric, integer, public.truck_tier);
create or replace function public.quote_price(p_km numeric, p_pallets integer, p_tier public.truck_tier,
                                              p_tail_lift boolean default false, p_helpers integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.pricing_config%rowtype;
  v_dist integer; v_pal integer; v_sub integer; v_mult numeric; v_base integer;
  v_lift integer; v_help integer; v_total integer; v_fee integer;
begin
  select * into c from public.pricing_config where id = 1;
  v_dist := c.base_fare + round(p_km * c.per_km);
  v_pal  := p_pallets * c.per_pallet;
  v_sub  := v_dist + v_pal;
  v_mult := case p_tier when 'backhaul' then c.backhaul_multiplier else c.dedicated_multiplier end;
  v_base := round(v_sub * v_mult / 10) * 10;
  v_lift := case when p_tail_lift then c.tail_lift_fee else 0 end;
  v_help := greatest(0, least(2, coalesce(p_helpers, 0))) * c.helper_fee;
  v_total := v_base + v_lift + v_help;
  v_fee := round(v_total * c.platform_fee_rate);
  return jsonb_build_object(
    'km', p_km, 'pallets', p_pallets, 'tier', p_tier,
    'distance_fee', v_dist, 'pallet_fee', v_pal, 'subtotal', v_sub,
    'multiplier', v_mult, 'base_total', v_base,
    'tail_lift', p_tail_lift, 'tail_lift_fee', v_lift,
    'helpers', greatest(0, least(2, coalesce(p_helpers, 0))), 'helper_fee', v_help,
    'total', v_total, 'platform_fee', v_fee, 'driver_amount', v_total - v_fee,
    'config', jsonb_build_object('base_fare', c.base_fare, 'per_km', c.per_km, 'per_pallet', c.per_pallet,
                                 'tail_lift_fee', c.tail_lift_fee, 'helper_fee', c.helper_fee));
end $$;

-- ---------- create_order reads the add-ons ---------------------------------
create or replace function public.create_order(p jsonb)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  pr public.profiles%rowtype;
  v_km numeric; v_straight numeric; q jsonb;
  v_lift boolean := coalesce((p->>'need_tail_lift')::boolean, false);
  v_helpers integer := greatest(0, least(2, coalesce((p->>'helpers')::int, 0)));
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
                             need_tail_lift, helpers,
                             estimated_km, distance_source, route_polyline, quoted_price, quote_breakdown,
                             platform_fee, driver_amount, customer_name, customer_phone, customer_company)
  values (pr.id, p->'pickup'->>'name', coalesce(p->'pickup'->>'addr', ''), (p->'pickup'->>'lat')::float8, (p->'pickup'->>'lng')::float8,
          p->'dest'->>'name', coalesce(p->'dest'->>'addr', ''), (p->'dest'->>'lat')::float8, (p->'dest'->>'lng')::float8,
          (p->>'pallets')::int, p->>'cargo_type', coalesce(p->>'note', ''), (p->>'tier')::public.truck_tier,
          v_lift, v_helpers,
          v_km, coalesce(p->>'distance_source', 'estimate'), p->'route_polyline', (q->>'total')::int, q,
          (q->>'platform_fee')::int, (q->>'driver_amount')::int, pr.name, pr.phone, pr.company)
  returning * into o;

  insert into public.payments (order_id, customer_id, amount, platform_fee, driver_amount)
  values (o.id, pr.id, o.quoted_price, o.platform_fee, o.driver_amount);
  perform public.log_event(o.id, 'created', pr.id, o.pickup_lat, o.pickup_lng, jsonb_build_object('quote', q));
  return o;
end $$;

-- ---------- dispatch: tail-lift orders only go to tail-lift vehicles ---------
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
    and v.capacity_pallets >= o.pallets
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

-- a driver may flag their own vehicle's tail lift (admin can too)
drop policy if exists vehicles_update_own on public.vehicles;
create policy vehicles_update_own on public.vehicles for update to authenticated
  using (driver_id = public.my_driver_id()) with check (driver_id = public.my_driver_id());

revoke execute on function public.dispatch_order(uuid) from public, anon, authenticated;

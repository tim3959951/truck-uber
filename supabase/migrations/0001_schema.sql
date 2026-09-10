-- ============================================================================
-- 大車叫車 · Phase 1B schema
-- Postgres 15+/Supabase. Run with `supabase db push` (or paste into SQL editor).
-- Everything the apps do goes through RPCs (SECURITY DEFINER) so the state
-- machine, pricing and ledgers are enforced server-side. Tables are read via
-- RLS; direct writes from clients are not allowed except where noted.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- enums ----------------------------------------------------------
create type public.user_role as enum ('customer', 'driver', 'admin');
create type public.verification_status as enum ('pending', 'verified', 'rejected');
create type public.truck_tier as enum ('dedicated', 'backhaul');
create type public.order_status as enum (
  'created',      -- quote accepted, waiting for payment
  'searching',    -- paid, looking for a driver
  'offered',      -- offered to one driver, countdown running
  'accepted',     -- driver assigned, heading to pickup
  'arrived',      -- driver at pickup, loading
  'in_transit',   -- loaded, driving to destination
  'delivered',    -- at destination, unloading
  'completed',
  'cancelled'
);
create type public.order_event_type as enum (
  'created', 'paid', 'offered', 'accepted', 'declined', 'offer_expired',
  'driver_arrived', 'loading_completed', 'in_transit', 'destination_arrived',
  'delivered', 'completed', 'cancelled', 'rated', 'admin_note'
);
create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type public.earning_status as enum ('pending', 'available', 'paid', 'cancelled');

-- ---------- tables ---------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'customer',
  name        text not null default '',
  phone       text not null default '',
  company     text not null default '',
  created_at  timestamptz not null default now()
);

create table public.operators (
  id                  uuid primary key default gen_random_uuid(),
  company_name        text not null,
  tax_id              text,
  phone               text,
  verification_status public.verification_status not null default 'pending',
  created_at          timestamptz not null default now()
);

create table public.drivers (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null unique references public.profiles (id) on delete cascade,
  operator_id         uuid references public.operators (id) on delete set null,
  rating              numeric(3,2) not null default 5.00,
  rating_count        integer not null default 0,
  trips_count         integer not null default 0,
  online              boolean not null default false,
  verification_status public.verification_status not null default 'pending',
  created_at          timestamptz not null default now()
);

create table public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.drivers (id) on delete cascade,
  plate               text not null,
  truck_type          text not null default '17t_truck',   -- 17t_truck | semi_trailer (phase 2)
  make_model          text not null default '',
  capacity_tons       numeric(5,1) not null default 17,
  capacity_pallets    integer not null default 16,
  active              boolean not null default true,
  verification_status public.verification_status not null default 'pending',
  created_at          timestamptz not null default now()
);
create unique index vehicles_plate_idx on public.vehicles (upper(plate));

-- latest known position per driver (one row per driver, upserted)
create table public.driver_locations (
  driver_id   uuid primary key references public.drivers (id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  heading     double precision,
  speed       double precision,
  updated_at  timestamptz not null default now()
);

create sequence public.order_no_seq start 3000;

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_no            text not null unique default ('TK-' || nextval('public.order_no_seq')),
  customer_id         uuid not null references public.profiles (id),
  driver_id           uuid references public.drivers (id),
  vehicle_id          uuid references public.vehicles (id),
  offered_driver_id   uuid references public.drivers (id),
  offer_expires_at    timestamptz,
  declined_driver_ids uuid[] not null default '{}',
  -- pickup / destination (snapshots; free text + coordinates)
  pickup_name         text not null,
  pickup_addr         text not null default '',
  pickup_lat          double precision not null,
  pickup_lng          double precision not null,
  dest_name           text not null,
  dest_addr           text not null default '',
  dest_lat            double precision not null,
  dest_lng            double precision not null,
  -- cargo
  pallets             integer not null check (pallets between 1 and 64),
  cargo_type          text not null,
  note                text not null default '',
  truck_tier          public.truck_tier not null default 'dedicated',
  -- routing + quote (server computed from pricing_config)
  estimated_km        numeric(8,1) not null,
  distance_source     text not null default 'estimate',   -- osrm | google | estimate
  route_polyline      jsonb,                                -- [[lat,lng], ...]
  quoted_price        integer not null,
  quote_breakdown     jsonb not null,
  platform_fee        integer not null default 0,
  driver_amount       integer not null default 0,
  -- state
  status              public.order_status not null default 'created',
  -- party snapshots so each side can render the other without cross-table RLS
  customer_name       text not null default '',
  customer_phone      text not null default '',
  customer_company    text not null default '',
  driver_name         text,
  driver_phone        text,
  driver_rating       numeric(3,2),
  vehicle_plate       text,
  vehicle_desc        text,
  -- rating
  rating              smallint check (rating between 1 and 5),
  rating_tags         text[],
  -- timestamps
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  accepted_at         timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_driver_idx on public.orders (driver_id, created_at desc);
create index orders_offered_idx on public.orders (offered_driver_id) where status = 'offered';
create index orders_searching_idx on public.orders (created_at) where status = 'searching';
alter table public.orders replica identity full;

-- immutable event log
create table public.order_events (
  id          bigserial primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  event_type  public.order_event_type not null,
  actor_id    uuid,                       -- profile id (null = system)
  created_at  timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  metadata    jsonb not null default '{}'
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- low-frequency GPS trail during an active trip (≤ 1 point / 30 s / order)
create table public.order_track_points (
  id          bigserial primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  driver_id   uuid not null references public.drivers (id),
  lat         double precision not null,
  lng         double precision not null,
  heading     double precision,
  created_at  timestamptz not null default now()
);
create index order_track_points_idx on public.order_track_points (order_id, created_at);

create table public.payments (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null unique references public.orders (id) on delete cascade,
  customer_id             uuid not null references public.profiles (id),
  amount                  integer not null,
  platform_fee            integer not null,
  driver_amount           integer not null,
  status                  public.payment_status not null default 'pending',
  provider                text not null default 'sandbox',   -- sandbox | tappay | ecpay | stripe ...
  provider_transaction_id text,
  created_at              timestamptz not null default now(),
  paid_at                 timestamptz,
  refunded_at             timestamptz
);

-- earnings ledger: one row per completed order (never mutate a running balance)
create table public.driver_earnings (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers (id),
  order_id      uuid not null unique references public.orders (id),
  gross_amount  integer not null,
  platform_fee  integer not null,
  driver_amount integer not null,
  status        public.earning_status not null default 'pending',
  created_at    timestamptz not null default now(),
  available_at  timestamptz,
  paid_at       timestamptz
);
create index driver_earnings_driver_idx on public.driver_earnings (driver_id, created_at desc);

create table public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  token       text not null,
  platform    text not null default 'unknown',
  created_at  timestamptz not null default now(),
  unique (profile_id, token)
);

-- single-row, admin-editable configuration (pricing + dispatch knobs)
create table public.pricing_config (
  id                     integer primary key default 1 check (id = 1),
  base_fare              integer not null default 1500,
  per_km                 integer not null default 38,
  per_pallet             integer not null default 150,
  dedicated_multiplier   numeric(4,2) not null default 1.00,
  backhaul_multiplier    numeric(4,2) not null default 0.75,
  platform_fee_rate      numeric(4,3) not null default 0.150,
  service_radius_km      integer not null default 60,
  offer_timeout_seconds  integer not null default 15,
  earnings_hold_days     integer not null default 7,
  require_verification   boolean not null default false,  -- turn on once admin verifies real drivers
  updated_at             timestamptz not null default now()
);
insert into public.pricing_config (id) values (1);

-- ---------- helpers --------------------------------------------------------
create or replace function public.distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create or replace function public.current_role_of(uid uuid)
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = uid;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_driver_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.drivers where profile_id = auth.uid();
$$;

create or replace function public.log_event(p_order uuid, p_type public.order_event_type, p_actor uuid,
                                            p_lat double precision default null, p_lng double precision default null,
                                            p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.order_events (order_id, event_type, actor_id, lat, lng, metadata)
  values (p_order, p_type, p_actor, p_lat, p_lng, coalesce(p_meta, '{}'));
$$;

-- ---------- auth → profile bootstrap ----------------------------------------
-- Sign-up metadata: { role: 'customer'|'driver', name, phone, company?, plate?, make_model? }
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
      insert into public.vehicles (driver_id, plate, make_model)
      values (v_driver, upper(v_meta->>'plate'), coalesce(v_meta->>'make_model', ''));
    end if;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- pricing engine (server side of truth) --------------------------
create or replace function public.quote_price(p_km numeric, p_pallets integer, p_tier public.truck_tier)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.pricing_config%rowtype;
  v_dist integer; v_pal integer; v_sub integer; v_mult numeric; v_total integer; v_fee integer;
begin
  select * into c from public.pricing_config where id = 1;
  v_dist := c.base_fare + round(p_km * c.per_km);
  v_pal  := p_pallets * c.per_pallet;
  v_sub  := v_dist + v_pal;
  v_mult := case p_tier when 'backhaul' then c.backhaul_multiplier else c.dedicated_multiplier end;
  v_total := round(v_sub * v_mult / 10) * 10;
  v_fee := round(v_total * c.platform_fee_rate);
  return jsonb_build_object(
    'km', p_km, 'pallets', p_pallets, 'tier', p_tier,
    'distance_fee', v_dist, 'pallet_fee', v_pal, 'subtotal', v_sub,
    'multiplier', v_mult, 'total', v_total,
    'platform_fee', v_fee, 'driver_amount', v_total - v_fee,
    'config', jsonb_build_object('base_fare', c.base_fare, 'per_km', c.per_km, 'per_pallet', c.per_pallet));
end $$;

-- ---------- dispatch (nearest eligible online driver) ----------------------
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
    and (not c.require_verification or (d.verification_status = 'verified' and v.verification_status = 'verified'))
    -- not busy with another live order
    and not exists (select 1 from public.orders x where (x.driver_id = d.id or x.offered_driver_id = d.id)
                    and x.status in ('offered', 'accepted', 'arrived', 'in_transit', 'delivered'))
    -- within service radius when we know where they are (stale > 15 min = unknown)
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

-- ---------- customer RPCs --------------------------------------------------
-- p: { pickup:{name,addr,lat,lng}, dest:{name,addr,lat,lng}, pallets, cargo_type, note, tier,
--      km, distance_source, route_polyline }
create or replace function public.create_order(p jsonb)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  pr public.profiles%rowtype;
  v_km numeric; v_straight numeric; q jsonb;
begin
  select * into pr from public.profiles where id = auth.uid();
  if pr.id is null or pr.role <> 'customer' then raise exception 'only customers can create orders'; end if;

  v_straight := public.distance_km((p->'pickup'->>'lat')::float8, (p->'pickup'->>'lng')::float8,
                                   (p->'dest'->>'lat')::float8, (p->'dest'->>'lng')::float8);
  v_km := round(coalesce((p->>'km')::numeric, v_straight * 1.28), 1);
  -- sanity: the client supplied road distance must be plausible vs. straight line
  if v_km < v_straight * 0.95 or v_km > greatest(v_straight * 2.5, v_straight + 15) then
    v_km := round(v_straight * 1.28, 1);
  end if;
  q := public.quote_price(v_km, (p->>'pallets')::int, (p->>'tier')::public.truck_tier);

  insert into public.orders (customer_id, pickup_name, pickup_addr, pickup_lat, pickup_lng,
                             dest_name, dest_addr, dest_lat, dest_lng, pallets, cargo_type, note, truck_tier,
                             estimated_km, distance_source, route_polyline, quoted_price, quote_breakdown,
                             platform_fee, driver_amount, customer_name, customer_phone, customer_company)
  values (pr.id, p->'pickup'->>'name', coalesce(p->'pickup'->>'addr', ''), (p->'pickup'->>'lat')::float8, (p->'pickup'->>'lng')::float8,
          p->'dest'->>'name', coalesce(p->'dest'->>'addr', ''), (p->'dest'->>'lat')::float8, (p->'dest'->>'lng')::float8,
          (p->>'pallets')::int, p->>'cargo_type', coalesce(p->>'note', ''), (p->>'tier')::public.truck_tier,
          v_km, coalesce(p->>'distance_source', 'estimate'), p->'route_polyline', (q->>'total')::int, q,
          (q->>'platform_fee')::int, (q->>'driver_amount')::int, pr.name, pr.phone, pr.company)
  returning * into o;

  insert into public.payments (order_id, customer_id, amount, platform_fee, driver_amount)
  values (o.id, pr.id, o.quoted_price, o.platform_fee, o.driver_amount);
  perform public.log_event(o.id, 'created', pr.id, o.pickup_lat, o.pickup_lng, jsonb_build_object('quote', q));
  return o;
end $$;

-- Sandbox payment: marks the payment paid and starts dispatch. A real provider
-- adapter later replaces the body (webhook → same state change).
create or replace function public.pay_order_sandbox(p_order uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status <> 'created' then raise exception 'order is not awaiting payment'; end if;
  update public.payments set status = 'paid', paid_at = now(), provider = 'sandbox',
         provider_transaction_id = 'sandbox_' || replace(gen_random_uuid()::text, '-', '')
   where order_id = p_order;
  update public.orders set status = 'searching', paid_at = now() where id = p_order returning * into o;
  perform public.log_event(p_order, 'paid', auth.uid(), null, null, jsonb_build_object('provider', 'sandbox', 'amount', o.quoted_price));
  return public.dispatch_order(p_order);
end $$;

-- Customer app calls this while searching/offered (every few seconds):
-- expires a stale offer and tries the next driver.
create or replace function public.poll_order(p_order uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order
    and (customer_id = auth.uid() or public.is_admin()) for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status = 'offered' and o.offer_expires_at < now() then
    perform public.log_event(o.id, 'offer_expired', null, null, null, jsonb_build_object('driver_id', o.offered_driver_id));
    update public.orders set status = 'searching', declined_driver_ids = array_append(declined_driver_ids, offered_driver_id),
           offered_driver_id = null, offer_expires_at = null where id = o.id;
    return public.dispatch_order(o.id);
  elsif o.status = 'searching' then
    return public.dispatch_order(o.id);
  end if;
  return o;
end $$;

create or replace function public.cancel_order(p_order uuid, p_reason text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'order not found'; end if;
  if not (o.customer_id = auth.uid() or public.is_admin()) then raise exception 'not allowed'; end if;
  if o.status in ('completed', 'cancelled') then raise exception 'order already closed'; end if;
  if o.customer_id = auth.uid() and not public.is_admin() and o.status not in ('created', 'searching', 'offered', 'accepted') then
    raise exception 'cannot cancel after loading has started';
  end if;
  update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
         offered_driver_id = null, offer_expires_at = null where id = p_order returning * into o;
  update public.payments set status = 'refunded', refunded_at = now() where order_id = p_order and status = 'paid';
  update public.driver_earnings set status = 'cancelled' where order_id = p_order;
  perform public.log_event(p_order, 'cancelled', auth.uid(), null, null, jsonb_build_object('reason', p_reason));
  return o;
end $$;

create or replace function public.rate_order(p_order uuid, p_stars integer, p_tags text[] default '{}')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status <> 'completed' then raise exception 'order not completed'; end if;
  if o.rating is not null then return o; end if;
  update public.orders set rating = p_stars, rating_tags = p_tags where id = p_order returning * into o;
  update public.drivers d
     set rating = round(((d.rating * d.rating_count) + p_stars) / (d.rating_count + 1.0), 2),
         rating_count = d.rating_count + 1
   where d.id = o.driver_id;
  perform public.log_event(p_order, 'rated', auth.uid(), null, null, jsonb_build_object('stars', p_stars, 'tags', p_tags));
  return o;
end $$;

-- ---------- driver RPCs ----------------------------------------------------
create or replace function public.driver_set_online(p_online boolean, p_lat double precision default null, p_lng double precision default null)
returns public.drivers language plpgsql security definer set search_path = public as $$
declare d public.drivers%rowtype; r record;
begin
  select * into d from public.drivers where profile_id = auth.uid() for update;
  if d.id is null then raise exception 'not a driver'; end if;
  update public.drivers set online = p_online where id = d.id returning * into d;
  if p_lat is not null and p_lng is not null then
    insert into public.driver_locations (driver_id, lat, lng) values (d.id, p_lat, p_lng)
    on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
  end if;
  if p_online then
    -- someone may already be waiting: try to dispatch queued orders
    for r in select id from public.orders where status = 'searching' order by created_at loop
      perform public.dispatch_order(r.id);
    end loop;
  else
    -- release any un-answered offer so it can go to someone else
    update public.orders set status = 'searching', offered_driver_id = null, offer_expires_at = null,
           declined_driver_ids = array_append(declined_driver_ids, d.id)
     where offered_driver_id = d.id and status = 'offered';
  end if;
  return d;
end $$;

create or replace function public.respond_offer(p_order uuid, p_accept boolean)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; d public.drivers%rowtype; v public.vehicles%rowtype; pr public.profiles%rowtype;
begin
  select * into d from public.drivers where profile_id = auth.uid();
  if d.id is null then raise exception 'not a driver'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.offered_driver_id is distinct from d.id or o.status <> 'offered' then
    raise exception 'offer is no longer available';
  end if;
  if not p_accept or o.offer_expires_at < now() then
    perform public.log_event(o.id, (case when p_accept then 'offer_expired' else 'declined' end)::public.order_event_type, auth.uid(), null, null, jsonb_build_object('driver_id', d.id));
    update public.orders set status = 'searching', offered_driver_id = null, offer_expires_at = null,
           declined_driver_ids = array_append(declined_driver_ids, d.id) where id = o.id;
    return public.dispatch_order(o.id);
  end if;
  select * into v from public.vehicles where driver_id = d.id and active order by created_at limit 1;
  select * into pr from public.profiles where id = auth.uid();
  update public.orders
     set status = 'accepted', driver_id = d.id, vehicle_id = v.id, accepted_at = now(),
         offered_driver_id = null, offer_expires_at = null,
         driver_name = pr.name, driver_phone = pr.phone, driver_rating = d.rating,
         vehicle_plate = v.plate, vehicle_desc = coalesce(nullif(v.make_model, ''), v.truck_type) || ' · ' || v.capacity_tons || '噸'
   where id = o.id returning * into o;
  perform public.log_event(o.id, 'accepted', auth.uid(), null, null, jsonb_build_object('driver_id', d.id, 'vehicle_id', v.id));
  return o;
end $$;

-- Driver moves the order forward. Allowed: accepted→arrived→in_transit→delivered→completed
create or replace function public.advance_order(p_order uuid, p_next public.order_status,
                                                p_lat double precision default null, p_lng double precision default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; d public.drivers%rowtype; c public.pricing_config%rowtype; ok boolean;
begin
  select * into d from public.drivers where profile_id = auth.uid();
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.driver_id is distinct from d.id then raise exception 'not your order'; end if;
  ok := (o.status, p_next) in (('accepted','arrived'), ('arrived','in_transit'), ('in_transit','delivered'), ('delivered','completed'));
  if not ok then raise exception 'invalid transition % -> %', o.status, p_next; end if;

  update public.orders set status = p_next,
         completed_at = case when p_next = 'completed' then now() else completed_at end
   where id = p_order returning * into o;

  case p_next
    when 'arrived' then perform public.log_event(o.id, 'driver_arrived', auth.uid(), p_lat, p_lng);
    when 'in_transit' then
      perform public.log_event(o.id, 'loading_completed', auth.uid(), p_lat, p_lng);
      perform public.log_event(o.id, 'in_transit', auth.uid(), p_lat, p_lng);
    when 'delivered' then perform public.log_event(o.id, 'destination_arrived', auth.uid(), p_lat, p_lng);
    when 'completed' then
      perform public.log_event(o.id, 'delivered', auth.uid(), p_lat, p_lng);
      perform public.log_event(o.id, 'completed', auth.uid(), p_lat, p_lng);
      select * into c from public.pricing_config where id = 1;
      update public.drivers set trips_count = trips_count + 1 where id = d.id;
      insert into public.driver_earnings (driver_id, order_id, gross_amount, platform_fee, driver_amount, status, available_at)
      values (d.id, o.id, o.quoted_price, o.platform_fee, o.driver_amount, 'pending', now() + make_interval(days => c.earnings_hold_days))
      on conflict (order_id) do nothing;
    else null;
  end case;
  return o;
end $$;

create or replace function public.update_driver_location(p_lat double precision, p_lng double precision,
                                                        p_heading double precision default null, p_speed double precision default null)
returns void language plpgsql security definer set search_path = public as $$
declare d_id uuid; o_id uuid; last_at timestamptz;
begin
  select id into d_id from public.drivers where profile_id = auth.uid();
  if d_id is null then raise exception 'not a driver'; end if;
  insert into public.driver_locations (driver_id, lat, lng, heading, speed)
  values (d_id, p_lat, p_lng, p_heading, p_speed)
  on conflict (driver_id) do update
    set lat = excluded.lat, lng = excluded.lng, heading = excluded.heading, speed = excluded.speed, updated_at = now();
  -- sparse trail while on an active trip
  select id into o_id from public.orders where driver_id = d_id and status in ('accepted','arrived','in_transit','delivered') limit 1;
  if o_id is not null then
    select max(created_at) into last_at from public.order_track_points where order_id = o_id;
    if last_at is null or last_at < now() - interval '30 seconds' then
      insert into public.order_track_points (order_id, driver_id, lat, lng, heading) values (o_id, d_id, p_lat, p_lng, p_heading);
    end if;
  end if;
end $$;

-- Earnings summary derived from the ledger (never a stored balance)
create or replace function public.my_earnings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d_id uuid; v_today integer; v_week jsonb; v_trips integer; v_available integer; v_pending integer; v_recent jsonb;
  v_week_start date := date_trunc('week', (now() at time zone 'Asia/Taipei'))::date;
begin
  select id into d_id from public.drivers where profile_id = auth.uid();
  if d_id is null then raise exception 'not a driver'; end if;
  select coalesce(sum(driver_amount), 0), count(*) into v_today, v_trips
    from public.driver_earnings where driver_id = d_id and status <> 'cancelled'
     and (created_at at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date;
  select coalesce(jsonb_agg(coalesce(s, 0) order by dow), '[]') into v_week from (
    select g.dow, (select sum(e.driver_amount) from public.driver_earnings e
                   where e.driver_id = d_id and e.status <> 'cancelled'
                     and (e.created_at at time zone 'Asia/Taipei')::date = v_week_start + g.dow) as s
    from generate_series(0, 6) as g(dow)) w;
  select coalesce(sum(driver_amount), 0) into v_available from public.driver_earnings
    where driver_id = d_id and (status = 'available' or (status = 'pending' and available_at <= now()));
  select coalesce(sum(driver_amount), 0) into v_pending from public.driver_earnings
    where driver_id = d_id and status = 'pending' and available_at > now();
  select coalesce(jsonb_agg(jsonb_build_object('order_id', e.order_id, 'order_no', o.order_no, 'from', o.pickup_name, 'to', o.dest_name,
           'pallets', o.pallets, 'cargo_type', o.cargo_type, 'gross', e.gross_amount, 'driver_amount', e.driver_amount,
           'status', e.status, 'created_at', e.created_at) order by e.created_at desc), '[]')
    into v_recent
    from (select * from public.driver_earnings where driver_id = d_id order by created_at desc limit 20) e
    join public.orders o on o.id = e.order_id;
  return jsonb_build_object('today', v_today, 'trips_today', v_trips, 'week', v_week, 'week_start', v_week_start,
                            'available', v_available, 'pending', v_pending, 'recent', v_recent);
end $$;

create or replace function public.register_push_token(p_token text, p_platform text default 'unknown')
returns void language sql security definer set search_path = public as $$
  insert into public.device_tokens (profile_id, token, platform) values (auth.uid(), p_token, p_platform)
  on conflict (profile_id, token) do update set platform = excluded.platform;
$$;

-- ---------- push notifications via pg_net → Expo Push API -------------------
-- No-op when pg_net is not installed (e.g. local tests). Enable in Supabase:
-- Database → Extensions → pg_net.
create or replace function public.push_to_profile(p_profile uuid, p_title text, p_body text, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare msgs jsonb;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  select jsonb_agg(jsonb_build_object('to', token, 'title', p_title, 'body', p_body, 'sound', 'default', 'data', p_data, 'priority', 'high'))
    into msgs from public.device_tokens where profile_id = p_profile;
  if msgs is null then return; end if;
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,
    body := msgs);
end $$;

create or replace function public.notify_order_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_profile uuid; d jsonb;
begin
  if tg_op = 'UPDATE' and new.status = old.status and new.offered_driver_id is not distinct from old.offered_driver_id then return new; end if;
  d := jsonb_build_object('order_id', new.id, 'status', new.status);
  if new.status = 'offered' and new.offered_driver_id is not null then
    select profile_id into v_profile from public.drivers where id = new.offered_driver_id;
    perform public.push_to_profile(v_profile, '新訂單', new.pallets || ' 托 ' || new.cargo_type || ' · ' || new.pickup_name || ' → ' || new.dest_name || ' · NT$ ' || new.quoted_price, d);
  elsif new.status = 'accepted' then
    perform public.push_to_profile(new.customer_id, '司機已接單', coalesce(new.driver_name, '司機') || '（' || coalesce(new.vehicle_plate, '') || '）正前往裝貨點', d);
  elsif new.status = 'arrived' then
    perform public.push_to_profile(new.customer_id, '司機已抵達', '大車已到 ' || new.pickup_name || '，請開始裝貨', d);
  elsif new.status = 'delivered' then
    perform public.push_to_profile(new.customer_id, '已抵達卸貨點', '大車已到 ' || new.dest_name, d);
  elsif new.status = 'completed' then
    perform public.push_to_profile(new.customer_id, '運送完成', new.order_no || ' 已完成，請為司機評分', d);
  elsif new.status = 'cancelled' and new.driver_id is not null then
    select profile_id into v_profile from public.drivers where id = new.driver_id;
    perform public.push_to_profile(v_profile, '訂單已取消', new.order_no || ' 已被取消', d);
  end if;
  return new;
end $$;

create trigger orders_notify after update on public.orders
  for each row execute function public.notify_order_change();

-- ---------- row level security ---------------------------------------------
alter table public.profiles enable row level security;
alter table public.operators enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.driver_locations enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.order_track_points enable row level security;
alter table public.payments enable row level security;
alter table public.driver_earnings enable row level security;
alter table public.device_tokens enable row level security;
alter table public.pricing_config enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy operators_select on public.operators for select to authenticated using (true);
create policy operators_admin on public.operators for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy drivers_select on public.drivers for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy drivers_admin_update on public.drivers for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy vehicles_select on public.vehicles for select to authenticated
  using (driver_id = public.my_driver_id() or public.is_admin());
create policy vehicles_insert_own on public.vehicles for insert to authenticated with check (driver_id = public.my_driver_id());
create policy vehicles_admin_update on public.vehicles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy driver_locations_select on public.driver_locations for select to authenticated
  using (driver_id = public.my_driver_id() or public.is_admin()
         or exists (select 1 from public.orders o where o.driver_id = driver_locations.driver_id
                    and o.customer_id = auth.uid() and o.status in ('accepted','arrived','in_transit','delivered')));

create policy orders_select on public.orders for select to authenticated
  using (customer_id = auth.uid() or driver_id = public.my_driver_id() or offered_driver_id = public.my_driver_id() or public.is_admin());

create policy order_events_select on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_events.order_id
                 and (o.customer_id = auth.uid() or o.driver_id = public.my_driver_id() or public.is_admin())));

create policy order_track_points_select on public.order_track_points for select to authenticated
  using (driver_id = public.my_driver_id() or public.is_admin()
         or exists (select 1 from public.orders o where o.id = order_track_points.order_id and o.customer_id = auth.uid()));

create policy payments_select on public.payments for select to authenticated using (customer_id = auth.uid() or public.is_admin());
create policy driver_earnings_select on public.driver_earnings for select to authenticated
  using (driver_id = public.my_driver_id() or public.is_admin());
create policy driver_earnings_admin_update on public.driver_earnings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy device_tokens_own on public.device_tokens for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy pricing_config_select on public.pricing_config for select to authenticated using (true);
create policy pricing_config_admin on public.pricing_config for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- grants ---------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert on public.vehicles, public.device_tokens, public.operators to authenticated;
grant update (name, phone, company) on public.profiles to authenticated;  -- role is never client-editable
grant update on public.drivers, public.vehicles, public.operators, public.pricing_config, public.device_tokens, public.driver_earnings to authenticated;
grant delete on public.device_tokens to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
-- internal-only functions: callable from other SECURITY DEFINER functions, never from clients
revoke execute on function public.dispatch_order(uuid) from public, anon, authenticated;
revoke execute on function public.log_event(uuid, public.order_event_type, uuid, double precision, double precision, jsonb) from public, anon, authenticated;
revoke execute on function public.push_to_profile(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.current_role_of(uuid) from public, anon, authenticated;

-- ---------- realtime -------------------------------------------------------
-- Supabase creates the publication; add our tables. Row filters honour RLS.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders, public.driver_locations, public.order_events;
  end if;
end $$;

-- End-to-end exercise of the order state machine on a plain Postgres.
-- Requires local_auth_stub.sql + 0001_schema.sql. Run with ON_ERROR_STOP.
\set ON_ERROR_STOP on
\set QUIET on
begin;
-- superuser-owned peek helper so assertions are not confused by RLS
create function pg_temp.o(p uuid) returns public.orders language sql security definer as $$ select * from public.orders where id = p $$;
create function pg_temp.d(p uuid) returns public.drivers language sql security definer as $$ select * from public.drivers where profile_id = p $$;

-- --- users (simulates Supabase Auth sign-up with metadata) -----------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'customer@test.tw', '{"role":"customer","name":"王先生","phone":"0912-345-678","company":"大明園藝資材行"}'),
  ('22222222-2222-2222-2222-222222222222', 'driver@test.tw',   '{"role":"driver","name":"陳建宏","phone":"0988-123-456","plate":"KEA-5177","make_model":"HINO 700"}'),
  ('33333333-3333-3333-3333-333333333333', 'driver2@test.tw',  '{"role":"driver","name":"林小華","phone":"0955-000-111","plate":"ABC-1234"}'),
  ('44444444-4444-4444-4444-444444444444', 'admin@test.tw',    '{"role":"customer","name":"Admin"}');
update public.profiles set role = 'admin' where id = '44444444-4444-4444-4444-444444444444';

-- 0014 ships with phone verification required in production; the tests exercise that in their own
-- block near the end and run with it off elsewhere.
update public.pricing_config set require_phone_verification = false where id = 1;

-- 0006: carriers must pass eligibility review before going online; approve both test drivers up front
select auth.login('44444444-4444-4444-4444-444444444444');
select public.review_onboarding(id, 'approved', 'test') from public.drivers;
reset role;
do $$ begin
  assert (select count(*) from public.profiles) = 4, 'profiles created by trigger';
  assert (select count(*) from public.drivers) = 2, 'driver rows created';
  assert (select plate from public.vehicles v join public.drivers d on d.id = v.driver_id where d.profile_id = '22222222-2222-2222-2222-222222222222') = 'KEA-5177', 'vehicle created from metadata';
end $$;

-- --- pricing ---------------------------------------------------------------
do $$ declare q jsonb; begin
  q := public.quote_price(131, 8, 'dedicated');
  assert (q->>'total')::int = round((1500 + 131*38 + 8*150) / 10.0) * 10, 'dedicated total = ' || (q->>'total');
  q := public.quote_price(131, 8, 'backhaul');
  assert (q->>'total')::int = round((1500 + 131*38 + 8*150) * 0.75 / 10) * 10, 'backhaul total = ' || (q->>'total');
  assert (q->>'platform_fee')::int = round((q->>'total')::int * 0.15), 'platform fee 15%';
  -- add-ons: flat fees on top of the tiered base
  q := public.quote_price(131, 8, 'backhaul', true, 2);
  assert (q->>'total')::int = round((1500 + 131*38 + 8*150) * 0.75 / 10) * 10 + 1000 + 2*3000, 'addons total = ' || (q->>'total');
  assert (q->>'tail_lift_fee')::int = 1000 and (q->>'helper_fee')::int = 6000, 'addon breakdown';
end $$;

-- --- customer creates + pays; no driver online yet -> stays searching -------
set role authenticated;
select auth.login('11111111-1111-1111-1111-111111111111');
create temp table t as select * from public.create_order('{
  "pickup": {"name":"觀音工業區","addr":"桃園市觀音區工業二路 88 號","lat":25.0405,"lng":121.0942},
  "dest":   {"name":"台中港區 倉儲","addr":"台中市梧棲區臨港路四段 2 號","lat":24.2802,"lng":120.5265},
  "pallets": 8, "cargo_type": "培養土 / 肥料", "note": "怕雨淋", "tier": "dedicated",
  "km": 131.4, "distance_source": "osrm", "route_polyline": [[25.04,121.09],[24.28,120.52]]}'::jsonb);
do $$ declare o public.orders; begin
  select * into o from t;
  assert o.status = 'created', 'created';
  assert o.estimated_km = 131.4, 'km kept: ' || o.estimated_km;
  assert o.quoted_price = round((1500 + round(131.4*38) + 8*150) / 10.0) * 10, 'price ' || o.quoted_price;
  assert o.customer_name = '王先生', 'customer snapshot';
  assert (select status from public.payments where order_id = o.id) = 'pending', 'payment pending';
end $$;
-- km sanity check: absurd distance falls back to estimate
do $$ declare o public.orders; begin
  o := public.create_order('{"pickup":{"name":"A","lat":25.0,"lng":121.0},"dest":{"name":"B","lat":25.1,"lng":121.0},"pallets":1,"cargo_type":"x","tier":"dedicated","km":900}'::jsonb);
  assert o.estimated_km < 20, 'fallback km ' || o.estimated_km;
  perform public.cancel_order(o.id, 'test');
end $$;

select public.pay_order_sandbox((select id from t)) \gset paid_
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t));
  assert o.status = 'searching', 'no drivers online -> searching, got ' || o.status;
  assert (select status from public.payments where order_id = o.id) = 'paid', 'payment paid';
end $$;

-- customer cannot see other people's orders / cannot write orders directly
do $$ begin
  assert (select count(*) from public.orders) = 2, 'customer sees own 2 orders';
  begin
    update public.orders set status = 'completed' where id = (select id from t);
    raise exception 'direct update should fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.dispatch_order((select id from t));
    raise exception 'dispatch_order should not be callable';
  exception when insufficient_privilege then null; end;
end $$;

-- --- driver 2 (far away, Kaohsiung) goes online: outside 60 km radius --------
select auth.login('33333333-3333-3333-3333-333333333333');
select public.driver_set_online(true, 22.62, 120.30);
do $$ begin
  assert (pg_temp.o((select id from t))).status = 'searching', 'far driver not offered';
end $$;

-- --- driver 1 goes online near pickup -> gets the offer ----------------------
select auth.login('22222222-2222-2222-2222-222222222222');
select public.driver_set_online(true, 25.09, 121.14);
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t));
  assert o.status = 'offered', 'offered, got ' || o.status;
  assert o.offered_driver_id = public.my_driver_id(), 'offered to nearest driver';
  assert o.offer_expires_at > now(), 'expiry set';
end $$;

-- driver declines -> back to searching, driver excluded, next candidate (driver2 out of radius) -> stays searching
select public.respond_offer((select id from t), false);
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t));
  assert o.status = 'searching', 'declined -> searching, got ' || o.status;
  assert public.my_driver_id() = any(o.declined_driver_ids), 'driver recorded as declined';
end $$;

-- customer polls; nobody eligible now (driver1 declined, driver2 far). Move driver2 closer and poll again.
select auth.login('33333333-3333-3333-3333-333333333333');
select public.update_driver_location(25.05, 121.10, 90, 12);
select auth.login('11111111-1111-1111-1111-111111111111');
select public.poll_order((select id from t));
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t));
  assert o.status = 'offered', 'poll re-dispatched, got ' || o.status;
end $$;

-- simulate expiry (as superuser). 0010: a timeout is NOT a decline — driver2 goes to expired_driver_ids and,
-- since nobody else is eligible, gets a second-round offer straight away (expired list cleared for him).
reset role;
update public.orders set offer_expires_at = now() - interval '1 second' where id = (select id from t);
set role authenticated;
select auth.login('11111111-1111-1111-1111-111111111111');
select public.poll_order((select id from t));
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t));
  assert o.status = 'offered', 'expired -> second chance offer, got ' || o.status;
  assert array_length(o.declined_driver_ids, 1) = 1, 'only the explicit decline is permanent';
  assert coalesce(array_length(o.expired_driver_ids, 1), 0) = 0, 'expired list cleared on re-offer';
  assert (select count(*) from public.order_events where order_id = o.id and event_type = 'offer_expired') = 1, 'offer_expired logged';
  assert (select count(*) from public.order_events where order_id = o.id and event_type = 'offered' and metadata->>'round' = '2') = 1, 'second-round offer logged';
end $$;

-- give driver 1 another chance (admin clears the exclusion list), driver 1 accepts
reset role;
update public.orders set declined_driver_ids = '{}', expired_driver_ids = '{}' where id = (select id from t);
set role authenticated;
select auth.login('33333333-3333-3333-3333-333333333333');
select public.driver_set_online(false);   -- driver 2 leaves
select auth.login('22222222-2222-2222-2222-222222222222');
select public.driver_set_online(true, 25.09, 121.14);
select public.respond_offer((select id from t), true);
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t));
  assert o.status = 'accepted', 'accepted, got ' || o.status;
  assert o.driver_id = public.my_driver_id() and o.vehicle_plate = 'KEA-5177' and o.driver_name = '陳建宏', 'driver snapshot on order';
  assert o.offered_driver_id is null, 'offer cleared';
end $$;

-- --- contract (0005): formed on accept, visible to both parties, immutable ------
do $$ declare c public.contracts; o public.orders; begin
  select * into c from public.contracts where order_id = (select id from t);   -- as the driver (RLS)
  assert c.id is not null, 'contract formed on accept';
  assert c.carrier_type = 'driver' and c.carrier_driver_id = public.my_driver_id(), 'driver is the carrier (no operator)';
  assert c.content->'order'->>'order_no' = (pg_temp.o((select id from t))).order_no, 'order snapshot';
  assert c.content->'carrier'->'vehicle'->>'plate' = 'KEA-5177', 'vehicle snapshot';
  assert c.terms_version = 3 and length(c.terms_text) > 500, 'terms copied (latest version)';
  assert c.content_hash = encode(sha256(convert_to(c.content::text || c.terms_text, 'UTF8')), 'hex'), 'hash matches';
  o := pg_temp.o((select id from t));
  assert o.carrier_type = 'driver' and o.carrier_id = public.my_driver_id() and o.dropoff_at is not null, 'order carries carrier + eta';
  -- driver acknowledges
  c := public.ack_contract(c.id);
  assert c.carrier_ack_at is not null and c.customer_ack_at is null, 'driver ack only';
  -- nobody can edit it
  begin
    update public.contracts set content = '{}'::jsonb where id = c.id;
    raise exception 'contract edit should fail';
  exception when others then
    if sqlerrm not like '%immutable%' and sqlerrm not like '%permission denied%' and sqlerrm not like '%row-level%' then raise; end if;
  end;
end $$;
select auth.login('11111111-1111-1111-1111-111111111111');
do $$ declare c public.contracts; begin
  select * into c from public.contracts where order_id = (select id from t);
  assert c.id is not null, 'customer sees the contract';
  c := public.ack_contract(c.id);
  assert c.customer_ack_at is not null and c.carrier_ack_at is not null, 'both acked';
end $$;
select auth.login('33333333-3333-3333-3333-333333333333');
do $$ begin
  assert (select count(*) from public.contracts where order_id = (select id from t)) = 0, 'other driver cannot see it';
end $$;
select auth.login('22222222-2222-2222-2222-222222222222');
reset role; set role postgres;
do $$ begin
  begin
    delete from public.contracts where order_id = (select id from t);
    raise exception 'delete should fail';
  exception when others then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
end $$;
set role authenticated;
select auth.login('22222222-2222-2222-2222-222222222222');

-- the customer can now see this driver's live location (RLS), but not driver 2's
select auth.login('11111111-1111-1111-1111-111111111111');
do $$ begin
  assert (select count(*) from public.driver_locations) = 1, 'customer sees exactly the assigned driver location';
  assert (select o.vehicle_plate from public.orders o where o.id = (select id from t)) = 'KEA-5177', 'customer sees plate (via RLS)';
end $$;

-- driver cannot skip steps
select auth.login('22222222-2222-2222-2222-222222222222');
do $$ begin
  begin
    perform public.advance_order((select id from t), 'completed');
    raise exception 'skip should fail';
  exception when others then
    if sqlerrm not like 'invalid transition%' then raise; end if;
  end;
end $$;

-- GPS while on trip: trail is sparse (max 1 point per 30 s)
select public.update_driver_location(25.08, 121.13, 200, 15);
select public.update_driver_location(25.07, 121.12, 200, 15);
do $$ begin
  assert (select count(*) from public.order_track_points where order_id = (select id from t)) = 1, 'sparse trail';
end $$;

-- happy path to completion
select public.advance_order((select id from t), 'arrived', 25.0405, 121.0942);
select public.advance_order((select id from t), 'in_transit', 25.0405, 121.0942);
select public.advance_order((select id from t), 'delivered', 24.2802, 120.5265);
select public.advance_order((select id from t), 'completed', 24.2802, 120.5265);
do $$ declare o public.orders; e public.driver_earnings; earn jsonb; begin
  o := pg_temp.o((select id from t));
  assert o.status = 'completed' and o.completed_at is not null, 'completed';
  select * into e from public.driver_earnings where order_id = o.id;
  assert e.driver_amount = o.quoted_price - round(o.quoted_price * 0.15) and e.status = 'pending', 'ledger row: ' || e.driver_amount;
  assert e.available_at > now() + interval '6 days', 'hold period applied';
  assert (select trips_count from public.drivers where id = public.my_driver_id()) = 1, 'trips_count incremented';
  assert (select string_agg(event_type::text, ',' order by id) from public.order_events where order_id = o.id)
         = 'created,paid,offered,declined,offered,offer_expired,offered,offered,accepted,driver_arrived,loading_completed,in_transit,destination_arrived,delivered,completed',
         'event log: ' || (select string_agg(event_type::text, ',' order by id) from public.order_events where order_id = o.id);
  earn := public.my_earnings();
  assert (earn->>'today')::int = e.driver_amount, 'my_earnings today = ledger';
  assert jsonb_array_length(earn->'week') = 7, 'week array';
  assert jsonb_array_length(earn->'recent') = 1, 'recent list';
  -- earnings are derived, not stored: second call identical
  assert (public.my_earnings()->>'today')::int = e.driver_amount, 'idempotent';
end $$;

-- customer rates; driver rating recomputed
select auth.login('11111111-1111-1111-1111-111111111111');
select public.rate_order((select id from t), 4, '{準時,貨物綁妥}');
do $$ begin
  assert (pg_temp.o((select id from t))).rating = 4, 'rating saved';
  assert (pg_temp.d('22222222-2222-2222-2222-222222222222')).rating = 4.00, 'driver rating = first real rating';
  -- history persists and is visible
  assert (select count(*) from public.orders where status = 'completed') = 1, 'history';
  assert (select count(*) from public.payments where status = 'paid') = 1, 'payment persisted';
end $$;

-- second order: accepted then cancelled by customer -> refund + driver freed
create temp table t2 as select * from public.create_order('{
  "pickup": {"name":"觀音工業區","lat":25.0405,"lng":121.0942},
  "dest":   {"name":"湖口工業區","lat":24.8905,"lng":121.0433},
  "pallets": 4, "cargo_type": "鋼材 / 金屬", "tier": "backhaul"}'::jsonb);
select public.pay_order_sandbox((select id from t2));
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t2));
  assert o.status = 'offered', 'second order offered immediately (driver1 online), got ' || o.status;
  assert o.truck_tier = 'backhaul' and (o.quote_breakdown->>'multiplier')::numeric = 0.75, 'backhaul quote';
end $$;
select auth.login('22222222-2222-2222-2222-222222222222');
select public.respond_offer((select id from t2), true);
select auth.login('11111111-1111-1111-1111-111111111111');
select public.cancel_order((select id from t2), '臨時不出貨');
do $$ begin
  assert (pg_temp.o((select id from t2))).status = 'cancelled', 'cancelled';
  assert (select status from public.payments where order_id = (select id from t2)) = 'refunded', 'refunded';
end $$;
-- driver is free again: a third order goes straight to them
create temp table t3 as select * from public.create_order('{"pickup":{"name":"P","lat":25.04,"lng":121.09},"dest":{"name":"D","lat":24.9,"lng":121.05},"pallets":2,"cargo_type":"紙箱雜貨","tier":"dedicated"}'::jsonb);
select public.pay_order_sandbox((select id from t3));
do $$ begin
  assert (pg_temp.o((select id from t3))).status = 'offered', 'driver freed after cancel';
end $$;
-- driver goes offline while an offer is pending -> offer released
select auth.login('22222222-2222-2222-2222-222222222222');
select public.driver_set_online(false);
do $$ begin
  assert (pg_temp.o((select id from t3))).status = 'searching', 'offline releases offer';
  begin
    perform public.advance_order((select id from t3), 'arrived');
    raise exception 'should not be able to advance an order that is not mine';
  exception when others then
    if sqlerrm not like 'not your order%' then raise; end if;
  end;
end $$;

-- 0010: t3 would be re-offered to driver 1 (second chance) the moment they come back online; cancel it first
select auth.login('11111111-1111-1111-1111-111111111111');
select public.cancel_order((select id from t3), 'test');

-- tail-lift order: driver 1's vehicle has no tail lift -> not offered; after flagging it -> offered
select auth.login('22222222-2222-2222-2222-222222222222');
select public.driver_set_online(true, 25.09, 121.14);
select auth.login('11111111-1111-1111-1111-111111111111');
create temp table t4 as select * from public.create_order('{"pickup":{"name":"P","lat":25.04,"lng":121.09},"dest":{"name":"D","lat":24.9,"lng":121.05},"pallets":2,"cargo_type":"鋼材 / 金屬","tier":"dedicated","need_tail_lift":true,"helpers":1,"cargo_photo_url":"https://x.test/p.jpg"}'::jsonb);
select public.pay_order_sandbox((select id from t4));
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t4));
  assert o.status = 'searching', 'no tail-lift vehicle -> searching, got ' || o.status;
  assert o.need_tail_lift and o.helpers = 1, 'addons stored';
  assert o.cargo_photo_url = 'https://x.test/p.jpg', 'cargo photo stored';
  assert (o.quote_breakdown->>'helper_fee')::int = 3000 and (o.quote_breakdown->>'tail_lift_fee')::int = 1000, 'addon fees in breakdown';
end $$;
select auth.login('22222222-2222-2222-2222-222222222222');
update public.vehicles set has_tail_lift = true where driver_id = public.my_driver_id();
select auth.login('11111111-1111-1111-1111-111111111111');
select public.poll_order((select id from t4));
do $$ begin
  assert (pg_temp.o((select id from t4))).status = 'offered', 'tail-lift vehicle now eligible';
end $$;
select public.cancel_order((select id from t4), 'test');
select auth.login('22222222-2222-2222-2222-222222222222');
select public.driver_set_online(false);

-- --- vehicle classes (0004) ----------------------------------------------
do $$ declare q jsonb; begin
  assert (select count(*) from public.vehicle_classes where active) = 4, 'four classes seeded';
  -- 17t default equals the legacy numbers
  q := public.quote_price(131, 8, 'dedicated', false, 0, '17t', 'pallet');
  assert (q->>'total')::int = (public.quote_price(131, 8, 'dedicated')->>'total')::int, '17t == legacy';
  -- 26t pallet mode uses its own rates
  q := public.quote_price(131, 8, 'backhaul', true, 1, '26t', 'pallet');
  assert (q->>'total')::int = round((2000 + 131*48 + 8*150) * 0.75 / 10) * 10 + 1000 + 3000, '26t total = ' || (q->>'total');
  -- full-truck mode charges the deck's max pallets
  q := public.quote_price(100, 0, 'dedicated', false, 0, '35t', 'full');
  assert (q->>'pallet_fee')::int = 22 * 150, 'full = max_pallets × per_pallet';
  assert (q->>'distance_fee')::int = 2600 + 100*60, '35t distance fee';
  begin
    perform public.quote_price(10, 1, 'dedicated', false, 0, 'nope', 'pallet');
    raise exception 'unknown class should fail';
  exception when others then
    if sqlerrm not like 'unknown vehicle class%' then raise; end if;
  end;
end $$;

-- customer: too many pallets for the class is rejected; a 26t order only reaches a 26t vehicle
select auth.login('11111111-1111-1111-1111-111111111111');
do $$ begin
  begin
    perform public.create_order('{"pickup":{"name":"P","lat":25.04,"lng":121.09},"dest":{"name":"D","lat":24.9,"lng":121.05},"pallets":13,"cargo_type":"培養土","tier":"dedicated","class_id":"17t"}'::jsonb);
    raise exception 'should reject 13 pallets on 17t';
  exception when others then
    if sqlerrm not like '%最多 12 托%' then raise; end if;
  end;
  begin
    perform public.create_order('{"pickup":{"name":"P","lat":25.04,"lng":121.09},"dest":{"name":"D","lat":24.9,"lng":121.05},"pallets":4,"weight_t":12,"cargo_type":"鋼材","tier":"dedicated","class_id":"17t"}'::jsonb);
    raise exception 'should reject 12 t on 17t';
  exception when others then
    if sqlerrm not like '%載重上限%' then raise; end if;
  end;
end $$;
create temp table t5 as select * from public.create_order('{"pickup":{"name":"P","lat":25.04,"lng":121.09},"dest":{"name":"D","lat":24.9,"lng":121.05},"pallets":0,"load_mode":"full","quantity_desc":"H型鋼 12 支","weight_t":13.5,"cargo_type":"鋼材 / 金屬","tier":"dedicated","class_id":"26t"}'::jsonb);
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t5));
  assert o.class_id = '26t' and o.load_mode = 'full' and o.pallets = 0 and o.weight_t = 13.5 and o.quantity_desc = 'H型鋼 12 支', 'class/full stored';
  assert (o.quote_breakdown->>'pallet_fee')::int = 16 * 150, 'full 26t pallet fee';
end $$;
select auth.login('22222222-2222-2222-2222-222222222222');
select public.driver_set_online(true);
select auth.login('11111111-1111-1111-1111-111111111111');
select public.pay_order_sandbox((select id from t5));
do $$ begin
  assert (pg_temp.o((select id from t5))).status = 'searching', '17t driver must not get a 26t order';
end $$;
select auth.login('22222222-2222-2222-2222-222222222222');
do $$ begin
  -- 0010: an approved carrier cannot change their own class (or plate); the platform does it after review
  begin
    perform public.driver_set_vehicle_class('26t');
    raise exception 'approved driver must not switch class';
  exception when others then
    if sqlerrm not like '%由平台審核變更%' then raise; end if;
  end;
  begin
    update public.vehicles set class_id = '26t' where driver_id = public.my_driver_id();
    raise exception 'direct vehicle edit must fail';
  exception when others then
    if sqlerrm not like '%由平台審核變更%' then raise; end if;
  end;
end $$;
select auth.login('44444444-4444-4444-4444-444444444444');
update public.vehicles v set class_id = '26t', capacity_pallets = 16, capacity_tons = 15
  from public.drivers d where v.driver_id = d.id and d.profile_id = '22222222-2222-2222-2222-222222222222';
select auth.login('22222222-2222-2222-2222-222222222222');
do $$ begin
  assert (select class_id from public.vehicles where driver_id = public.my_driver_id() and active) = '26t', 'admin switched class';
end $$;
select auth.login('11111111-1111-1111-1111-111111111111');
select public.poll_order((select id from t5));
do $$ begin
  assert (pg_temp.o((select id from t5))).status = 'offered', '26t vehicle now gets the 26t order';
end $$;
select public.cancel_order((select id from t5), 'test');
select auth.login('44444444-4444-4444-4444-444444444444');
update public.vehicles v set class_id = '17t', capacity_pallets = 12, capacity_tons = 10
  from public.drivers d where v.driver_id = d.id and d.profile_id = '22222222-2222-2222-2222-222222222222';
select auth.login('22222222-2222-2222-2222-222222222222');
select public.driver_set_online(false);

-- --- carrier onboarding (0006) -----------------------------------------------
select auth.login('33333333-3333-3333-3333-333333333333');
do $$ declare d public.drivers; begin
  -- reset driver 2 to draft the way a fresh signup looks (admin approved them above for the earlier tests)
  reset role; update public.drivers set onboarding_status = 'draft', verification_status = 'pending', online = false where profile_id = '33333333-3333-3333-3333-333333333333'; set role authenticated;
  perform auth.login('33333333-3333-3333-3333-333333333333');
  -- cannot go online while unreviewed
  begin
    perform public.driver_set_online(true, 25.0, 121.0);
    raise exception 'should not go online';
  exception when others then
    if sqlerrm not like '%審核通過%' then raise; end if;
  end;
  -- cannot self-approve
  begin
    update public.drivers set onboarding_status = 'approved' where profile_id = auth.uid();
    raise exception 'self approve should fail';
  exception when others then
    if sqlerrm not like '%review fields%' then raise; end if;
  end;
  -- can fill in own application
  update public.drivers set license_class = '大貨車', license_expires_on = current_date + 365, business_type = 'affiliated',
         operator_name = '大同貨運行', operator_tax_id = '12345678', service_areas = array['桃園市', '新竹縣'],
         invoice_by = 'operator',
         bank_code = '812', bank_account_no = '0001234567890', bank_account_name = '林小華',
         declaration_accepted_at = now(), terms_accepted_at = now(), terms_version = 1
   where profile_id = auth.uid();
  -- 0013: 受僱 is gone; 靠行 must say who issues the invoice
  begin
    update public.drivers set business_type = 'employee' where profile_id = auth.uid();
    raise exception 'employee should be rejected';
  exception when check_violation then null; end;
  update public.drivers set invoice_by = null where profile_id = auth.uid();
  begin
    perform public.submit_onboarding();
    raise exception 'should ask for invoice_by';
  exception when others then
    if sqlerrm not like '%發票%' then raise; end if;
  end;
  update public.drivers set invoice_by = 'operator' where profile_id = auth.uid();
  -- submit without documents → lists what is missing
  begin
    perform public.submit_onboarding();
    raise exception 'should be missing docs';
  exception when others then
    if sqlerrm not like '缺少證件%affiliation_proof%' then raise; end if;
  end;
  insert into public.carrier_documents (driver_id, kind, storage_path)
  select public.my_driver_id(), k, auth.uid() || '/' || k || '.jpg'
  from unnest(public.required_carrier_docs('affiliated')) k;
  d := public.submit_onboarding();
  assert d.onboarding_status = 'submitted' and d.submitted_at is not null, 'submitted';
end $$;
-- other driver cannot see those documents
select auth.login('22222222-2222-2222-2222-222222222222');
do $$ begin
  assert (select count(*) from public.carrier_documents where driver_id <> public.my_driver_id()) = 0, 'docs are private';
end $$;
-- admin reviews
select auth.login('44444444-4444-4444-4444-444444444444');
do $$ declare d public.drivers; n int; begin
  select count(*) into n from public.carrier_documents; assert n >= 9, 'admin sees all docs, got ' || n;
  d := public.review_onboarding((select id from public.drivers where profile_id = '33333333-3333-3333-3333-333333333333'), 'needs_fix', '行照模糊');
  assert d.onboarding_status = 'needs_fix' and d.review_note = '行照模糊', 'needs_fix';
  d := public.review_onboarding(d.id, 'approved', '');
  assert d.onboarding_status = 'approved' and d.verification_status = 'verified', 'approved';
  assert (select verification_status from public.vehicles where driver_id = d.id and active) = 'verified', 'vehicle verified too';
  assert (select count(*) from public.carrier_documents where driver_id = d.id and status = 'approved') >= 9, 'docs approved';
end $$;
select auth.login('33333333-3333-3333-3333-333333333333');
do $$ declare d public.drivers; begin
  d := public.driver_set_online(true, 25.0, 121.0);
  assert d.online, 'approved driver can go online';
  perform public.driver_set_online(false);
end $$;

-- admin sees everything and can verify a driver
select auth.login('44444444-4444-4444-4444-444444444444');
do $$ begin
  assert (select count(*) from public.orders) = 6, 'admin sees all 6 orders';
  update public.drivers set verification_status = 'verified' where profile_id = '22222222-2222-2222-2222-222222222222';
  assert (select verification_status from public.drivers where profile_id = '22222222-2222-2222-2222-222222222222') = 'verified', 'admin verified driver';
end $$;
-- 0013: phone verification
select auth.login('11111111-1111-1111-1111-111111111111');
do $$ declare p public.profiles; begin
  begin
    perform public.sync_phone_verified();
    raise exception 'unverified phone should fail';
  exception when others then
    if sqlerrm not like '%手機%' then raise; end if;
  end;
  -- user cannot set the flag himself
  begin
    update public.profiles set phone_verified_at = now() where id = auth.uid();
    raise exception 'self-verify should fail';
  exception when others then
    if sqlerrm not like '%phone_verified_at%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;
end $$;
reset role;
update auth.users set phone = '886912345678', phone_confirmed_at = now() where id = '11111111-1111-1111-1111-111111111111';
update public.pricing_config set require_phone_verification = true where id = 1;
set role authenticated;
select auth.login('11111111-1111-1111-1111-111111111111');
do $$ declare p public.profiles; o public.orders; begin
  -- unverified → cannot order
  begin
    o := public.create_order('{"pickup":{"name":"A","lat":25.0,"lng":121.0},"dest":{"name":"B","lat":25.1,"lng":121.0},"pallets":1,"cargo_type":"x","tier":"dedicated","km":12}'::jsonb);
    raise exception 'unverified customer should not order';
  exception when others then
    if sqlerrm not like '%手機驗證%' then raise; end if;
  end;
  p := public.sync_phone_verified();
  assert p.phone = '0912345678' and p.phone_verified_at is not null, 'phone synced: ' || p.phone;
  -- editing the phone afterwards voids the verification
  update public.profiles set phone = '0900000000' where id = auth.uid() returning * into p;
  assert p.phone_verified_at is null, 'changing phone clears verification';
  p := public.sync_phone_verified();
  assert p.phone_verified_at is not null, 're-sync';
end $$;
reset role;
update public.pricing_config set require_phone_verification = false where id = 1;
set role authenticated;

-- 0016: test-phone whitelist lets the same handset be re-used across test accounts
select auth.login('11111111-1111-1111-1111-111111111111');
do $$ begin
  -- a normal number is never detached from anyone
  assert public.claim_test_phone('0987654321') = false, 'non-test phone is a no-op';
  assert public.normalize_tw_phone('0913-534-909') = '886913534909', 'normalize 09xx';
  assert public.normalize_tw_phone('+886913534909') = '886913534909', 'normalize +886';
end $$;
reset role;
insert into public.test_phones (phone, note) values ('886900000009', 'unit test') on conflict do nothing;
update auth.users set phone = '886900000009', phone_confirmed_at = now() where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set phone_verified_at = now() where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select auth.login('11111111-1111-1111-1111-111111111111');
do $$ begin
  assert public.claim_test_phone('0900000009') = true, 'test phone is claimable';
end $$;
reset role;
do $$ begin
  assert (select phone from auth.users where id = '22222222-2222-2222-2222-222222222222') is null, 'freed from the old account';
  assert (select phone_verified_at from public.profiles where id = '22222222-2222-2222-2222-222222222222') is null, 'verification cleared';
end $$;
set role authenticated;

-- a customer cannot promote themselves
select auth.login('11111111-1111-1111-1111-111111111111');
do $$ begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'role change should fail';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
rollback;
\echo STATE-MACHINE-OK

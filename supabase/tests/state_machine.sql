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
  assert (q->>'total')::int = round((1500 + 131*38 + 8*150) * 0.75 / 10) * 10 + 600 + 2*1500, 'addons total = ' || (q->>'total');
  assert (q->>'tail_lift_fee')::int = 600 and (q->>'helper_fee')::int = 3000, 'addon breakdown';
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

-- simulate expiry (as superuser), customer polls -> driver2 excluded -> searching, nobody left
reset role;
update public.orders set offer_expires_at = now() - interval '1 second' where id = (select id from t);
set role authenticated;
select auth.login('11111111-1111-1111-1111-111111111111');
select public.poll_order((select id from t));
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t));
  assert o.status = 'searching', 'expired -> searching, got ' || o.status;
  assert array_length(o.declined_driver_ids, 1) = 2, 'both drivers excluded';
  assert (select count(*) from public.order_events where order_id = o.id and event_type = 'offer_expired') = 1, 'offer_expired logged';
end $$;

-- give driver 1 another chance (admin clears the exclusion list), driver 1 accepts
reset role;
update public.orders set declined_driver_ids = '{}' where id = (select id from t);
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
         = 'created,paid,offered,declined,offered,offer_expired,offered,accepted,driver_arrived,loading_completed,in_transit,destination_arrived,delivered,completed',
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

-- tail-lift order: driver 1's vehicle has no tail lift -> not offered; after flagging it -> offered
select auth.login('22222222-2222-2222-2222-222222222222');
select public.driver_set_online(true, 25.09, 121.14);
select auth.login('11111111-1111-1111-1111-111111111111');
create temp table t4 as select * from public.create_order('{"pickup":{"name":"P","lat":25.04,"lng":121.09},"dest":{"name":"D","lat":24.9,"lng":121.05},"pallets":2,"cargo_type":"鋼材 / 金屬","tier":"dedicated","need_tail_lift":true,"helpers":1}'::jsonb);
select public.pay_order_sandbox((select id from t4));
do $$ declare o public.orders; begin
  o := pg_temp.o((select id from t4));
  assert o.status = 'searching', 'no tail-lift vehicle -> searching, got ' || o.status;
  assert o.need_tail_lift and o.helpers = 1, 'addons stored';
  assert (o.quote_breakdown->>'helper_fee')::int = 1500 and (o.quote_breakdown->>'tail_lift_fee')::int = 600, 'addon fees in breakdown';
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

-- admin sees everything and can verify a driver
select auth.login('44444444-4444-4444-4444-444444444444');
do $$ begin
  assert (select count(*) from public.orders) = 5, 'admin sees all 5 orders';
  update public.drivers set verification_status = 'verified' where profile_id = '22222222-2222-2222-2222-222222222222';
  assert (select verification_status from public.drivers where profile_id = '22222222-2222-2222-2222-222222222222') = 'verified', 'admin verified driver';
end $$;
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

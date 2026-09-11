-- 0005: 電子運送契約（客戶 ↔ 實際承運人；平台僅媒合）＋ 訂單補齊契約需要的欄位
-- 2026-09-11。可重複執行。
--
-- 司機接單（orders.status → accepted）那一刻，把訂單內容、雙方帳號、條款版本快照成一份契約，
-- 之後不能改（trigger 擋 update/delete；只允許雙方各自「已閱讀確認」的時間戳從 null 變成非 null）。
-- 承運人不寫死是貨運公司：司機有 operator_id 就以車行為承運人，否則以司機本人為承運人。

-- ---------- 1. 訂單補欄位 ------------------------------------------------------
alter table public.orders add column if not exists pickup_at       timestamptz;          -- 預計裝貨時間（null = 立即）
alter table public.orders add column if not exists dropoff_at      timestamptz;          -- 預計卸貨時間（估算）
alter table public.orders add column if not exists payment_method  text not null default 'sandbox';  -- sandbox | newebpay_credit | ecpay_credit | transfer …
alter table public.orders add column if not exists carrier_type    text check (carrier_type in ('driver', 'operator'));
alter table public.orders add column if not exists carrier_id      uuid;                 -- drivers.id 或 operators.id（依 carrier_type）

-- ---------- 2. 條款版本表 -----------------------------------------------------
-- 平台擬的「運送契約條款」範本，版本化；契約成立時把當時有效版本的全文抄進 contracts.terms_text。
create table if not exists public.contract_terms (
  version        integer primary key,
  title          text not null,
  body           text not null,                  -- Markdown；{{占位}} 由 App 顯示時代入
  effective_from timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
alter table public.contract_terms enable row level security;
drop policy if exists contract_terms_select on public.contract_terms;
create policy contract_terms_select on public.contract_terms for select to anon, authenticated using (true);
drop policy if exists contract_terms_admin on public.contract_terms;
create policy contract_terms_admin on public.contract_terms for insert to authenticated with check (public.is_admin());
grant select on public.contract_terms to anon, authenticated;
grant insert on public.contract_terms to authenticated;

insert into public.contract_terms (version, title, body) values (1, '貨物運送契約（電子契約）', $terms$
【草稿：本條款為平台擬定之範本，正式上線前請交由律師審閱。】

一、契約當事人與平台角色
1. 本契約由「託運人」（客戶）與「承運人」（接單之司機本人或其所屬車行）成立；「大車叫車」平台（下稱平台）僅提供媒合、估價、付款工具、訂單管理、運送狀態追蹤與居中協調，不以自己名義承攬貨物，亦不負實際運送之責。
2. 承運人於平台接受訂單時，本契約即依訂單內容成立，雙方於 App 內均可查閱；平台保存契約成立時間、雙方帳號、訂單內容、條款版本與確認紀錄，成立後不得任意修改。

二、運送內容
1. 起運地、目的地、車型級距、貨物種類、數量／重量、裝卸設備需求、搬運工需求、預計裝貨時間與預計卸貨時間，以訂單記載為準。
2. 託運人應確保貨物已妥善包裝並可安全裝卸；貨物實際狀況與訂單記載不符（重量、數量、尺寸、危險品等）致無法運送者，承運人得拒絕承運，託運人應負擔因此產生之空趟費用。

三、運費與付款
1. 運費以訂單成立時平台報價為準，含基本里程費、棧板費或整車費、加價項目（升降尾門、隨車搬運工）。
2. 託運人於下單時以訂單記載之付款方式付款；款項由平台之第三方金流代收，運送完成後撥付承運人。試營運期間平台不另收平台服務費。

四、裝卸貨時間與等候
1. 承運人抵達裝貨地點後，託運人應於 60 分鐘內完成裝貨；抵達卸貨地點後，收貨方應於 60 分鐘內完成卸貨。逾時每 30 分鐘得加收等候費，金額以平台當時公告為準。
2. 因託運人或收貨方原因致無法裝卸貨者，視同託運人取消訂單，依第五條處理。

五、取消與遲到
1. 承運人接單前，託運人得隨時取消，全額退款。
2. 承運人接單後、抵達裝貨地點前取消，平台得酌收空趟費（運費之 20%，上限 NT$1,500）；承運人抵達裝貨地點後取消，酌收運費之 50%。
3. 承運人接單後無故未於預計時間前往、或逾預計裝貨時間 60 分鐘未抵達，託運人得取消訂單並全額退款；承運人並得由平台依規範停權。
4. 退款一律透過原付款方式由第三方金流退回，並同步記錄於訂單。

六、貨損、滅失與責任
1. 貨物自承運人完成裝載並離開裝貨地點起，至卸貨地點交付收貨方止，由承運人負保管責任；因承運人之故意或過失致貨物毀損、滅失者，承運人應依貨物實際價值賠償，但以該筆運費之 10 倍為上限，除非託運人於下單時聲明貨物價值並經承運人同意。
2. 因貨物本身性質、包裝不當、託運人指示錯誤、或託運人自行裝卸之操作所致者，承運人不負責任。
3. 託運人於下單時上傳之現場貨物照片、及承運人於交付時之簽收或照片紀錄，作為貨態與責任釐清之依據。

七、不可抗力
因天災、地震、颱風、道路封閉、政府命令、罷工或其他不可歸責於雙方之事由致無法履行者，雙方均不負違約責任；已付運費依實際履行比例結算，未履行部分退還託運人。

八、爭議處理
1. 雙方就本契約發生爭議，先透過平台客服協調；協調不成，同意以承運人所在地或起運地之地方法院為第一審管轄法院，並適用中華民國法律。
2. 平台得依雙方提供之訂單、事件紀錄、定位軌跡與照片協助釐清事實，但平台非契約當事人，不負賠償責任。

九、其他
1. 本契約以電子方式成立，雙方於 App 內之接單與確認紀錄具契約效力。
2. 平台服務條款另行規範平台與使用者間之權利義務；本契約與平台服務條款不一致者，就託運人與承運人間之運送關係以本契約為準。
$terms$)
on conflict (version) do nothing;

-- ---------- 3. 契約表（不可變）-----------------------------------------------
create table if not exists public.contracts (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null unique references public.orders (id) on delete restrict,
  contract_no      text not null unique,
  version          integer not null default 1,           -- 同一筆訂單若日後允許補約，版本遞增（目前固定 1）
  terms_version    integer not null references public.contract_terms (version),
  customer_id      uuid not null references public.profiles (id),
  carrier_type     text not null check (carrier_type in ('driver', 'operator')),
  carrier_id       uuid not null,                        -- drivers.id 或 operators.id
  carrier_driver_id uuid not null references public.drivers (id),  -- 實際駕駛（承運人為車行時仍記錄）
  content          jsonb not null,                       -- 訂單與雙方快照（見 form_contract）
  terms_text       text not null,                        -- 成立當時的條款全文
  content_hash     text not null,                        -- sha256(content || terms_text)，供日後驗證未被改動
  formed_at        timestamptz not null default now(),
  customer_ack_at  timestamptz,                          -- 託運人在 App 點「我已閱讀」
  carrier_ack_at   timestamptz,                          -- 承運人在 App 點「我已閱讀」
  created_at       timestamptz not null default now()
);
create index if not exists contracts_customer_idx on public.contracts (customer_id);
create index if not exists contracts_carrier_driver_idx on public.contracts (carrier_driver_id);
alter table public.contracts enable row level security;
drop policy if exists contracts_select_party on public.contracts;
create policy contracts_select_party on public.contracts for select to authenticated
  using (customer_id = auth.uid() or carrier_driver_id = public.my_driver_id() or public.is_admin());
grant select on public.contracts to authenticated;
-- 沒有 insert/update/delete policy：只有 security definer 函數能寫

-- 成立後不可修改：只放行 ack 欄位 null → 非 null
create or replace function public.contracts_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'contracts are immutable'; end if;
  if new.id <> old.id or new.order_id <> old.order_id or new.contract_no <> old.contract_no or new.version <> old.version
     or new.terms_version <> old.terms_version or new.customer_id <> old.customer_id or new.carrier_type <> old.carrier_type
     or new.carrier_id <> old.carrier_id or new.carrier_driver_id <> old.carrier_driver_id or new.content <> old.content
     or new.terms_text <> old.terms_text or new.content_hash <> old.content_hash or new.formed_at <> old.formed_at
     or (old.customer_ack_at is not null and new.customer_ack_at is distinct from old.customer_ack_at)
     or (old.carrier_ack_at is not null and new.carrier_ack_at is distinct from old.carrier_ack_at) then
    raise exception 'contracts are immutable (only first acknowledgement timestamps may be set)';
  end if;
  return new;
end $$;
drop trigger if exists contracts_immutable_trg on public.contracts;
create trigger contracts_immutable_trg before update or delete on public.contracts
  for each row execute function public.contracts_immutable();

-- ---------- 4. 成立契約：接單時自動呼叫 ------------------------------------------
create or replace function public.form_contract(p_order uuid)
returns public.contracts language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  d public.drivers%rowtype;
  v public.vehicles%rowtype;
  dp public.profiles%rowtype;
  cp public.profiles%rowtype;
  op public.operators%rowtype;
  k public.vehicle_classes%rowtype;
  t public.contract_terms%rowtype;
  c public.contracts%rowtype;
  v_type text; v_carrier uuid; v_content jsonb; v_no text;
begin
  select * into c from public.contracts where order_id = p_order;
  if c.id is not null then return c; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null or o.driver_id is null then raise exception 'order % has no carrier yet', p_order; end if;
  select * into d from public.drivers where id = o.driver_id;
  select * into dp from public.profiles where id = d.profile_id;
  select * into cp from public.profiles where id = o.customer_id;
  select * into v from public.vehicles where id = o.vehicle_id;
  select * into k from public.vehicle_classes where id = o.class_id;
  select * into t from public.contract_terms where effective_from <= now() order by version desc limit 1;
  if t.version is null then raise exception 'no contract terms'; end if;

  if d.operator_id is not null then
    select * into op from public.operators where id = d.operator_id;
    v_type := 'operator'; v_carrier := d.operator_id;
  else
    v_type := 'driver'; v_carrier := d.id;
  end if;

  v_content := jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'created_at', o.created_at, 'accepted_at', coalesce(o.accepted_at, now()),
      'pickup', jsonb_build_object('name', o.pickup_name, 'addr', o.pickup_addr, 'lat', o.pickup_lat, 'lng', o.pickup_lng),
      'dest',   jsonb_build_object('name', o.dest_name, 'addr', o.dest_addr, 'lat', o.dest_lat, 'lng', o.dest_lng),
      'class_id', o.class_id, 'class_name', k.name, 'tier', o.truck_tier,
      'cargo_type', o.cargo_type, 'note', o.note, 'load_mode', o.load_mode, 'pallets', o.pallets,
      'weight_t', o.weight_t, 'quantity_desc', o.quantity_desc, 'cargo_photo_url', o.cargo_photo_url,
      'need_tail_lift', o.need_tail_lift, 'helpers', o.helpers,
      'estimated_km', o.estimated_km, 'quoted_price', o.quoted_price, 'quote_breakdown', o.quote_breakdown,
      'pickup_at', coalesce(o.pickup_at, o.created_at), 'dropoff_at', o.dropoff_at,
      'payment_method', o.payment_method),
    'customer', jsonb_build_object('profile_id', cp.id, 'name', cp.name, 'phone', cp.phone, 'company', cp.company),
    'carrier', jsonb_build_object('type', v_type, 'id', v_carrier,
      'operator', case when op.id is null then null else jsonb_build_object('id', op.id, 'company_name', op.company_name, 'tax_id', op.tax_id, 'phone', op.phone) end,
      'driver', jsonb_build_object('driver_id', d.id, 'profile_id', dp.id, 'name', dp.name, 'phone', dp.phone),
      'vehicle', jsonb_build_object('id', v.id, 'plate', v.plate, 'make_model', v.make_model, 'class_id', v.class_id, 'has_tail_lift', v.has_tail_lift)),
    'platform', jsonb_build_object('name', '大車叫車', 'role', 'intermediary_only'),
    'terms_version', t.version);

  v_no := 'CT-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(o.id::text, '-', ''), 1, 6));
  insert into public.contracts (order_id, contract_no, version, terms_version, customer_id, carrier_type, carrier_id, carrier_driver_id,
                                content, terms_text, content_hash)
  values (o.id, v_no, 1, t.version, o.customer_id, v_type, v_carrier, d.id,
          v_content, t.body, encode(sha256(convert_to(v_content::text || t.body, 'UTF8')), 'hex'))
  returning * into c;

  update public.orders set carrier_type = v_type, carrier_id = v_carrier,
         dropoff_at = coalesce(dropoff_at, coalesce(o.pickup_at, now()) + make_interval(mins => greatest(30, round(o.estimated_km)::int + 60)))
   where id = o.id;
  -- (no order_event: the contract row itself is the record; keeps the event log's state sequence clean)
  return c;
end $$;
revoke execute on function public.form_contract(uuid) from public, anon, authenticated;

-- 接單 → 自動成立契約（在 respond_offer 的 update 之後觸發）
create or replace function public.orders_form_contract()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') and new.driver_id is not null then
    perform public.form_contract(new.id);
  end if;
  return new;
end $$;
drop trigger if exists orders_form_contract_trg on public.orders;
create trigger orders_form_contract_trg after update of status on public.orders
  for each row execute function public.orders_form_contract();

-- ---------- 5. 雙方「我已閱讀」 -----------------------------------------------
create or replace function public.ack_contract(p_contract uuid)
returns public.contracts language plpgsql security definer set search_path = public as $$
declare c public.contracts%rowtype; v_driver uuid;
begin
  select * into c from public.contracts where id = p_contract;
  if c.id is null then raise exception 'no such contract'; end if;
  v_driver := public.my_driver_id();
  if c.customer_id = auth.uid() then
    update public.contracts set customer_ack_at = coalesce(customer_ack_at, now()) where id = p_contract returning * into c;
  elsif v_driver is not null and c.carrier_driver_id = v_driver then
    update public.contracts set carrier_ack_at = coalesce(carrier_ack_at, now()) where id = p_contract returning * into c;
  else
    raise exception 'not a party to this contract';
  end if;
  return c;
end $$;
grant execute on function public.ack_contract(uuid) to authenticated;

-- 舊訂單（0005 前已接單）補建契約，讓歷史頁也看得到
do $$ declare r record; begin
  for r in select id from public.orders where driver_id is not null and status in ('accepted','arrived','in_transit','delivered','completed')
           and not exists (select 1 from public.contracts c where c.order_id = orders.id) loop
    begin perform public.form_contract(r.id); exception when others then raise notice 'backfill contract % failed: %', r.id, sqlerrm; end;
  end loop;
end $$;

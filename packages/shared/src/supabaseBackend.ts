/**
 * Real backend: Supabase Auth + Postgres RPCs (see supabase/migrations) + Realtime.
 * All state transitions happen in SQL functions; this file only maps rows ⇄ app models.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Backend, Unsubscribe } from './backend';
import { CARGO_TYPES, DEFAULT_CLASSES, TIERS } from './data';
import { routePath } from './pricing';
import { getSupabase } from './supabaseClient';
import type {
  DriverLocation,
  EarningsSummary,
  HistoryItem,
  Order,
  OrderInput,
  OrderStatus,
  PricingConfig,
  Session,
  SignUpInput,
  VehicleClass,
  Contract,
  Onboarding,
  CarrierDoc,
  DocKind,
} from './types';

/* ---------- row types (subset of public.orders) ---------- */
type OrderRow = {
  id: string;
  order_no: string;
  customer_id: string;
  driver_id: string | null;
  offered_driver_id: string | null;
  offer_expires_at: string | null;
  pickup_name: string;
  pickup_addr: string;
  pickup_lat: number;
  pickup_lng: number;
  dest_name: string;
  dest_addr: string;
  dest_lat: number;
  dest_lng: number;
  pallets: number;
  cargo_type: string;
  note: string;
  truck_tier: 'dedicated' | 'backhaul';
  need_tail_lift: boolean;
  helpers: number;
  cargo_photo_url?: string | null;
  class_id?: string | null;
  load_mode?: string | null;
  weight_t?: number | string | null;
  quantity_desc?: string | null;
  estimated_km: number | string;
  distance_source: 'osrm' | 'google' | 'estimate';
  route_polyline: [number, number][] | null;
  quoted_price: number;
  quote_breakdown: Record<string, unknown>;
  platform_fee: number;
  driver_amount: number;
  status: OrderStatus;
  customer_name: string;
  customer_phone: string;
  customer_company: string;
  driver_name: string | null;
  driver_phone: string | null;
  driver_rating: number | string | null;
  vehicle_plate: string | null;
  vehicle_desc: string | null;
  rating: number | null;
  created_at: string;
  completed_at: string | null;
};

const num = (v: unknown, d = 0) => (v == null ? d : Number(v));
const ACTIVE: OrderStatus[] = ['created', 'searching', 'offered', 'accepted', 'arrived', 'in_transit', 'delivered'];

export function mapOrderRow(r: OrderRow): Order {
  const pickup = { id: 'p', name: r.pickup_name, addr: r.pickup_addr, lat: r.pickup_lat, lng: r.pickup_lng };
  const drop = { id: 'd', name: r.dest_name, addr: r.dest_addr, lat: r.dest_lat, lng: r.dest_lng };
  const q = r.quote_breakdown ?? {};
  return {
    id: r.id,
    orderNo: r.order_no,
    pickup,
    drop,
    pallets: r.pallets,
    cargo: CARGO_TYPES.find((c) => c.name === r.cargo_type) ?? { id: 'other', name: r.cargo_type, hint: '' },
    note: r.note ?? '',
    tier: TIERS.find((t) => t.id === r.truck_tier) ?? TIERS[0],
    needTailLift: !!r.need_tail_lift,
    helpers: num(r.helpers),
    cargoPhotoUrl: r.cargo_photo_url || undefined,
    classId: r.class_id || '17t',
    loadMode: r.load_mode === 'full' ? 'full' : 'pallet',
    weightT: r.weight_t == null ? undefined : num(r.weight_t),
    quantityDesc: r.quantity_desc ?? '',
    km: num(r.estimated_km),
    distanceSource: r.distance_source,
    quote: {
      distanceFee: num(q.distance_fee),
      palletFee: num(q.pallet_fee),
      subtotal: num(q.subtotal),
      baseTotal: num(q.base_total, num(q.subtotal)),
      tailLiftFee: num(q.tail_lift_fee),
      helperFee: num(q.helper_fee),
      total: r.quoted_price,
      factor: num(q.multiplier, 1),
      platformFee: r.platform_fee,
      driverAmount: r.driver_amount,
    },
    status: r.status,
    createdAt: Date.parse(r.created_at),
    completedAt: r.completed_at ? Date.parse(r.completed_at) : undefined,
    offerExpiresAt: r.offer_expires_at ? Date.parse(r.offer_expires_at) : undefined,
    driver: r.driver_id && r.driver_name != null
      ? {
          id: r.driver_id,
          name: r.driver_name,
          initials: r.driver_name.slice(0, 1),
          rating: num(r.driver_rating, 5),
          trips: 0,
          plate: r.vehicle_plate ?? '',
          truck: r.vehicle_desc ?? '17噸 大貨車',
          color: '',
          phone: r.driver_phone ?? '',
        }
      : undefined,
    customer: { id: r.customer_id, company: r.customer_company, contact: r.customer_name, phone: r.customer_phone },
    path: r.route_polyline && r.route_polyline.length > 1 ? r.route_polyline : routePath(pickup, drop),
    progress: 0,
    rating: r.rating ?? undefined,
  };
}

/** where a confirmation e-mail should land: this app's own base URL (…/customer/ or …/driver/) */
function appBaseUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const m = window.location.pathname.match(/^(.*\/(customer|driver)\/)/);
  return window.location.origin + (m ? m[1] : '/');
}

/** 0912-345-678 / 0912345678 / +886912345678 → +886912345678 (Supabase wants E.164 without the leading 0) */
export function toE164(phone: string): string {
  const digits = phone.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('886')) return '+' + digits;
  if (digits.startsWith('0')) return '+886' + digits.slice(1);
  return '+886' + digits;
}

function friendlyAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('token has expired') || m.includes('otp_expired')) return '驗證碼已過期，請重新寄送';
  if (m.includes('invalid') && (m.includes('otp') || m.includes('token'))) return '驗證碼不正確';
  if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many')) return '寄送太頻繁，請稍後再試';
  if (m.includes('sms') && m.includes('provider')) return '簡訊服務尚未開通，請聯絡客服';
  if (m.includes('already registered') || m.includes('already exists')) return '這個 Email 或手機已經註冊過';
  if (m.includes('invalid login credentials')) return 'Email 或密碼錯誤';
  if (m.includes('email not confirmed')) return 'Email 尚未驗證，請先輸入信中的驗證碼';
  return msg;
}

function mapOnboarding(d: any): Onboarding {
  return {
    status: d.onboarding_status ?? 'draft',
    reviewNote: d.review_note ?? '',
    submittedAt: d.submitted_at ? Date.parse(d.submitted_at) : undefined,
    licenseClass: d.license_class ?? undefined,
    licenseExpiresOn: d.license_expires_on ?? undefined,
    businessType: d.business_type ?? undefined,
    invoiceBy: d.invoice_by ?? undefined,
    operatorName: d.operator_name ?? '',
    operatorTaxId: d.operator_tax_id ?? '',
    acceptExternalLoads: d.accept_external_loads !== false,
    serviceAreas: d.service_areas ?? [],
    bankCode: d.bank_code ?? '',
    bankAccountNo: d.bank_account_no ?? '',
    bankAccountName: d.bank_account_name ?? '',
    declarationAcceptedAt: d.declaration_accepted_at ? Date.parse(d.declaration_accepted_at) : undefined,
    termsAcceptedAt: d.terms_accepted_at ? Date.parse(d.terms_accepted_at) : undefined,
  };
}
function mapDoc(r: any): CarrierDoc {
  return { id: r.id, kind: r.kind as DocKind, storagePath: r.storage_path, status: r.status, note: r.note ?? '', uploadedAt: Date.parse(r.uploaded_at) };
}

function mapContract(r: any): Contract {
  return {
    id: r.id,
    contractNo: r.contract_no,
    orderId: r.order_id,
    version: num(r.version, 1),
    termsVersion: num(r.terms_version, 1),
    termsText: r.terms_text ?? '',
    content: r.content ?? {},
    carrierType: r.carrier_type === 'operator' ? 'operator' : 'driver',
    contentHash: r.content_hash ?? '',
    formedAt: Date.parse(r.formed_at),
    customerAckAt: r.customer_ack_at ? Date.parse(r.customer_ack_at) : undefined,
    carrierAckAt: r.carrier_ack_at ? Date.parse(r.carrier_ack_at) : undefined,
  };
}

function toHistory(o: Order): HistoryItem {
  const d = new Date(o.createdAt);
  return {
    id: o.id,
    orderNo: o.orderNo,
    date: `${d.getMonth() + 1}/${d.getDate()}`,
    from: o.pickup.name,
    to: o.drop.name,
    fromLoc: o.pickup,
    toLoc: o.drop,
    pallets: o.pallets,
    loadMode: o.loadMode,
    quantityDesc: o.quantityDesc,
    classId: o.classId,
    cargo: o.cargo.name,
    total: o.quote.total,
    driverAmount: o.quote.driverAmount,
    status: o.status,
  };
}

const ORDER_COLS = '*'; // explicit lists broke every read when a column was added (0003)

export function createSupabaseBackend(): Backend {
  const sb: SupabaseClient = getSupabase();
  let cachedSession: Session | null = null;
  let cachedDriverId: string | undefined;

  async function buildSession(): Promise<Session | null> {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      cachedSession = null;
      cachedDriverId = undefined;
      return null;
    }
    const { data: p, error } = await sb.from('profiles').select('id,role,name,phone,company,phone_verified_at').eq('id', user.id).maybeSingle();
    if (error || !p) {
      // profile row is created by a DB trigger a moment after sign-up; retry once
      await new Promise((r) => setTimeout(r, 600));
      const again = await sb.from('profiles').select('id,role,name,phone,company,phone_verified_at').eq('id', user.id).maybeSingle();
      if (!again.data) return null;
      return finishSession(user.id, user.email ?? '', again.data);
    }
    return finishSession(user.id, user.email ?? '', p);
  }

  async function finishSession(userId: string, email: string, p: { role: Session['role']; name: string; phone: string; company: string; phone_verified_at?: string | null }): Promise<Session> {
    const { data: cfg } = await sb.from('pricing_config').select('require_phone_verification').eq('id', 1).maybeSingle();
    const s: Session = {
      userId, email, role: p.role, name: p.name, phone: p.phone, company: p.company,
      phoneVerified: !!p.phone_verified_at,
      phoneVerificationRequired: cfg?.require_phone_verification === true,
    };
    if (p.role === 'driver') {
      const { data: d } = await sb.from('drivers').select('id,online,rating,trips_count,verification_status,onboarding_status,review_note').eq('profile_id', userId).maybeSingle();
      if (d) {
        s.driverId = d.id;
        s.driverOnline = d.online;
        s.driverRating = num(d.rating, 5);
        s.driverTrips = d.trips_count;
        s.verification = d.verification_status;
        s.onboardingStatus = (d.onboarding_status as Session['onboardingStatus']) ?? 'draft';
        s.reviewNote = d.review_note ?? '';
        const { data: v } = await sb.from('vehicles').select('plate,make_model,truck_type,capacity_tons,verification_status,has_tail_lift,class_id').eq('driver_id', d.id).eq('active', true).order('created_at').limit(1).maybeSingle();
        if (v) s.vehicle = { plate: v.plate, desc: `${v.make_model || v.truck_type} · ${DEFAULT_CLASSES.find((k) => k.id === v.class_id)?.name ?? v.class_id ?? ''}`, verification: v.verification_status, hasTailLift: !!v.has_tail_lift, classId: v.class_id || '17t' };
      }
    }
    cachedSession = s;
    cachedDriverId = s.driverId;
    return s;
  }

  async function rpcOrder(fn: string, args: Record<string, unknown>): Promise<Order> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return mapOrderRow(data as OrderRow);
  }

  const channels = new Set<RealtimeChannel>();
  const track = (ch: RealtimeChannel): Unsubscribe => {
    channels.add(ch);
    return () => {
      channels.delete(ch);
      sb.removeChannel(ch);
    };
  };

  return {
    kind: 'supabase',

    /* ---- auth ---- */
    getSession: buildSession,
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        // never call supabase inside the callback synchronously (docs: deadlock risk)
        setTimeout(() => {
          if (!session) {
            cachedSession = null;
            cb(null);
          } else buildSession().then(cb).catch(() => cb(null));
        }, 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(friendlyAuthError(error.message));
      const s = await buildSession();
      if (!s) throw new Error('找不到使用者資料');
      return s;
    },
    async signUp(input) {
      const { data, error } = await sb.auth.signUp({
        email: input.email.trim(),
        password: input.password,
        options: {
          data: {
            role: input.role,
            name: input.name,
            phone: input.phone,
            company: input.company ?? '',
            plate: input.plate ?? '',
            make_model: input.makeModel ?? '',
            has_tail_lift: !!input.hasTailLift,
            class_id: input.classId ?? '17t',
            terms_version: input.termsVersion ?? '',
          },
          emailRedirectTo: appBaseUrl(),
        },
      });
      if (error) throw new Error(error.message);
      if (!data.session) return null; // e-mail confirmation required by project settings
      return buildSession();
    },
    async verifyEmailCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'signup' });
      if (error) throw new Error(friendlyAuthError(error.message));
      const s = await buildSession();
      if (!s) throw new Error('找不到使用者資料');
      return s;
    },
    async resendEmailCode(email) {
      const { error } = await sb.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: appBaseUrl() } });
      if (error) throw new Error(friendlyAuthError(error.message));
    },
    async startPhoneVerification(phone) {
      // dev only: a number on the platform's test-phone list is detached from whatever account
      // holds it, so the same handset can be re-used for another test account (0016). No-op otherwise.
      try { await sb.rpc('claim_test_phone', { p_phone: phone }); } catch { /* not a test number */ }
      const { error } = await sb.auth.updateUser({ phone: toE164(phone) });
      if (error) throw new Error(friendlyAuthError(error.message));
    },
    async verifyPhoneCode(phone, code) {
      const { error } = await sb.auth.verifyOtp({ phone: toE164(phone), token: code.trim(), type: 'phone_change' });
      if (error) throw new Error(friendlyAuthError(error.message));
      const { error: e2 } = await sb.rpc('sync_phone_verified');
      if (e2) throw new Error(e2.message);
      const s = await buildSession();
      if (!s) throw new Error('找不到使用者資料');
      return s;
    },
    async signOut() {
      channels.forEach((c) => sb.removeChannel(c));
      channels.clear();
      await sb.auth.signOut();
      cachedSession = null;
      cachedDriverId = undefined;
    },

    /* ---- config ---- */
    async getVehicleClasses() {
      const { data, error } = await sb.from('vehicle_classes').select('*').order('sort');
      if (error || !data || data.length === 0) return DEFAULT_CLASSES;
      return data.map((k): VehicleClass => ({
        id: k.id,
        name: k.name,
        nickname: k.nickname ?? '',
        sort: num(k.sort),
        active: k.active !== false,
        baseFare: num(k.base_fare),
        perKm: num(k.per_km),
        perPallet: num(k.per_pallet),
        maxPallets: num(k.max_pallets),
        maxWeightT: num(k.max_weight_t),
        deckM: num(k.deck_m),
        grossT: k.gross_t ?? '',
      }));
    },
    async getPricingConfig() {
      const { data, error } = await sb.from('pricing_config').select('*').eq('id', 1).single();
      if (error || !data) throw new Error(error?.message ?? 'no pricing config');
      return {
        baseFare: data.base_fare,
        perKm: data.per_km,
        perPallet: data.per_pallet,
        dedicatedMultiplier: num(data.dedicated_multiplier, 1),
        backhaulMultiplier: num(data.backhaul_multiplier, 0.75),
        platformFeeRate: num(data.platform_fee_rate, 0.15),
        serviceRadiusKm: data.service_radius_km,
        offerTimeoutSeconds: data.offer_timeout_seconds,
        maxPallets: 16,
        tailLiftFee: num(data.tail_lift_fee, 1000),
        helperFee: num(data.helper_fee, 3000),
        requirePhoneVerification: data.require_phone_verification === true,
      };
    },

    /* ---- customer ---- */
    async uploadCargoPhoto(localUri: string) {
      const s = cachedSession ?? (await buildSession());
      if (!s) throw new Error('not signed in');
      const res = await fetch(localUri);
      const blob = await res.blob();
      const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/heic' ? 'heic' : 'jpg';
      const path = `${s.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await sb.storage.from('cargo-photos').upload(path, blob, { contentType: type, upsert: false });
      if (error) throw new Error(error.message);
      return sb.storage.from('cargo-photos').getPublicUrl(path).data.publicUrl;
    },
    async logQuote(q) {
      try { await sb.rpc('log_quote', { p: q }); } catch { /* analytics must never block ordering */ }
    },
    createOrder(input: OrderInput) {
      return rpcOrder('create_order', {
        p: {
          pickup: { name: input.pickup.name, addr: input.pickup.addr, lat: input.pickup.lat, lng: input.pickup.lng },
          dest: { name: input.drop.name, addr: input.drop.addr, lat: input.drop.lat, lng: input.drop.lng },
          pallets: input.pallets,
          cargo_type: input.cargo.name,
          note: input.note,
          tier: input.tier.id,
          need_tail_lift: input.needTailLift,
          helpers: input.helpers,
          cargo_photo_url: input.cargoPhotoUrl ?? null,
          class_id: input.classId,
          load_mode: input.loadMode,
          weight_t: input.weightT ?? null,
          quantity_desc: input.quantityDesc ?? '',
          km: input.km,
          distance_source: input.distanceSource,
          route_polyline: input.path,
        },
      });
    },
    payOrderSandbox: (orderId) => rpcOrder('pay_order_sandbox', { p_order: orderId }),
    pollOrder: (orderId) => rpcOrder('poll_order', { p_order: orderId }),
    cancelOrder: (orderId, reason) => rpcOrder('cancel_order', { p_order: orderId, p_reason: reason ?? null }),
    rateOrder: (orderId, stars, tags, comment) => rpcOrder('rate_order', { p_order: orderId, p_stars: stars, p_tags: tags, p_comment: comment ?? '' }),

    /* ---- contract ---- */
    async getContractTerms() {
      const { data, error } = await sb.rpc('latest_contract_terms');
      if (error || !data) throw new Error(error?.message ?? 'no terms');
      const r = Array.isArray(data) ? data[0] : data;
      return { version: num(r.version, 1), title: r.title ?? '貨物運送契約', body: r.body ?? '' };
    },
    async getContract(orderId) {
      const { data } = await sb.from('contracts').select('*').eq('order_id', orderId).maybeSingle();
      return data ? mapContract(data) : null;
    },
    async ackContract(contractId) {
      const { data, error } = await sb.rpc('ack_contract', { p_contract: contractId });
      if (error) throw new Error(error.message);
      return mapContract(data);
    },

    /* ---- both ---- */
    async getOrder(orderId) {
      const { data } = await sb.from('orders').select(ORDER_COLS).eq('id', orderId).maybeSingle();
      return data ? mapOrderRow(data as OrderRow) : null;
    },
    async getActiveOrder() {
      const s = cachedSession ?? (await buildSession());
      if (!s) return null;
      let q = sb.from('orders').select(ORDER_COLS).in('status', ACTIVE).order('created_at', { ascending: false }).limit(1);
      q = s.role === 'driver' && s.driverId
        ? q.or(`driver_id.eq.${s.driverId},offered_driver_id.eq.${s.driverId}`)
        : q.eq('customer_id', s.userId);
      const { data } = await q.maybeSingle();
      return data ? mapOrderRow(data as OrderRow) : null;
    },
    async listOrders(limit = 50) {
      const s = cachedSession ?? (await buildSession());
      if (!s) return [];
      let q = sb.from('orders').select(ORDER_COLS).in('status', ['completed', 'cancelled']).order('created_at', { ascending: false }).limit(limit);
      q = s.role === 'driver' && s.driverId ? q.eq('driver_id', s.driverId) : q.eq('customer_id', s.userId);
      const { data } = await q;
      return ((data ?? []) as OrderRow[]).map((r) => toHistory(mapOrderRow(r)));
    },
    subscribeOrder(orderId, cb) {
      const ch = sb
        .channel(`order:${orderId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, (payload) => {
          cb(mapOrderRow(payload.new as OrderRow));
        })
        .subscribe();
      return track(ch);
    },
    subscribeDriverLocation(driverId, cb) {
      sb.from('driver_locations').select('lat,lng,heading,speed').eq('driver_id', driverId).maybeSingle().then(({ data }) => {
        if (data) cb({ lat: data.lat, lng: data.lng, heading: data.heading ?? undefined, speed: data.speed ?? undefined });
      });
      const ch = sb
        .channel(`loc:${driverId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` }, (payload) => {
          const r = payload.new as { lat: number; lng: number; heading: number | null; speed: number | null };
          if (r && typeof r.lat === 'number') cb({ lat: r.lat, lng: r.lng, heading: r.heading ?? undefined, speed: r.speed ?? undefined });
        })
        .subscribe();
      return track(ch);
    },

    /* ---- driver ---- */
    async setOnline(online, loc) {
      const { error } = await sb.rpc('driver_set_online', { p_online: online, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null });
      if (error) throw new Error(error.message);
      if (cachedSession) cachedSession.driverOnline = online;
    },
    respondOffer: (orderId, accept) => rpcOrder('respond_offer', { p_order: orderId, p_accept: accept }),
    advanceOrder: (orderId, next, loc) => rpcOrder('advance_order', { p_order: orderId, p_next: next, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null }),
    async updateLocation(loc) {
      const { error } = await sb.rpc('update_driver_location', { p_lat: loc.lat, p_lng: loc.lng, p_heading: loc.heading ?? null, p_speed: loc.speed ?? null });
      if (error) throw new Error(error.message);
    },
    subscribeDriverOrders(cb) {
      const driverId = cachedDriverId;
      if (!driverId) return () => {};
      const handler = (payload: { new: unknown }) => cb(mapOrderRow(payload.new as OrderRow));
      const ch = sb
        .channel(`driver-orders:${driverId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `offered_driver_id=eq.${driverId}` }, handler)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `driver_id=eq.${driverId}` }, handler)
        .subscribe();
      return track(ch);
    },
    async getEarnings() {
      const { data, error } = await sb.rpc('my_earnings');
      if (error) throw new Error(error.message);
      const e = data as {
        today: number; trips_today: number; week: number[]; available: number; pending: number;
        recent: { order_id: string; order_no: string; from: string; to: string; pallets: number; cargo_type: string; gross: number; driver_amount: number; status: string; created_at: string }[];
      };
      return {
        today: e.today,
        tripsToday: e.trips_today,
        week: e.week,
        available: e.available,
        pending: e.pending,
        recent: e.recent.map((r) => {
          const d = new Date(r.created_at);
          return { id: r.order_id, orderNo: r.order_no, date: `${d.getMonth() + 1}/${d.getDate()}`, from: r.from, to: r.to, pallets: r.pallets, cargo: r.cargo_type, total: r.gross, driverAmount: r.driver_amount, status: 'completed' as OrderStatus };
        }),
      } satisfies EarningsSummary;
    },

    async setVehicleTailLift(has) {
      if (!cachedDriverId) throw new Error('not a driver');
      const { error } = await sb.from('vehicles').update({ has_tail_lift: has }).eq('driver_id', cachedDriverId).eq('active', true);
      if (error) throw new Error(error.message);
      if (cachedSession?.vehicle) cachedSession.vehicle.hasTailLift = has;
    },
    /* ---- carrier onboarding ---- */
    async getOnboarding() {
      const s = cachedSession ?? (await buildSession());
      if (!s?.driverId) throw new Error('not a driver');
      const { data, error } = await sb.from('drivers').select('*').eq('id', s.driverId).single();
      if (error || !data) throw new Error(error?.message ?? 'no driver row');
      return mapOnboarding(data);
    },
    async saveOnboarding(patch) {
      const s = cachedSession ?? (await buildSession());
      if (!s?.driverId) throw new Error('not a driver');
      const row: Record<string, unknown> = {};
      if (patch.licenseClass !== undefined) row.license_class = patch.licenseClass ?? null;
      if (patch.licenseExpiresOn !== undefined) row.license_expires_on = patch.licenseExpiresOn || null;
      if (patch.businessType !== undefined) row.business_type = patch.businessType ?? null;
      if (patch.invoiceBy !== undefined) row.invoice_by = patch.invoiceBy ?? null;
      if (patch.operatorName !== undefined) row.operator_name = patch.operatorName;
      if (patch.operatorTaxId !== undefined) row.operator_tax_id = patch.operatorTaxId;
      if (patch.acceptExternalLoads !== undefined) row.accept_external_loads = patch.acceptExternalLoads;
      if (patch.serviceAreas !== undefined) row.service_areas = patch.serviceAreas;
      if (patch.bankCode !== undefined) row.bank_code = patch.bankCode;
      if (patch.bankAccountNo !== undefined) row.bank_account_no = patch.bankAccountNo;
      if (patch.bankAccountName !== undefined) row.bank_account_name = patch.bankAccountName;
      if (patch.declarationAcceptedAt !== undefined) row.declaration_accepted_at = patch.declarationAcceptedAt ? new Date(patch.declarationAcceptedAt).toISOString() : null;
      if (patch.termsAcceptedAt !== undefined) {
        row.terms_accepted_at = patch.termsAcceptedAt ? new Date(patch.termsAcceptedAt).toISOString() : null;
        row.terms_version = 1;
      }
      const { data, error } = await sb.from('drivers').update(row).eq('id', s.driverId).select('*').single();
      if (error || !data) throw new Error(error?.message ?? 'save failed');
      return mapOnboarding(data);
    },
    async listCarrierDocs() {
      const s = cachedSession ?? (await buildSession());
      if (!s?.driverId) return [];
      const { data } = await sb.from('carrier_documents').select('*').eq('driver_id', s.driverId).order('uploaded_at');
      return ((data ?? []) as any[]).map(mapDoc);
    },
    async uploadCarrierDoc(kind, localUri) {
      const s = cachedSession ?? (await buildSession());
      if (!s?.driverId) throw new Error('not a driver');
      const res = await fetch(localUri);
      const blob = await res.blob();
      const type = blob.type && (blob.type.startsWith('image/') || blob.type === 'application/pdf') ? blob.type : 'image/jpeg';
      const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${s.userId}/${kind}-${Date.now()}.${ext}`;
      const up = await sb.storage.from('carrier-docs').upload(path, blob, { contentType: type, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { data, error } = await sb
        .from('carrier_documents')
        .upsert({ driver_id: s.driverId, kind, storage_path: path, status: 'pending', note: '', uploaded_at: new Date().toISOString(), reviewed_at: null }, { onConflict: 'driver_id,kind' })
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'save failed');
      return mapDoc(data);
    },
    async carrierDocUrl(storagePath) {
      const { data } = await sb.storage.from('carrier-docs').createSignedUrl(storagePath, 600);
      return data?.signedUrl ?? null;
    },
    async submitOnboarding() {
      const { data, error } = await sb.rpc('submit_onboarding');
      if (error) throw new Error(error.message);
      const ob = mapOnboarding(data);
      if (cachedSession) cachedSession.onboardingStatus = ob.status;
      return ob;
    },
    async setVehicleClass(classId) {
      if (!cachedDriverId) throw new Error('not a driver');
      const { error } = await sb.rpc('driver_set_vehicle_class', { p_class: classId });
      if (error) throw new Error(error.message);
      if (cachedSession?.vehicle) cachedSession.vehicle.classId = classId;
    },

    /* ---- push ---- */
    async registerPushToken(token, platform) {
      await sb.rpc('register_push_token', { p_token: token, p_platform: platform });
    },
  };
}

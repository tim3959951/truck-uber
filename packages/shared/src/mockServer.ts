/**
 * In-memory Backend used only when Supabase is not configured
 * (EXPO_PUBLIC_BACKEND=mock or missing keys). Lets you work on screens offline.
 * The real user flow never touches this file.
 *
 * Because each app runs alone here, the mock plays the *other* side:
 *  - role 'customer': a mock driver accepts, drives, loads, delivers.
 *  - role 'driver':   mock customers send requests while you are online.
 */
import type { Backend, Unsubscribe } from './backend';
import { CARGO_TYPES, DEFAULT_CLASSES, LOCATIONS, MOCK_CUSTOMER, MOCK_DRIVER, MOCK_HISTORY, TIERS, classById } from './data';
import { bearing, DEFAULT_PRICING, defaultEngine, routePath } from './pricing';
import type { DriverLocation, HistoryItem, Order, OrderInput, OrderStatus, Session, SignUpInput } from './types';

const APPROACH_MS = 14000;
const TRANSIT_MS = 22000;
let seq = 2412;

export function createMockServer(role: 'customer' | 'driver'): Backend {
  let order: Order | null = null;
  let online = false;
  let session: Session | null = null;
  const history: HistoryItem[] = [...MOCK_HISTORY];
  const earnings: { amount: number; at: number; item: HistoryItem }[] = [];
  const orderListeners = new Map<string, Set<(o: Order) => void>>();
  const driverListeners = new Set<(o: Order) => void>();
  const locListeners = new Set<(l: DriverLocation) => void>();
  const authListeners = new Set<(s: Session | null) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let animTimer: ReturnType<typeof setInterval> | null = null;

  const push = () => {
    if (!order) return;
    const snap = { ...order };
    orderListeners.get(snap.id)?.forEach((l) => l(snap));
    driverListeners.forEach((l) => l(snap));
    if (snap.driverPos) locListeners.forEach((l) => l({ lat: snap.driverPos![0], lng: snap.driverPos![1], heading: snap.heading }));
  };
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const clearAll = () => {
    timers.forEach(clearTimeout);
    timers.clear();
    if (animTimer) clearInterval(animTimer);
    animTimer = null;
  };
  const setStatus = (s: OrderStatus) => {
    if (!order) return;
    order.status = s;
    if (s === 'completed') order.completedAt = Date.now();
    push();
  };

  function animate(pts: [number, number][], ms: number, done: () => void) {
    if (animTimer) clearInterval(animTimer);
    const o = order!;
    const t0 = Date.now();
    animTimer = setInterval(() => {
      if (!order || order !== o) {
        if (animTimer) clearInterval(animTimer);
        return;
      }
      const t = Math.min(1, (Date.now() - t0) / ms);
      const idx = Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)));
      o.progress = t;
      o.driverPos = pts[idx];
      o.heading = bearing(pts[Math.max(0, idx - 1)], pts[Math.min(pts.length - 1, idx + 1)]);
      push();
      if (t >= 1) {
        if (animTimer) clearInterval(animTimer);
        animTimer = null;
        done();
      }
    }, 120);
  }

  function buildOrder(input: OrderInput): Order {
    const q = defaultEngine.quote(input.km, input.pallets, input.tier, { needTailLift: input.needTailLift, helpers: input.helpers }, classById(DEFAULT_CLASSES, input.classId), input.loadMode);
    return {
      id: 'mock-' + seq,
      orderNo: 'TK-' + seq++,
      pickup: input.pickup,
      drop: input.drop,
      pallets: input.pallets,
      cargo: input.cargo,
      note: input.note,
      tier: input.tier,
      needTailLift: input.needTailLift,
      helpers: input.helpers,
      cargoPhotoUrl: input.cargoPhotoUrl,
      classId: input.classId,
      loadMode: input.loadMode,
      weightT: input.weightT,
      quantityDesc: input.quantityDesc ?? '',
      km: input.km,
      distanceSource: input.distanceSource,
      quote: q,
      status: 'created',
      createdAt: Date.now(),
      customer: MOCK_CUSTOMER,
      path: input.path,
      progress: 0,
    };
  }

  function beginApproach() {
    const o = order!;
    o.driver = MOCK_DRIVER;
    const start = { lat: o.pickup.lat + 0.055, lng: o.pickup.lng + 0.045 };
    const approach = routePath(start, o.pickup, 30);
    o.driverPos = approach[0];
    o.progress = 0;
    o.offerExpiresAt = undefined;
    setStatus('accepted');
    animate(approach, APPROACH_MS, () => {
      setStatus('arrived');
      if (role === 'customer') later(6000, () => api.advanceOrder(o.id, 'in_transit'));
    });
  }

  function beginOffer() {
    if (!order || order.status !== 'searching') return;
    order.status = 'offered';
    order.offerExpiresAt = Date.now() + DEFAULT_PRICING.offerTimeoutSeconds * 1000;
    push();
  }

  function scheduleIncoming() {
    if (role !== 'driver' || !online || order) return;
    later(4000 + Math.random() * 4000, () => {
      if (!online || order) return;
      const pickup = LOCATIONS[Math.floor(Math.random() * 2)];
      const drops = LOCATIONS.filter((l) => l.id !== pickup.id);
      const drop = drops[Math.floor(Math.random() * drops.length)];
      const cargo = CARGO_TYPES[Math.floor(Math.random() * CARGO_TYPES.length)];
      const tier = TIERS[Math.random() < 0.7 ? 0 : 1];
      const path = routePath(pickup, drop);
      const km = Math.round(defaultKm(pickup, drop));
      order = buildOrder({ pickup, drop, pallets: 4 + Math.floor(Math.random() * 12), cargo, note: '', tier, needTailLift: Math.random() < 0.3, helpers: Math.random() < 0.2 ? 1 : 0, classId: '17t', loadMode: 'pallet', km, distanceSource: 'estimate', path });
      order.status = 'searching';
      beginOffer();
    });
  }
  const defaultKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s)) * 1.28;
  };

  const mockSession = (input?: SignUpInput): Session =>
    role === 'driver'
      ? { userId: 'mock-driver', email: input?.email ?? 'driver@mock', role: 'driver', name: input?.name ?? MOCK_DRIVER.name, phone: input?.phone ?? MOCK_DRIVER.phone, company: '', driverId: MOCK_DRIVER.id, driverOnline: online, driverRating: MOCK_DRIVER.rating, driverTrips: MOCK_DRIVER.trips, verification: 'verified', vehicle: { plate: input?.plate ?? MOCK_DRIVER.plate, desc: MOCK_DRIVER.truck, verification: 'verified', hasTailLift: true, classId: '17t' } }
      : { userId: 'mock-customer', email: input?.email ?? 'customer@mock', role: 'customer', name: input?.name ?? MOCK_CUSTOMER.contact, phone: input?.phone ?? MOCK_CUSTOMER.phone, company: input?.company ?? MOCK_CUSTOMER.company };

  const api: Backend = {
    kind: 'mock',

    getSession: async () => session,
    onAuthChange(cb) {
      authListeners.add(cb);
      return () => authListeners.delete(cb);
    },
    async signIn(email) {
      session = mockSession({ email, password: '', role, name: '', phone: '' });
      session.name = role === 'driver' ? MOCK_DRIVER.name : MOCK_CUSTOMER.contact;
      authListeners.forEach((l) => l(session));
      return session;
    },
    async signUp(input) {
      session = mockSession(input);
      authListeners.forEach((l) => l(session));
      return session;
    },
    async signOut() {
      clearAll();
      order = null;
      session = null;
      authListeners.forEach((l) => l(null));
    },
    getPricingConfig: async () => DEFAULT_PRICING,
    getVehicleClasses: async () => DEFAULT_CLASSES,

    async uploadCargoPhoto(localUri: string) {
      return localUri;
    },
    async createOrder(input) {
      clearAll();
      order = buildOrder(input);
      push();
      return { ...order };
    },
    async payOrderSandbox(orderId) {
      if (!order || order.id !== orderId) throw new Error('order not found');
      order.status = 'searching';
      push();
      if (role === 'customer') {
        later(2000, () => {
          if (!order) return;
          beginOffer();
          later(3000, () => order && beginApproach());
        });
      }
      return { ...order };
    },
    async pollOrder(orderId) {
      if (!order || order.id !== orderId) throw new Error('order not found');
      return { ...order };
    },
    async cancelOrder(orderId) {
      if (!order || order.id !== orderId) throw new Error('order not found');
      clearAll();
      order.status = 'cancelled';
      const snap = { ...order };
      push();
      order = null;
      return snap;
    },
    async rateOrder(orderId, stars) {
      if (!order || order.id !== orderId) throw new Error('order not found');
      order.rating = stars;
      const snap = { ...order };
      order = null;
      return snap;
    },

    getOrder: async (id) => (order && order.id === id ? { ...order } : null),
    getActiveOrder: async () => (order && !['completed', 'cancelled'].includes(order.status) ? { ...order } : null),
    listOrders: async () => history,
    subscribeOrder(orderId, cb): Unsubscribe {
      if (!orderListeners.has(orderId)) orderListeners.set(orderId, new Set());
      orderListeners.get(orderId)!.add(cb);
      return () => orderListeners.get(orderId)?.delete(cb);
    },
    subscribeDriverLocation(_driverId, cb) {
      locListeners.add(cb);
      return () => locListeners.delete(cb);
    },

    async setOnline(v) {
      online = v;
      if (session) session.driverOnline = v;
      if (v) scheduleIncoming();
      else if (order && (order.status === 'offered' || order.status === 'searching')) {
        clearAll();
        order = null;
      }
    },
    async respondOffer(orderId, accept) {
      if (!order || order.id !== orderId || order.status !== 'offered') throw new Error('offer is no longer available');
      if (!accept) {
        const snap = { ...order, status: 'cancelled' as OrderStatus };
        order = null;
        scheduleIncoming();
        return snap;
      }
      beginApproach();
      return { ...order };
    },
    async advanceOrder(orderId, next) {
      const o = order;
      if (!o || o.id !== orderId) throw new Error('not your order');
      if (next === 'in_transit' && o.status === 'arrived') {
        o.progress = 0;
        o.driverPos = o.path[0];
        setStatus('in_transit');
        animate(o.path, TRANSIT_MS, () => {
          setStatus('delivered');
          if (role === 'customer') later(5000, () => api.advanceOrder(o.id, 'completed'));
        });
      } else if (next === 'completed' && o.status === 'delivered') {
        setStatus('completed');
        const item: HistoryItem = { id: o.id, orderNo: o.orderNo, date: '今天', from: o.pickup.name, to: o.drop.name, pallets: o.pallets, cargo: o.cargo.name, total: o.quote.total, driverAmount: o.quote.driverAmount, status: 'completed' };
        history.unshift(item);
        earnings.unshift({ amount: o.quote.driverAmount, at: Date.now(), item });
        if (role === 'driver') later(2500, () => { order = null; scheduleIncoming(); });
      } else if (next === 'arrived' || next === 'delivered') {
        setStatus(next);
      } else throw new Error(`invalid transition ${o.status} -> ${next}`);
      return { ...o };
    },
    async updateLocation() {},
    subscribeDriverOrders(cb) {
      driverListeners.add(cb);
      return () => driverListeners.delete(cb);
    },
    async getEarnings() {
      const today = earnings.reduce((a, e) => a + e.amount, 0) + 8420;
      return { today, tripsToday: earnings.length + 3, week: [6200, 9100, 8800, 0, today, 0, 0], available: 24100, pending: today, recent: earnings.map((e) => e.item).concat(MOCK_HISTORY) };
    },
    async setVehicleClass(classId: string) {
      if (session?.vehicle) session.vehicle.classId = classId;
    },
    async setVehicleTailLift(has) {
      if (session?.vehicle) session.vehicle.hasTailLift = has;
    },
    async registerPushToken() {},
  };
  return api;
}

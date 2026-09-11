import { create } from 'zustand';
import {
  Backend,
  DEFAULT_CLASSES,
  DEFAULT_PRICING,
  DriverLocation,
  HistoryItem,
  LoadMode,
  Location,
  Order,
  OrderStatus,
  PricingConfig,
  PricingEngine,
  RouteResult,
  Session,
  SignUpInput,
  UNSET_DROP,
  UNSET_PICKUP,
  Unsubscribe,
  VehicleClass,
  cargoById,
  classById,
  createBackend,
  getCurrentLocation,
  getRoute,
  isSet,
  recommendClass,
  reverseGeocode,
  phaseProgress,
  registerForPush,
  tierById,
} from '@truck/shared';

export const backend: Backend = createBackend('customer');

const LIVE: OrderStatus[] = ['created', 'searching', 'offered', 'accepted', 'arrived', 'in_transit', 'delivered'];

type State = {
  authReady: boolean;
  session: Session | null;
  pricing: PricingConfig;
  engine: PricingEngine;
  classes: VehicleClass[];
  // booking draft
  pickup: Location;
  drop: Location;
  /** device position (asked once at start, never required) */
  myLoc: Location | null;
  pallets: number;
  cargoId: string;
  note: string;
  /** local uri of the cargo photo taken on this device (uploaded at requestTruck) */
  cargoPhotoUri: string | null;
  /** 棧板模式 or 整車 */
  loadMode: LoadMode;
  /** 客戶填的總重量（噸），選填 */
  weightT: number | null;
  /** 整車模式：數量描述 */
  quantityDesc: string;
  classId: string;
  /** true once the customer picked a class by hand; auto-recommendation stops overriding it */
  classPicked: boolean;
  tierId: 'dedicated' | 'backhaul';
  needTailLift: boolean;
  helpers: number;
  route: RouteResult | null;
  routeLoading: boolean;
  // live
  order: Order | null;
  driverLoc: DriverLocation | null;
  toast: string | null;
  history: HistoryItem[];
  rating: number;
  busy: boolean;

  set: (patch: Partial<State>) => void;
  /** update cargo fields and re-run the class recommendation unless the customer picked one */
  setCargo: (patch: Partial<Pick<State, 'pallets' | 'weightT' | 'loadMode' | 'quantityDesc'>>) => void;
  pickClass: (classId: string) => void;
  /** ask for the device position; if the pickup is still unset, use it as the pickup */
  locateMe: () => Promise<void>;
  swapRoute: () => void;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<boolean>;
  signOut: () => Promise<void>;
  loadRoute: () => Promise<void>;
  requestTruck: () => Promise<Order>;
  pay: () => Promise<Order>;
  cancel: (reason?: string) => Promise<void>;
  submitRating: (tags: string[], comment?: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  applyOrder: (o: Order | null) => void;
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export const showToast = (message: string) => {
  useStore.setState({ toast: message });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useStore.setState({ toast: null }), 2800);
};

export const useStore = create<State>((set, get) => ({
  authReady: false,
  session: null,
  pricing: DEFAULT_PRICING,
  engine: new PricingEngine(DEFAULT_PRICING),
  classes: DEFAULT_CLASSES,
  pickup: UNSET_PICKUP,
  drop: UNSET_DROP,
  myLoc: null,
  pallets: 8,
  cargoId: 'soil',
  note: '',
  cargoPhotoUri: null,
  loadMode: 'pallet',
  weightT: null,
  quantityDesc: '',
  classId: '17t',
  classPicked: false,
  tierId: 'dedicated',
  needTailLift: false,
  helpers: 0,
  route: null,
  routeLoading: false,
  order: null,
  driverLoc: null,
  toast: null,
  history: [],
  rating: 0,
  busy: false,

  set: (patch) => set(patch),
  setCargo(patch) {
    const next = { ...get(), ...patch };
    const rec = recommendClass(next.classes, next.pallets, next.weightT ?? undefined, next.loadMode);
    const cur = classById(next.classes, next.classId);
    const curFits = (next.loadMode === 'full' || cur.maxPallets >= next.pallets) && (next.weightT == null || cur.maxWeightT >= next.weightT);
    // keep a hand-picked class while it still fits; otherwise follow the recommendation
    set({ ...patch, classId: next.classPicked && curFits ? next.classId : rec.id, classPicked: next.classPicked && curFits });
  },
  pickClass(classId) {
    set({ classId, classPicked: true });
  },
  async locateMe() {
    const loc = await getCurrentLocation();
    if (!loc) return;
    const addr = (await reverseGeocode(loc).catch(() => null)) ?? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
    const me: Location = { id: 'me', name: '目前位置', addr, lat: loc.lat, lng: loc.lng };
    set({ myLoc: me });
    if (!isSet(get().pickup)) set({ pickup: me });
  },
  swapRoute() {
    const { pickup, drop } = get();
    if (!isSet(pickup) && !isSet(drop)) return;
    set({ pickup: isSet(drop) ? drop : UNSET_PICKUP, drop: isSet(pickup) ? pickup : UNSET_DROP, route: null });
  },

  async init() {
    const session = await backend.getSession().catch(() => null);
    set({ session, authReady: true });
    if (session) await afterLogin();
    get().locateMe().catch(() => {});
  },
  async signIn(email, password) {
    const session = await backend.signIn(email, password);
    if (session.role !== 'customer') {
      await backend.signOut();
      throw new Error('這是客戶端 App，請用客戶帳號登入（司機請使用司機端 App）');
    }
    set({ session });
    await afterLogin();
  },
  async signUp(input) {
    const session = await backend.signUp({ ...input, role: 'customer' });
    if (!session) return false; // e-mail confirmation pending
    set({ session });
    await afterLogin();
    return true;
  },
  async signOut() {
    stopWatching();
    await backend.signOut();
    set({ session: null, order: null, driverLoc: null, history: [], route: null });
  },

  async loadRoute() {
    const { pickup, drop } = get();
    set({ routeLoading: true });
    const route = await getRoute(pickup, drop);
    set({ route, routeLoading: false });
  },
  async requestTruck() {
    const s = get();
    const route = s.route ?? (await getRoute(s.pickup, s.drop));
    set({ busy: true });
    try {
      let cargoPhotoUrl: string | undefined;
      if (s.cargoPhotoUri) {
        try {
          cargoPhotoUrl = await backend.uploadCargoPhoto(s.cargoPhotoUri);
        } catch (e) {
          // photo is optional: the order still goes out, the customer is told
          showToast('照片上傳失敗，訂單不含照片：' + (e as Error).message);
        }
      }
      const order = await backend.createOrder({
        pickup: s.pickup,
        drop: s.drop,
        pallets: s.pallets,
        cargo: cargoById(s.cargoId),
        note: s.note,
        tier: tierById(s.tierId),
        needTailLift: s.needTailLift,
        helpers: s.helpers,
        classId: s.classId,
        loadMode: s.loadMode,
        weightT: s.weightT ?? undefined,
        quantityDesc: s.quantityDesc,
        cargoPhotoUrl,
        km: route.km,
        distanceSource: route.source,
        path: route.path,
      });
      get().applyOrder(order);
      // add-ons and note are per-order; don't carry them into the next booking
      set({ needTailLift: false, helpers: 0, note: '', cargoPhotoUri: null, weightT: null, quantityDesc: '', loadMode: 'pallet', classPicked: false, route: null });
      return order;
    } finally {
      set({ busy: false });
    }
  },
  async pay() {
    const o = get().order;
    if (!o) throw new Error('沒有待付款的訂單');
    set({ busy: true });
    try {
      const paid = await backend.payOrderSandbox(o.id);
      get().applyOrder(paid);
      return paid;
    } finally {
      set({ busy: false });
    }
  },
  async cancel(reason) {
    const o = get().order;
    if (!o) return;
    await backend.cancelOrder(o.id, reason);
    stopWatching();
    set({ order: null, driverLoc: null });
  },
  async submitRating(tags, comment) {
    const o = get().order;
    if (!o) return;
    await backend.rateOrder(o.id, get().rating, tags, comment);
    stopWatching();
    set({ order: null, driverLoc: null, rating: 0 });
    get().loadHistory().catch(() => {});
  },
  async loadHistory() {
    const history = await backend.listOrders(50);
    set({ history });
  },

  applyOrder(o) {
    const prev = get().order;
    if (!o) {
      stopWatching();
      set({ order: null, driverLoc: null });
      return;
    }
    // keep the live position we already have; recompute derived progress
    const driverLoc = get().driverLoc;
    const merged: Order = {
      ...o,
      driverPos: driverLoc ? [driverLoc.lat, driverLoc.lng] : o.driverPos,
      heading: driverLoc?.heading ?? o.heading,
    };
    merged.progress = phaseProgress(merged);
    set({ order: merged });
    if (prev?.status !== merged.status) {
      const msg: Partial<Record<OrderStatus, string>> = {
        accepted: `${merged.driver?.name ?? '司機'} 已接單，正前往裝貨點`,
        arrived: '司機已抵達，請開始裝貨',
        in_transit: '貨物已上車，運送中',
        delivered: '大車已抵達卸貨點',
        completed: '運送完成',
      };
      if (prev && msg[merged.status]) showToast(msg[merged.status]!);
    }
    ensureWatching(merged);
  },
}));

/* ---------- live order plumbing (realtime + polling + driver location) ---------- */
let unsubOrder: Unsubscribe | null = null;
let unsubLoc: Unsubscribe | null = null;
let watchingId: string | null = null;
let watchingDriver: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopWatching() {
  unsubOrder?.();
  unsubLoc?.();
  unsubOrder = unsubLoc = null;
  watchingId = watchingDriver = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function ensureWatching(o: Order) {
  if (!LIVE.includes(o.status)) {
    // completed / cancelled: keep the order object for the receipt, drop subscriptions
    unsubOrder?.();
    unsubLoc?.();
    unsubOrder = unsubLoc = null;
    watchingId = watchingDriver = null;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    return;
  }
  if (watchingId !== o.id) {
    unsubOrder?.();
    watchingId = o.id;
    unsubOrder = backend.subscribeOrder(o.id, (fresh) => useStore.getState().applyOrder(fresh));
  }
  // while searching/offered, poll so expired offers are re-dispatched even if the driver app is gone
  const needPoll = o.status === 'searching' || o.status === 'offered';
  if (needPoll && !pollTimer) {
    pollTimer = setInterval(async () => {
      const cur = useStore.getState().order;
      if (!cur || !(cur.status === 'searching' || cur.status === 'offered')) return;
      try {
        const fresh = await backend.pollOrder(cur.id);
        useStore.getState().applyOrder(fresh);
      } catch {
        /* transient */
      }
    }, 5000);
  } else if (!needPoll && !pollTimer) {
    // accepted → delivered: Realtime is primary; re-read every 8 s in case a message was missed
    pollTimer = setInterval(async () => {
      const cur = useStore.getState().order;
      if (!cur || !LIVE.includes(cur.status) || cur.status === 'created') return;
      try {
        const fresh = await backend.getOrder(cur.id);
        if (fresh && fresh.status !== cur.status) useStore.getState().applyOrder(fresh);
      } catch {
        /* transient */
      }
    }, 8000);
  }
  const driverId = o.driver?.id;
  if (driverId && watchingDriver !== driverId) {
    unsubLoc?.();
    watchingDriver = driverId;
    unsubLoc = backend.subscribeDriverLocation(driverId, (loc) => {
      const cur = useStore.getState().order;
      if (!cur) return;
      const updated: Order = { ...cur, driverPos: [loc.lat, loc.lng], heading: loc.heading ?? cur.heading };
      updated.progress = phaseProgress(updated);
      useStore.setState({ driverLoc: loc, order: updated });
    });
  }
}

async function afterLogin() {
  const s = useStore.getState();
  backend.getPricingConfig().then((pricing) => useStore.setState({ pricing, engine: new PricingEngine(pricing) })).catch(() => {});
  backend.getVehicleClasses().then((classes) => useStore.setState({ classes })).catch(() => {});
  backend.getActiveOrder().then((o) => o && s.applyOrder(o)).catch(() => {});
  s.loadHistory().catch(() => {});
  registerForPush().then((t) => t && backend.registerPushToken(t.token, t.platform)).catch(() => {});
}

backend.onAuthChange((session) => {
  const cur = useStore.getState().session;
  if (!session && cur) {
    stopWatching();
    useStore.setState({ session: null, order: null, driverLoc: null });
  } else if (session && !cur) {
    useStore.setState({ session });
    afterLogin();
  }
});

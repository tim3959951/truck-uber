import { create } from 'zustand';
import {
  DEFAULT_CLASSES,
  Backend,
  DriverLocation,
  EarningsSummary,
  HistoryItem,
  Order,
  OrderStatus,
  Session,
  SignUpInput,
  Unsubscribe,
  createBackend,
  getCurrentLocation,
  registerForPush,
  watchLocation,
} from '@truck/shared';

export const backend: Backend = createBackend('driver');

const MINE: OrderStatus[] = ['accepted', 'arrived', 'in_transit', 'delivered'];

type State = {
  authReady: boolean;
  session: Session | null;
  online: boolean;
  order: Order | null;
  offerLeft: number;
  /** seconds the current offer started with (for the progress bar) */
  offerTotal: number;
  lastLoc: DriverLocation | null;
  locationDenied: boolean;
  toast: string | null;
  earnings: EarningsSummary | null;
  history: HistoryItem[];
  busy: boolean;

  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** re-read profile/driver row (e.g. after onboarding submit or admin approval) */
  refreshSession: () => Promise<void>;
  toggleOnline: () => Promise<void>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  advance: (next: OrderStatus) => Promise<void>;
  loadEarnings: () => Promise<void>;
  loadHistory: () => Promise<void>;
  setTailLift: (has: boolean) => Promise<void>;
  setVehicleClass: (classId: string) => Promise<void>;
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
  online: false,
  order: null,
  offerLeft: 0,
  offerTotal: 30,
  lastLoc: null,
  locationDenied: false,
  toast: null,
  earnings: null,
  history: [],
  busy: false,

  async init() {
    const session = await backend.getSession().catch(() => null);
    set({ session, authReady: true, online: !!session?.driverOnline });
    if (session) await afterLogin();
  },
  async signIn(email, password) {
    const session = await backend.signIn(email, password);
    if (session.role !== 'driver') {
      await backend.signOut();
      throw new Error('這是司機端 App，請用司機帳號登入（客戶請使用客戶端 App）');
    }
    set({ session, online: !!session.driverOnline });
    await afterLogin();
  },
  async signUp(input) {
    const session = await backend.signUp({ ...input, role: 'driver' });
    if (!session) return false;
    set({ session, online: false });
    await afterLogin();
    return true;
  },
  async refreshSession() {
    const session = await backend.getSession().catch(() => null);
    if (session) set({ session });
  },
  async signOut() {
    stopGps();
    stopPolling();
    unsubOrders?.();
    unsubOrders = null;
    if (get().online) await backend.setOnline(false).catch(() => {});
    await backend.signOut();
    set({ session: null, order: null, online: false, earnings: null, history: [] });
  },

  async toggleOnline() {
    const next = !get().online;
    set({ busy: true });
    try {
      if (next) {
        const loc = await getCurrentLocation();
        if (!loc) {
          // no position = no dispatch: a customer must never see a made-up truck location
          set({ locationDenied: true, online: false });
          throw new Error('需要開啟定位權限才能上線。請到手機設定允許「Pallo 承運人」使用位置，再試一次。');
        }
        await backend.setOnline(true, loc);
        set({ online: true, lastLoc: loc, locationDenied: false });
        await startGps();
        startPolling();
        // going online can dispatch a queued order immediately — read it now instead of waiting for Realtime/polling
        backend.getActiveOrder().then((o) => o && get().applyOrder(o)).catch(() => {});
      } else {
        stopGps();
        stopPolling();
        await backend.setOnline(false);
        const o = get().order;
        if (o && (o.status === 'offered' || o.status === 'searching')) set({ order: null });
        set({ online: false });
      }
    } finally {
      set({ busy: false });
    }
  },
  async accept() {
    const o = get().order;
    if (!o) return;
    set({ busy: true });
    try {
      const fresh = await backend.respondOffer(o.id, true);
      get().applyOrder(fresh);
      showToast('已接單，前往裝貨點');
    } finally {
      set({ busy: false });
    }
  },
  async decline() {
    const o = get().order;
    if (!o) return;
    try {
      await backend.respondOffer(o.id, false);
    } catch {
      /* offer may already be gone */
    }
    set({ order: null, offerLeft: 0 });
  },
  async advance(next) {
    const o = get().order;
    if (!o) return;
    set({ busy: true });
    try {
      const fresh = await backend.advanceOrder(o.id, next, get().lastLoc ?? undefined);
      get().applyOrder(fresh);
      if (next === 'completed') {
        showToast(`本趟收入 NT$ ${fresh.quote.driverAmount.toLocaleString('en-US')}`);
        get().loadEarnings().catch(() => {});
        get().loadHistory().catch(() => {});
        // clear the finished order after a moment so the next offer can show
        setTimeout(() => {
          const cur = get().order;
          if (cur && cur.id === fresh.id && cur.status === 'completed') set({ order: null });
        }, 2500);
      }
    } finally {
      set({ busy: false });
    }
  },
  async loadEarnings() {
    const earnings = await backend.getEarnings();
    set({ earnings });
  },
  async loadHistory() {
    const history = await backend.listOrders(50);
    set({ history });
  },
  async setTailLift(has) {
    await backend.setVehicleTailLift(has);
    const s = get().session;
    if (s?.vehicle) set({ session: { ...s, vehicle: { ...s.vehicle, hasTailLift: has } } });
  },  async setVehicleClass(classId) {
    await backend.setVehicleClass(classId);
    const s = get().session;
    if (s?.vehicle) set({ session: { ...s, vehicle: { ...s.vehicle, classId, desc: s.vehicle.desc.replace(/ · .*$/, '') + ' · ' + (DEFAULT_CLASSES.find((k) => k.id === classId)?.name ?? classId) } } });
  },


  applyOrder(o) {
    const prev = get().order;
    const me = get().session?.driverId;
    if (!o) {
      set({ order: null, offerLeft: 0 });
      return;
    }
    // Realtime can deliver rows that stopped concerning us (offer moved on / cancelled).
    const isOffer = o.status === 'offered';
    const isMine = MINE.includes(o.status) && !!o.driver && (!me || o.driver.id === me);
    if (o.status === 'cancelled') {
      if (prev && prev.id === o.id) {
        set({ order: null, offerLeft: 0 });
        if (MINE.includes(prev.status)) showToast('客戶已取消此單');
      }
      return;
    }
    if (o.status === 'completed' && prev && prev.id === o.id) {
      set({ order: o });
      return;
    }
    if (!isOffer && !isMine) {
      // e.g. searching (we declined / expired) — drop it if it is the one we were showing
      if (prev && prev.id === o.id) set({ order: null, offerLeft: 0 });
      return;
    }
    const left = isOffer && o.offerExpiresAt ? Math.max(0, Math.round((o.offerExpiresAt - Date.now()) / 1000)) : 0;
    const isNewOffer = isOffer && (!prev || prev.id !== o.id || prev.status !== 'offered');
    set({ order: o, offerLeft: left, offerTotal: isNewOffer ? Math.max(left, 5) : get().offerTotal });
  },
}));

/* ---------- realtime: orders offered to / assigned to me ---------- */
let unsubOrders: Unsubscribe | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Safety net under Realtime: while online, re-read my active/offered order every
 * few seconds so an offer still shows up if the websocket is blocked or asleep.
 */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const s = useStore.getState();
    if (!s.session || !s.online || s.busy) return;
    try {
      const fresh = await backend.getActiveOrder();
      const cur = s.order;
      if (fresh) {
        if (!cur || cur.id !== fresh.id || cur.status !== fresh.status) s.applyOrder(fresh);
      } else if (cur && cur.status !== 'completed') {
        // the order we were showing is gone (cancelled / re-dispatched elsewhere)
        s.applyOrder({ ...cur, status: 'cancelled' });
      }
    } catch {
      /* transient */
    }
  }, 4000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
let stopGpsFn: (() => void) | null = null;
let lastSent = 0;

async function startGps() {
  if (stopGpsFn) return;
  stopGpsFn = await watchLocation((loc) => {
    useStore.setState({ lastLoc: loc });
    const now = Date.now();
    if (now - lastSent < 5000) return; // ≤ 1 upload / 5 s
    lastSent = now;
    backend.updateLocation(loc).catch(() => {});
  });
}
function stopGps() {
  stopGpsFn?.();
  stopGpsFn = null;
}

async function afterLogin() {
  const s = useStore.getState();
  unsubOrders?.();
  unsubOrders = backend.subscribeDriverOrders((o) => useStore.getState().applyOrder(o));
  backend.getActiveOrder().then((o) => o && s.applyOrder(o)).catch(() => {});
  s.loadEarnings().catch(() => {});
  s.loadHistory().catch(() => {});
  registerForPush().then((t) => t && backend.registerPushToken(t.token, t.platform)).catch(() => {});
  if (useStore.getState().online) {
    startGps().catch(() => {});
    startPolling();
  }
}

// offer countdown (server enforces expiry; this is display + auto-decline)
setInterval(() => {
  const s = useStore.getState();
  const o = s.order;
  if (!o || o.status !== 'offered' || !o.offerExpiresAt) return;
  const left = Math.max(0, Math.round((o.offerExpiresAt - Date.now()) / 1000));
  if (left !== s.offerLeft) useStore.setState({ offerLeft: left });
  if (left === 0 && !s.busy) s.decline();
}, 500);

backend.onAuthChange((session) => {
  const cur = useStore.getState().session;
  if (!session && cur) {
    stopGps();
    stopPolling();
    unsubOrders?.();
    unsubOrders = null;
    useStore.setState({ session: null, order: null, online: false });
  } else if (session && !cur) {
    useStore.setState({ session, online: !!session.driverOnline });
    afterLogin();
  }
});

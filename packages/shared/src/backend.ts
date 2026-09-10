/**
 * The one seam between the apps and the outside world.
 *
 * `supabaseBackend.ts` is the real implementation (Auth + Postgres RPCs +
 * Realtime). `mockServer.ts` implements the same interface in memory for
 * offline UI work. Screens only ever import `Backend`.
 */
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
} from './types';

export type Unsubscribe = () => void;

export interface Backend {
  readonly kind: 'supabase' | 'mock';

  // ---- auth --------------------------------------------------------------
  getSession(): Promise<Session | null>;
  onAuthChange(cb: (s: Session | null) => void): Unsubscribe;
  signIn(email: string, password: string): Promise<Session>;
  /** Returns null when the project requires e-mail confirmation first. */
  signUp(input: SignUpInput): Promise<Session | null>;
  signOut(): Promise<void>;

  // ---- config --------------------------------------------------------------
  getPricingConfig(): Promise<PricingConfig>;

  // ---- orders (customer) ---------------------------------------------------
  /** Creates the order in `created` (awaiting payment). Price is computed server-side. */
  createOrder(input: OrderInput): Promise<Order>;
  /** Sandbox payment → `searching` and dispatch. */
  payOrderSandbox(orderId: string): Promise<Order>;
  /** Called every few seconds while searching/offered: expires stale offers, re-dispatches. */
  pollOrder(orderId: string): Promise<Order>;
  cancelOrder(orderId: string, reason?: string): Promise<Order>;
  rateOrder(orderId: string, stars: number, tags: string[]): Promise<Order>;

  // ---- orders (both roles) -------------------------------------------------
  getOrder(orderId: string): Promise<Order | null>;
  /** The caller's live order (any status before completed/cancelled), if any. */
  getActiveOrder(): Promise<Order | null>;
  listOrders(limit?: number): Promise<HistoryItem[]>;
  subscribeOrder(orderId: string, cb: (o: Order) => void): Unsubscribe;
  subscribeDriverLocation(driverId: string, cb: (loc: DriverLocation) => void): Unsubscribe;

  // ---- driver --------------------------------------------------------------
  setOnline(online: boolean, loc?: DriverLocation): Promise<void>;
  respondOffer(orderId: string, accept: boolean): Promise<Order>;
  advanceOrder(orderId: string, next: OrderStatus, loc?: DriverLocation): Promise<Order>;
  updateLocation(loc: DriverLocation): Promise<void>;
  /** Orders offered to or assigned to the signed-in driver (realtime). */
  subscribeDriverOrders(cb: (o: Order) => void): Unsubscribe;
  getEarnings(): Promise<EarningsSummary>;
  /** Driver flags whether their active vehicle has a hydraulic tail lift. */
  setVehicleTailLift(has: boolean): Promise<void>;

  // ---- push ----------------------------------------------------------------
  registerPushToken(token: string, platform: string): Promise<void>;
}

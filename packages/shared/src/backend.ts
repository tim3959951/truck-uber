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
  VehicleClass,
  Contract,
  Onboarding,
  CarrierDoc,
  DocKind,
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
  /** 車型級距與各自費率（後台可改）。 */
  getVehicleClasses(): Promise<VehicleClass[]>;

  // ---- orders (customer) ---------------------------------------------------
  /** Creates the order in `created` (awaiting payment). Price is computed server-side. */
  /** Uploads a local image (file:/blob:/data: uri) and returns a public URL. Throws on failure. */
  uploadCargoPhoto(localUri: string): Promise<string>;
  createOrder(input: OrderInput): Promise<Order>;
  /** Sandbox payment → `searching` and dispatch. */
  payOrderSandbox(orderId: string): Promise<Order>;
  /** Called every few seconds while searching/offered: expires stale offers, re-dispatches. */
  pollOrder(orderId: string): Promise<Order>;
  cancelOrder(orderId: string, reason?: string): Promise<Order>;
  rateOrder(orderId: string, stars: number, tags: string[]): Promise<Order>;

  // ---- contract (formed automatically when a driver accepts) ---------------
  getContract(orderId: string): Promise<Contract | null>;
  /** current user (customer or carrier driver) marks the contract as read */
  ackContract(contractId: string): Promise<Contract>;

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
  /** driver: my vehicle belongs to this class (派單只派同級距) */
  setVehicleClass(classId: string): Promise<void>;

  // ---- carrier onboarding / eligibility review (0006) ----------------------
  getOnboarding(): Promise<Onboarding>;
  saveOnboarding(patch: Partial<Onboarding>): Promise<Onboarding>;
  listCarrierDocs(): Promise<CarrierDoc[]>;
  /** uploads to the private bucket and upserts the carrier_documents row */
  uploadCarrierDoc(kind: DocKind, localUri: string): Promise<CarrierDoc>;
  /** short-lived signed URL for previewing one of my documents */
  carrierDocUrl(storagePath: string): Promise<string | null>;
  submitOnboarding(): Promise<Onboarding>;

  // ---- push ----------------------------------------------------------------
  registerPushToken(token: string, platform: string): Promise<void>;
}

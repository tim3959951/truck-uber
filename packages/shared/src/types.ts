export type LatLng = { lat: number; lng: number };

export type Location = LatLng & {
  id: string;
  name: string;
  addr: string;
};

export type CargoType = {
  id: string;
  name: string;
  /** short hint shown to drivers about handling */
  hint: string;
};

export type TierId = 'dedicated' | 'backhaul';

export type Tier = {
  id: TierId;
  name: string;
  desc: string;
  /** multiplier applied to the subtotal */
  factor: number;
  eta: string;
};

export type Quote = {
  distanceFee: number;
  palletFee: number;
  subtotal: number;
  /** (distanceFee + palletFee) × tier multiplier, rounded to NT$10 */
  baseTotal: number;
  tailLiftFee: number;
  helperFee: number;
  total: number;
  factor: number;
  platformFee: number;
  driverAmount: number;
};

export type Addons = { needTailLift: boolean; helpers: number };

/** 棧板模式（按托計價）或整車（付滿載價，數量用文字描述） */
export type LoadMode = 'pallet' | 'full';

/** Mirrors public.vehicle_classes — 車型級距，各有自己的費率與上限；後台可改。 */
export type VehicleClass = {
  id: string;
  name: string;
  nickname: string;
  sort: number;
  active: boolean;
  baseFare: number;
  perKm: number;
  perPallet: number;
  maxPallets: number;
  maxWeightT: number;
  deckM: number;
  grossT: string;
};

/** Mirrors public.pricing_config — editable by admin, never hard-coded in screens. */
export type PricingConfig = {
  baseFare: number;
  perKm: number;
  perPallet: number;
  dedicatedMultiplier: number;
  backhaulMultiplier: number;
  platformFeeRate: number;
  serviceRadiusKm: number;
  offerTimeoutSeconds: number;
  maxPallets: number;
  /** flat per-trip fee when the truck must have a hydraulic tail lift */
  tailLiftFee: number;
  /** flat per-person per-trip fee for professional loading helpers */
  helperFee: number;
};

export type Driver = {
  id: string;
  name: string;
  initials: string;
  rating: number;
  trips: number;
  plate: string;
  truck: string;
  color: string;
  phone: string;
};

export type Customer = {
  id: string;
  company: string;
  contact: string;
  phone: string;
};

export type OrderStatus =
  | 'created'
  | 'searching'
  | 'offered'
  | 'accepted'
  | 'arrived'
  | 'in_transit'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type Order = {
  id: string;
  orderNo: string;
  pickup: Location;
  drop: Location;
  pallets: number;
  cargo: CargoType;
  note: string;
  tier: Tier;
  needTailLift: boolean;
  helpers: number;
  classId: string;
  loadMode: LoadMode;
  weightT?: number;
  quantityDesc: string;
  /** 客戶下單時拍的現場貨物照片（公開網址） */
  cargoPhotoUrl?: string;
  km: number;
  distanceSource: 'osrm' | 'google' | 'estimate';
  quote: Quote;
  status: OrderStatus;
  createdAt: number;
  completedAt?: number;
  offerExpiresAt?: number;
  driver?: Driver;
  customer: Customer;
  /** route pickup → drop, [lat,lng] */
  path: [number, number][];
  /** driver's live position (from driver_locations) */
  driverPos?: [number, number];
  heading?: number;
  /** 0..1 progress of the current driving phase (derived from distance) */
  progress: number;
  rating?: number;
};

export type OrderInput = {
  pickup: Location;
  drop: Location;
  pallets: number;
  cargo: CargoType;
  note: string;
  tier: Tier;
  needTailLift: boolean;
  helpers: number;
  classId: string;
  loadMode: LoadMode;
  weightT?: number;
  quantityDesc?: string;
  cargoPhotoUrl?: string;
  km: number;
  distanceSource: 'osrm' | 'google' | 'estimate';
  path: [number, number][];
};

export type HistoryItem = {
  id: string;
  orderNo: string;
  date: string;
  from: string;
  to: string;
  /** full locations so a past address can be re-used with one tap */
  fromLoc?: Location;
  toLoc?: Location;
  pallets: number;
  loadMode?: LoadMode;
  quantityDesc?: string;
  classId?: string;
  cargo: string;
  total: number;
  driverAmount: number;
  status: OrderStatus;
};

export type EarningsSummary = {
  today: number;
  tripsToday: number;
  /** Mon..Sun totals for the current week */
  week: number[];
  available: number;
  pending: number;
  recent: HistoryItem[];
};

export type Role = 'customer' | 'driver' | 'admin';

export type Session = {
  userId: string;
  email: string;
  role: Role;
  name: string;
  phone: string;
  company: string;
  driverId?: string;
  driverOnline?: boolean;
  driverRating?: number;
  driverTrips?: number;
  verification?: 'pending' | 'verified' | 'rejected';
  vehicle?: { plate: string; desc: string; verification: 'pending' | 'verified' | 'rejected'; hasTailLift: boolean; classId: string };
};

export type SignUpInput = {
  email: string;
  password: string;
  role: 'customer' | 'driver';
  name: string;
  phone: string;
  company?: string;
  plate?: string;
  makeModel?: string;
  hasTailLift?: boolean;
  classId?: string;
};

export type DriverLocation = { lat: number; lng: number; heading?: number; speed?: number };

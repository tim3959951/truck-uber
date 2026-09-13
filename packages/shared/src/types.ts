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
  /** 0013: phone must be verified before ordering / submitting onboarding */
  requirePhoneVerification: boolean;
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
  /** 0006: carrier eligibility review state */
  onboardingStatus?: OnboardingStatus;
  reviewNote?: string;
  /** 0013: phone OTP verified (profiles.phone_verified_at) */
  phoneVerified?: boolean;
  /** 0013: platform requires a verified phone to order / submit onboarding (pricing_config.require_phone_verification) */
  phoneVerificationRequired?: boolean;
};

export type OnboardingStatus = 'draft' | 'submitted' | 'needs_fix' | 'approved' | 'rejected';
/** own_operator 自營貨運行（自己開發票）| affiliated 靠行（發票由靠行公司代開或不開）。0013 拿掉「受僱」。 */
export type BusinessType = 'own_operator' | 'affiliated';
/** 誰開發票：self 自己開 | operator 靠行公司代開 | none 無法開發票（只能收據） */
export type InvoiceBy = 'self' | 'operator' | 'none';
export type DocKind =
  | 'id_front' | 'id_back' | 'license' | 'license_back' | 'vehicle_reg' | 'vehicle_front' | 'vehicle_bed'
  | 'business_proof' | 'affiliation_proof' | 'insurance_compulsory' | 'insurance_liability' | 'insurance_cargo' | 'bank_passbook';

/** Mirrors the 0006 columns on public.drivers a carrier fills in before review. */
export type Onboarding = {
  status: OnboardingStatus;
  reviewNote: string;
  submittedAt?: number;
  licenseClass?: '大貨車' | '聯結車';
  licenseExpiresOn?: string; // YYYY-MM-DD
  businessType?: BusinessType;
  invoiceBy?: InvoiceBy;
  operatorName: string;
  operatorTaxId: string;
  /** kept in the DB, no longer shown in the App (0013) */
  acceptExternalLoads: boolean;
  serviceAreas: string[];
  bankCode: string;
  bankAccountNo: string;
  bankAccountName: string;
  declarationAcceptedAt?: number;
  termsAcceptedAt?: number;
};

export type CarrierDoc = {
  id: string;
  kind: DocKind;
  storagePath: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string;
  uploadedAt: number;
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
  /** platform terms version the user ticked at signup */
  termsVersion?: string;
};

export type DriverLocation = { lat: number; lng: number; heading?: number; speed?: number };

/** Mirrors public.contracts — 客戶與實際承運人之間的電子運送契約（接單時成立、不可修改） */
export type Contract = {
  id: string;
  contractNo: string;
  orderId: string;
  version: number;
  termsVersion: number;
  termsText: string;
  /** snapshot: { order, customer, carrier, platform } — see form_contract in 0005 */
  content: Record<string, any>;
  carrierType: 'driver' | 'operator';
  contentHash: string;
  formedAt: number;
  customerAckAt?: number;
  carrierAckAt?: number;
};

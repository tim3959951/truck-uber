import type { Addons, LatLng, LoadMode, PricingConfig, Quote, Tier, VehicleClass } from './types';

/** Placeholder values; the server's `pricing_config` row is the source of truth. */
export const DEFAULT_PRICING: PricingConfig = {
  baseFare: 1500,
  perKm: 38,
  perPallet: 150,
  dedicatedMultiplier: 1.0,
  backhaulMultiplier: 0.75,
  platformFeeRate: 0.15,
  serviceRadiusKm: 60,
  offerTimeoutSeconds: 15,
  maxPallets: 16,
  tailLiftFee: 1000,
  helperFee: 3000,
  requirePhoneVerification: false,
};

/** Kept for existing call sites; equals DEFAULT_PRICING. */
export const PRICING = {
  base: DEFAULT_PRICING.baseFare,
  perKm: DEFAULT_PRICING.perKm,
  perPallet: DEFAULT_PRICING.perPallet,
  platformCut: DEFAULT_PRICING.platformFeeRate,
  maxPallets: DEFAULT_PRICING.maxPallets,
};

/**
 * Deterministic pricing engine. Same arithmetic as `public.quote_price` in
 * the database so the app can show a quote instantly, but the server's number
 * is what gets charged. Future inputs (supply/demand, time, weather, backhaul
 * opportunity) plug in as extra multipliers here and in SQL — never in screens.
 */
export class PricingEngine {
  constructor(public config: PricingConfig = DEFAULT_PRICING) {}

  multiplierFor(tier: Tier): number {
    return tier.id === 'backhaul' ? this.config.backhaulMultiplier : this.config.dedicatedMultiplier;
  }

  /**
   * 總運費 = round10((級距起步 + km×級距每公里 + 托數×級距每托) × 專車/回頭車係數) + 尾門費 + 搬工人數×搬工費
   * 整車模式的托數 = 該級距的 max_pallets（付滿載價）。Add-ons are flat: a backhaul discount should not discount a helper's labour.
   */
  quote(km: number, pallets: number, tier: Tier, addons: Addons = { needTailLift: false, helpers: 0 }, cls?: VehicleClass, loadMode: LoadMode = 'pallet'): Quote {
    const c = this.config;
    // rates come from the vehicle class (0004); without one, fall back to the legacy 17t numbers in pricing_config
    const baseFare = cls ? cls.baseFare : c.baseFare;
    const perKm = cls ? cls.perKm : c.perKm;
    const perPallet = cls ? cls.perPallet : c.perPallet;
    const billedPallets = loadMode === 'full' ? (cls ? cls.maxPallets : c.maxPallets) : pallets;
    const distanceFee = baseFare + Math.round(km * perKm);
    const palletFee = billedPallets * perPallet;
    const subtotal = distanceFee + palletFee;
    const factor = this.multiplierFor(tier);
    const baseTotal = Math.round((subtotal * factor) / 10) * 10;
    const tailLiftFee = addons.needTailLift ? c.tailLiftFee : 0;
    const helperFee = Math.max(0, Math.min(2, addons.helpers)) * c.helperFee;
    const total = baseTotal + tailLiftFee + helperFee;
    const platformFee = Math.round(total * c.platformFeeRate);
    return { distanceFee, palletFee, subtotal, baseTotal, tailLiftFee, helperFee, total, factor, platformFee, driverAmount: total - platformFee };
  }
}

export const defaultEngine = new PricingEngine();
export const quote = (km: number, pallets: number, tier: Tier, addons?: Addons): Quote => defaultEngine.quote(km, pallets, tier, addons);
export const driverPayout = (total: number, rate = DEFAULT_PRICING.platformFeeRate) => total - Math.round(total * rate);

/* ---------- geometry helpers ---------- */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Fallback when no routing service is reachable: straight line × 1.28. */
export const estimateRoadKm = (a: LatLng, b: LatLng) => Math.round(haversineKm(a, b) * 1.28 * 10) / 10;
export const roadKm = (a: LatLng, b: LatLng) => Math.round(estimateRoadKm(a, b));

/** Minutes at ~60 km/h average for a loaded 17-ton truck. */
export const kmToMinutes = (km: number) => Math.max(4, Math.round(km));

/** Gently curved fallback path so an estimated route doesn't look like a ruler. */
export function routePath(a: LatLng, b: LatLng, n = 40): [number, number][] {
  const pts: [number, number][] = [];
  const mx = (a.lat + b.lat) / 2;
  const my = (a.lng + b.lng) / 2;
  const dx = b.lat - a.lat;
  const dy = b.lng - a.lng;
  const cx = mx - dy * 0.18;
  const cy = my + dx * 0.18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const lat = (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * cx + t * t * b.lat;
    const lng = (1 - t) ** 2 * a.lng + 2 * (1 - t) * t * cy + t * t * b.lng;
    pts.push([lat, lng]);
  }
  return pts;
}

export function pathLengthKm(path: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < path.length; i++) {
    km += haversineKm({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] });
  }
  return km;
}

export function bearing(p: [number, number], q: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(q[1] - p[1])) * Math.cos(toRad(q[0]));
  const x =
    Math.cos(toRad(p[0])) * Math.sin(toRad(q[0])) -
    Math.sin(toRad(p[0])) * Math.cos(toRad(q[0])) * Math.cos(toRad(q[1] - p[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** 0..1 how far along a phase the driver is, from live position and the phase's endpoints. */
export function phaseProgress(order: { status: string; driverPos?: [number, number]; pickup: LatLng; drop: LatLng; km: number; path: [number, number][] }): number {
  if (!order.driverPos) return 0;
  const here = { lat: order.driverPos[0], lng: order.driverPos[1] };
  if (order.status === 'accepted') {
    const remaining = haversineKm(here, order.pickup);
    return Math.max(0, Math.min(1, 1 - remaining / 10)); // assume ≤10 km approach
  }
  if (order.status === 'in_transit') {
    const remaining = haversineKm(here, order.drop) * 1.2;
    return Math.max(0, Math.min(1, 1 - remaining / Math.max(1, order.km)));
  }
  if (order.status === 'arrived') return 0;
  return 1;
}

export const formatNTD = (n: number) => 'NT$ ' + Math.round(n).toLocaleString('en-US');

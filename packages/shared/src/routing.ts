/**
 * Road routing. Default: OSRM (public demo server, no key). Set
 * EXPO_PUBLIC_OSRM_URL to your own OSRM / a compatible provider. Falls back to
 * the straight-line estimate so a quote can always be produced; the order
 * records which source was used (`distance_source`).
 */
import { estimateRoadKm, routePath } from './pricing';
import type { LatLng } from './types';

export type RouteResult = {
  km: number;
  minutes: number;
  path: [number, number][];
  source: 'osrm' | 'estimate';
};

const OSRM_URL = (process.env.EXPO_PUBLIC_OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');

export async function getRoute(a: LatLng, b: LatLng, timeoutMs = 7000): Promise<RouteResult> {
  const fallback = (): RouteResult => ({ km: estimateRoadKm(a, b), minutes: Math.round(estimateRoadKm(a, b)), path: routePath(a, b), source: 'estimate' });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const url = `${OSRM_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return fallback();
    const json = (await res.json()) as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
    const r = json.routes?.[0];
    if (json.code !== 'Ok' || !r) return fallback();
    const coords = r.geometry.coordinates;
    // thin very long polylines so the order row stays small (≤ ~400 points)
    const step = Math.max(1, Math.floor(coords.length / 400));
    const path = coords.filter((_, i) => i % step === 0 || i === coords.length - 1).map(([lng, lat]) => [lat, lng] as [number, number]);
    return { km: Math.round((r.distance / 1000) * 10) / 10, minutes: Math.round(r.duration / 60), path, source: 'osrm' };
  } catch {
    return fallback();
  }
}

/* ---------- geocoding ---------- */
// Provider order: Google Places (New) when EXPO_PUBLIC_GOOGLE_MAPS_KEY is set, else Nominatim (OSM).
// Nominatim cannot find Taiwan street numbers (…路100號) or business names (龍盛資材有限公司),
// so production needs the Google key; Nominatim stays as the zero-config fallback.
const NOMINATIM_URL = (process.env.EXPO_PUBLIC_NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const GOOGLE_KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || '').trim();

export type GeocodeHit = {
  name: string;
  addr: string;
  /** missing until `resolveHit` is called (Google Autocomplete only returns a place id) */
  lat?: number;
  lng?: number;
  placeId?: string;
};

export const geocodeProvider = (): 'google' | 'nominatim' => (GOOGLE_KEY ? 'google' : 'nominatim');

// One autocomplete "session" = the keystrokes leading to one Place Details call; Google bills it as a unit.
let sessionToken = '';
const newSession = () => (sessionToken = Math.random().toString(36).slice(2) + Date.now().toString(36));

/** Free-text search limited to Taiwan. Debounce in the UI (Nominatim asks for ≤ 1 req/s). */
export async function geocode(q: string, near?: LatLng): Promise<GeocodeHit[]> {
  if (q.trim().length < 2) return [];
  return GOOGLE_KEY ? geocodeGoogle(q, near) : geocodeNominatim(q);
}

/** Fills lat/lng for a hit chosen from the list (Google needs a second call; Nominatim hits already have them). */
export async function resolveHit(h: GeocodeHit): Promise<GeocodeHit | null> {
  if (h.lat != null && h.lng != null) return h;
  if (!h.placeId || !GOOGLE_KEY) return null;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(h.placeId)}?languageCode=zh-TW&regionCode=TW&sessionToken=${sessionToken}`, {
      headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location' },
    });
    newSession();
    if (!res.ok) return null;
    const p = (await res.json()) as { displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } };
    if (!p.location) return null;
    return { name: p.displayName?.text || h.name, addr: tidyTwAddress(p.formattedAddress || h.addr), lat: p.location.latitude, lng: p.location.longitude, placeId: h.placeId };
  } catch {
    return null;
  }
}

async function geocodeGoogle(q: string, near?: LatLng): Promise<GeocodeHit[]> {
  if (!sessionToken) newSession();
  try {
    const body: Record<string, unknown> = {
      input: q,
      languageCode: 'zh-TW',
      regionCode: 'TW',
      includedRegionCodes: ['tw'],
      sessionToken,
    };
    if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } };
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }; text?: { text: string } } }[];
    };
    return (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .slice(0, 6)
      .map((p) => ({
        name: p.structuredFormat?.mainText?.text || p.text?.text || '',
        addr: tidyTwAddress(p.structuredFormat?.secondaryText?.text || ''),
        placeId: p.placeId,
      }));
  } catch {
    return [];
  }
}

async function geocodeNominatim(q: string): Promise<GeocodeHit[]> {
  try {
    const url = `${NOMINATIM_URL}/search?format=jsonv2&countrycodes=tw&accept-language=zh-TW&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'truck-uber-mvp/0.1 (contact: app)' } });
    if (!res.ok) return [];
    const rows = (await res.json()) as { display_name: string; name?: string; lat: string; lon: string }[];
    return rows.map((r) => ({
      name: r.name && r.name.length > 0 ? r.name : r.display_name.split(',')[0],
      addr: r.display_name.split(',').slice(0, 4).map((s) => s.trim()).reverse().join(''),
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }));
  } catch {
    return [];
  }
}

/** "台灣桃園市中壢區…" → "桃園市中壢區…"; drops postal code prefix Google adds. */
const tidyTwAddress = (a: string) => a.replace(/^(\d{3,6})?\s*(台灣|臺灣)?\s*/, '').trim();

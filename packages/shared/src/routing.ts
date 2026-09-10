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

/* ---------- geocoding (Nominatim, OSM) ---------- */
const NOMINATIM_URL = (process.env.EXPO_PUBLIC_NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');

export type GeocodeHit = { name: string; addr: string; lat: number; lng: number };

/** Free-text address search limited to Taiwan. Nominatim asks for ≤ 1 req/s — debounce in the UI. */
export async function geocode(q: string): Promise<GeocodeHit[]> {
  if (q.trim().length < 2) return [];
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

/**
 * Driver GPS via expo-location (foreground while the app is open).
 * Background tracking needs a development build + the location plugin's
 * background flag; not required for the phase-1B two-device test.
 */
import * as Location from 'expo-location';
import type { DriverLocation } from './types';

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentLocation(): Promise<DriverLocation | null> {
  try {
    const ok = await requestLocationPermission();
    if (!ok) return null;
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading ?? undefined, speed: p.coords.speed ?? undefined };
  } catch {
    return null;
  }
}

/**
 * Streams positions. Emits at most every `minIntervalMs` or `minDistanceM`,
 * whichever comes first — good enough for a customer to watch a truck.
 */
export async function watchLocation(
  cb: (loc: DriverLocation) => void,
  opts: { minIntervalMs?: number; minDistanceM?: number } = {}
): Promise<() => void> {
  const ok = await requestLocationPermission();
  if (!ok) return () => {};
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: opts.minIntervalMs ?? 8000, distanceInterval: opts.minDistanceM ?? 30 },
    (p) => cb({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading ?? undefined, speed: p.coords.speed ?? undefined })
  );
  return () => sub.remove();
}

/**
 * Web build of MapView: Leaflet rendered straight into a div (no WebView on web).
 * Same props as MapView.tsx so screens don't know the difference.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MapProps } from './MapView.types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { L?: any }
}

let leafletLoading: Promise<void> | null = null;
function loadLeaflet(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const style = document.createElement('style');
    style.textContent = '.leaflet-div-icon{background:transparent;border:0}.leaflet-control-attribution{font-size:9px}';
    document.head.appendChild(style);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Leaflet failed to load'));
    document.head.appendChild(s);
  });
  return leafletLoading;
}

const truckIcon = (L: any, deg = 0) =>
  L.divIcon({
    html: `<svg width="40" height="40" viewBox="0 0 40 40" style="transform:rotate(${deg}deg);filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))"><circle cx="20" cy="20" r="18" fill="#000"/><path d="M11 15h11v11H11zM22 18h5l3 3v5h-8z" fill="#fff"/><circle cx="14" cy="27.5" r="2" fill="#000" stroke="#fff" stroke-width="1.5"/><circle cx="26" cy="27.5" r="2" fill="#000" stroke="#fff" stroke-width="1.5"/></svg>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
const pinIcon = (L: any, square: boolean) =>
  L.divIcon({
    html: square
      ? '<svg width="22" height="22"><rect x="3" y="3" width="16" height="16" fill="#fff" stroke="#000" stroke-width="4"/></svg>'
      : '<svg width="22" height="22"><circle cx="11" cy="11" r="8" fill="#fff" stroke="#000" stroke-width="4"/></svg>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

export function MapView(props: MapProps) {
  const { center, zoom, pickup, drop, path, approach, truck, bottomPadding, style } = props;
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const layers = useRef<any>(null);
  const truckMarker = useRef<any>(null);
  const [ready, setReady] = React.useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(() => {
      if (cancelled || !el.current || map.current) return;
      const L = window.L;
      map.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([24.55, 120.75], 8);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current);
      layers.current = L.layerGroup().addTo(map.current);
      setReady(true);
    }).catch(() => {});
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // scene (everything but the truck position)
  useEffect(() => {
    if (!ready || !map.current) return;
    const L = window.L;
    layers.current.clearLayers();
    truckMarker.current = null;
    let b: any = null;
    if (path && path.length > 1) {
      L.polyline(path, { color: '#000', weight: 4, opacity: 0.9 }).addTo(layers.current);
      b = L.latLngBounds(path);
    }
    if (approach && approach.length > 1) {
      L.polyline(approach, { color: '#000', weight: 3, dashArray: '6 8', opacity: 0.6 }).addTo(layers.current);
      if (b) b.extend(approach[0]);
    }
    if (pickup) L.marker([pickup.lat, pickup.lng], { icon: pinIcon(L, false) }).addTo(layers.current);
    if (drop) L.marker([drop.lat, drop.lng], { icon: pinIcon(L, true) }).addTo(layers.current);
    if (truck) truckMarker.current = L.marker(truck.pos, { icon: truckIcon(L, truck.heading) }).addTo(layers.current);
    if (b) map.current.fitBounds(b, { paddingTopLeft: [36, 110], paddingBottomRight: [36, (bottomPadding ?? 120) + 24], animate: false });
    else if (center) map.current.setView([center.lat, center.lng], zoom ?? 11, { animate: false });
    setTimeout(() => map.current?.invalidateSize(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, center?.lat, center?.lng, zoom, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, path, approach, !!truck, bottomPadding]);

  // truck position only
  useEffect(() => {
    if (!ready || !truck || !truckMarker.current) return;
    truckMarker.current.setLatLng(truck.pos);
    truckMarker.current.setIcon(truckIcon(window.L, truck.heading));
  }, [ready, truck?.pos[0], truck?.pos[1], truck?.heading]);

  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <div ref={el} style={{ width: '100%', height: '100%', background: '#eef0ec' }} />
    </View>
  );
}

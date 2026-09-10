import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView as RNWebView, WebViewMessageEvent } from 'react-native-webview';
import type { LatLng } from './types';

// react-native-webview's prop typings lag behind RN 0.86 and collapse to `never`; keep runtime intact, loosen types.
const WebView = RNWebView as unknown as React.ComponentType<Record<string, unknown>>;

/**
 * OpenStreetMap via Leaflet inside a WebView — no API key, works in Expo Go on
 * iOS and Android. Swap for react-native-maps / MapLibre later without touching
 * the screens: keep the same props.
 */
import type { MapProps } from './MapView.types';
export type { MapProps };

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{margin:0;height:100%;background:#eef0ec}.leaflet-div-icon{background:transparent;border:0}.leaflet-control-attribution{font-size:9px}</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('m',{zoomControl:false,attributionControl:true}).setView([24.55,120.75],8);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var layers=L.layerGroup().addTo(map), truck=null;
function truckIcon(deg){return L.divIcon({html:'<svg width="40" height="40" viewBox="0 0 40 40" style="transform:rotate('+(deg||0)+'deg);filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))"><circle cx="20" cy="20" r="18" fill="#000"/><path d="M11 15h11v11H11zM22 18h5l3 3v5h-8z" fill="#fff"/><circle cx="14" cy="27.5" r="2" fill="#000" stroke="#fff" stroke-width="1.5"/><circle cx="26" cy="27.5" r="2" fill="#000" stroke="#fff" stroke-width="1.5"/></svg>',iconSize:[40,40],iconAnchor:[20,20]});}
function pinIcon(sq){return L.divIcon({html:sq?'<svg width="22" height="22"><rect x="3" y="3" width="16" height="16" fill="#fff" stroke="#000" stroke-width="4"/></svg>':'<svg width="22" height="22"><circle cx="11" cy="11" r="8" fill="#fff" stroke="#000" stroke-width="4"/></svg>',iconSize:[22,22],iconAnchor:[11,11]});}
window.update=function(s){
  layers.clearLayers(); truck=null; var b=null;
  if(s.path){L.polyline(s.path,{color:'#000',weight:4,opacity:.9}).addTo(layers); b=L.latLngBounds(s.path);}
  if(s.approach){L.polyline(s.approach,{color:'#000',weight:3,dashArray:'6 8',opacity:.6}).addTo(layers); if(b) b.extend(s.approach[0]);}
  if(s.pickup){L.marker([s.pickup.lat,s.pickup.lng],{icon:pinIcon(false)}).addTo(layers);}
  if(s.drop){L.marker([s.drop.lat,s.drop.lng],{icon:pinIcon(true)}).addTo(layers);}
  if(s.truck){truck=L.marker(s.truck.pos,{icon:truckIcon(s.truck.heading)}).addTo(layers);}
  if(b){map.fitBounds(b,{paddingTopLeft:[36,110],paddingBottomRight:[36,(s.bottomPadding||120)+24],animate:false});}
  else if(s.center){map.setView([s.center.lat,s.center.lng],s.zoom||11,{animate:false});}
};
window.moveTruck=function(pos,heading){ if(truck){truck.setLatLng(pos); truck.setIcon(truckIcon(heading));} };
window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;

export function MapView(props: MapProps) {
  const ref = useRef<RNWebView>(null);
  const [ready, setReady] = useState(false);
  const { center, zoom, pickup, drop, path, approach, truck, bottomPadding, style } = props;

  // Everything except the truck position: redraw layers.
  const sceneJson = useMemo(
    () => JSON.stringify({ center, zoom, pickup, drop, path, approach, truck, bottomPadding }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center?.lat, center?.lng, zoom, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, path, approach, !!truck, bottomPadding]
  );
  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.update(${sceneJson});true;`);
  }, [ready, sceneJson]);

  // Truck position only: cheap marker move.
  useEffect(() => {
    if (ready && truck) ref.current?.injectJavaScript(`window.moveTruck(${JSON.stringify(truck.pos)},${truck.heading ?? 0});true;`);
  }, [ready, truck?.pos[0], truck?.pos[1], truck?.heading]);

  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: HTML, baseUrl: 'https://localhost/' }}
        onMessage={(e: WebViewMessageEvent) => {
          if (e.nativeEvent.data === 'ready') setReady(true);
        }}
        style={{ flex: 1, backgroundColor: '#eef0ec' }}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
      />
    </View>
  );
}

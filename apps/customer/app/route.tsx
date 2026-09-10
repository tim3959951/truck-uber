import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, GeocodeHit, H1, H2, LOCATIONS, Location, RoundButton, Row, Tiny, colors, estimateRoadKm, geocode, geocodeProvider, getCurrentLocation, loadLabel, resolveHit, showAlert } from '@truck/shared';
import { useStore } from '../store';

export default function RouteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pickup, drop, history, set } = useStore();
  const params = useLocalSearchParams<{ edit?: string }>();
  const [editing, setEditing] = useState<'pickup' | 'drop'>(params.edit === 'pickup' ? 'pickup' : 'drop');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const km = Math.round(estimateRoadKm(pickup, drop));

  // debounced address search (Nominatim asks for ≤ 1 request/second)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      setHits(await geocode(q, editing === 'drop' ? pickup : undefined));
      setSearching(false);
    }, 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const choose = (l: Location) => {
    if (editing === 'pickup') {
      set({ pickup: l, route: null });
      setEditing('drop');
    } else set({ drop: l, route: null });
    setQ('');
    setHits([]);
  };

  const chooseHit = async (h: GeocodeHit, i: number) => {
    setSearching(true);
    const r = await resolveHit(h);
    setSearching(false);
    if (!r || r.lat == null || r.lng == null) {
      showAlert('找不到座標', '這個地點抓不到位置，請換個關鍵字或直接輸入完整地址。');
      return;
    }
    choose({ id: `geo-${i}`, name: r.name, addr: r.addr, lat: r.lat, lng: r.lng });
  };

  const useMyLocation = async () => {
    const loc = await getCurrentLocation();
    if (!loc) return;
    choose({ id: 'me', name: '目前位置', addr: `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`, lat: loc.lat, lng: loc.lng });
  };

  const same = pickup.lat === drop.lat && pickup.lng === drop.lng;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top + 8 }}>
      <View style={s.head}>
        <RoundButton glyph="‹" onPress={() => router.back()} />
        <H1>設定路線</H1>
      </View>

      <View style={s.fields}>
        <Pressable style={[s.field, editing === 'pickup' && s.fieldOn]} onPress={() => setEditing('pickup')}>
          <View style={s.dot} />
          <View style={{ flex: 1 }}>
            <Tiny>裝貨地點（起點）</Tiny>
            <Text style={s.fieldText} numberOfLines={1}>{pickup.name}</Text>
          </View>
        </Pressable>
        <Pressable style={[s.field, editing === 'drop' && s.fieldOn]} onPress={() => setEditing('drop')}>
          <View style={s.square} />
          <View style={{ flex: 1 }}>
            <Tiny>卸貨地點（終點）</Tiny>
            <Text style={s.fieldText} numberOfLines={1}>{drop.name}</Text>
          </View>
        </Pressable>
        <View style={s.searchBox}>
          <Ionicons name="search" size={18} color={colors.ink2} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={editing === 'pickup' ? '搜尋裝貨地址…' : '搜尋卸貨地址…'}
            placeholderTextColor={colors.ink3}
            style={{ flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: 10 }}
          />
          {searching ? <ActivityIndicator /> : null}
        </View>
        <Tiny>
          距離約 <Text style={{ fontWeight: '800', color: colors.ink }}>{km} km</Text>（直線估算，下一步會以實際道路里程報價）
        </Tiny>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {q.trim().length >= 2 && !searching && hits.length === 0 ? (
          <Tiny style={{ marginTop: 8 }}>
            {geocodeProvider() === 'nominatim'
              ? '找不到。目前用的是 OpenStreetMap 免費地圖，搜不到門牌號碼與公司名稱；可先搜「路名」或「地標」，再用「目前位置」。'
              : '找不到這個地點，試試加上縣市或路名。'}
          </Tiny>
        ) : null}
        {hits.length > 0 ? (
          <>
            <H2 style={{ marginTop: 8 }}>搜尋結果</H2>
            {hits.map((h, i) => (
              <Row key={i} title={h.name} subtitle={h.addr} icon={<Ionicons name="location-outline" size={18} />} onPress={() => chooseHit(h, i)} />
            ))}
          </>
        ) : null}
        {editing === 'pickup' ? <Row title="使用目前位置" subtitle="需要定位權限" icon={<Ionicons name="navigate-outline" size={18} />} onPress={useMyLocation} /> : null}
        <H2 style={{ marginTop: 8 }}>{editing === 'pickup' ? '常用裝貨地點' : '常用卸貨地點'}</H2>
        {LOCATIONS.map((l) => {
          const selected = (editing === 'pickup' ? pickup : drop).name === l.name;
          return (
            <Row
              key={l.id}
              title={l.name}
              subtitle={l.addr}
              icon={<Ionicons name="business-outline" size={18} />}
              right={selected ? <Ionicons name="checkmark-circle" size={22} color={colors.ink} /> : undefined}
              onPress={() => choose(l)}
            />
          );
        })}
        {history.length > 0 ? (
          <>
            <H2 style={{ marginTop: 20 }}>最近送過</H2>
            {history.slice(0, 3).map((h) => (
              <Row key={h.id} title={h.to} subtitle={`從 ${h.from} · ${loadLabel(h)}`} icon={<Ionicons name="time-outline" size={18} />} />
            ))}
          </>
        ) : null}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button title="下一步：貨物內容" disabled={same} onPress={() => router.push('/cargo')} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  fields: { paddingHorizontal: 20, gap: 8 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.fill, borderRadius: 10, padding: 12, borderWidth: 2, borderColor: 'transparent' },
  fieldOn: { borderColor: colors.ink },
  fieldText: { fontWeight: '700', fontSize: 15 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink },
  square: { width: 10, height: 10, backgroundColor: colors.ink },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line },
});

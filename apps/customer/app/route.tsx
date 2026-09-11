import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  GeocodeHit,
  H1,
  H2,
  Location,
  RoundButton,
  Row,
  Tiny,
  colors,
  estimateRoadKm,
  frequentPlaces,
  geocode,
  geocodeProvider,
  isSet,
  recentPlaces,
  resolveHit,
  showAlert,
} from '@truck/shared';
import { useStore } from '../store';

type End = 'pickup' | 'drop';

/**
 * Uber-style route editor: the two fields ARE the search boxes. Tap one, type, pick a result.
 * With no query the list shows the customer's own recent / frequent places (from past orders).
 */
export default function RouteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pickup, drop, myLoc, history, set, swapRoute, locateMe } = useStore();
  const params = useLocalSearchParams<{ edit?: string }>();
  const [editing, setEditing] = useState<End>(params.edit === 'drop' ? 'drop' : params.edit === 'pickup' ? 'pickup' : !isSet(pickup) ? 'pickup' : 'drop');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  /** which field currently has keyboard focus — only that one shows the query text instead of the chosen place */
  const [focused, setFocused] = useState<End | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputs = { pickup: useRef<TextInput>(null), drop: useRef<TextInput>(null) };

  const ready = isSet(pickup) && isSet(drop);
  const km = ready ? Math.round(estimateRoadKm(pickup, drop)) : null;
  const recents = recentPlaces(history, 6);
  const frequents = frequentPlaces(history, 3);

  // focus the field being edited so the keyboard is up immediately
  useEffect(() => {
    const t = setTimeout(() => inputs[editing].current?.focus(), 150);
    return () => clearTimeout(t);
  }, [editing]);

  // debounced search (Google when the key is set, otherwise Nominatim ≤ 1 req/s)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      setHits(await geocode(q, editing === 'drop' && isSet(pickup) ? pickup : myLoc ?? undefined));
      setSearching(false);
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, editing]);

  const choose = (l: Location) => {
    if (editing === 'pickup') {
      set({ pickup: l, route: null });
      setQ('');
      setHits([]);
      if (!isSet(drop)) setEditing('drop');
      else inputs.pickup.current?.blur();
    } else {
      set({ drop: l, route: null });
      setQ('');
      setHits([]);
      if (!isSet(pickup)) setEditing('pickup');
      else inputs.drop.current?.blur();
    }
  };

  const chooseHit = async (h: GeocodeHit, i: number) => {
    setSearching(true);
    const r = await resolveHit(h);
    setSearching(false);
    if (!r || r.lat == null || r.lng == null) {
      showAlert('找不到座標', '這個地點抓不到位置，請換個關鍵字或直接輸入完整地址。');
      return;
    }
    choose({ id: `geo-${Date.now()}-${i}`, name: r.name, addr: r.addr, lat: r.lat, lng: r.lng });
  };

  const useMyLocation = async () => {
    if (!myLoc) await locateMe();
    const me = useStore.getState().myLoc;
    if (!me) return showAlert('無法取得位置', '請允許定位權限，或直接搜尋地址。');
    choose(me);
  };

  const field = (end: End, label: string, l: Location, marker: React.ReactNode) => {
    const on = editing === end;
    return (
      <Pressable style={[s.field, on && s.fieldOn]} onPress={() => setEditing(end)}>
        {marker}
        <View style={{ flex: 1 }}>
          <Tiny>{label}</Tiny>
          <TextInput
            ref={inputs[end]}
            value={on && focused === end ? q : isSet(l) ? l.name : ''}
            onFocus={() => {
              setFocused(end);
              if (editing !== end) setEditing(end);
            }}
            onBlur={() => setFocused((f) => (f === end ? null : f))}
            onChangeText={(t) => {
              if (editing !== end) setEditing(end);
              setQ(t);
            }}
            placeholder={end === 'pickup' ? '輸入地址或公司名稱…' : '要送到哪裡？'}
            placeholderTextColor={on ? colors.ink3 : colors.ink3}
            style={s.fieldText}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        {on && q.length > 0 ? (
          <Pressable onPress={() => setQ('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.ink3} />
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  const showSuggestions = q.trim().length < 2;
  // typing into a field that already has a place: the query starts empty so the old name is not carried into the search

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top + 8 }}>
      <View style={s.head}>
        <RoundButton glyph="‹" onPress={() => router.back()} />
        <H1>設定路線</H1>
      </View>

      <View style={s.fields}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, gap: 8 }}>
            {field('pickup', '裝貨地點（起點）', pickup, <View style={s.dot} />)}
            {field('drop', '卸貨地點（終點）', drop, <View style={s.square} />)}
          </View>
          <Pressable onPress={swapRoute} style={s.swap} accessibilityLabel="對調起點與終點">
            <Ionicons name="swap-vertical" size={20} color={colors.ink} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {searching ? <ActivityIndicator size="small" /> : null}
          <Tiny>
            {ready ? (
              <>
                距離約 <Text style={{ fontWeight: '800', color: colors.ink }}>{km} km</Text>（直線估算，下一步會以實際道路里程報價）
              </>
            ) : (
              '先選起點，再選終點。'
            )}
          </Tiny>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {!showSuggestions && !searching && hits.length === 0 ? (
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

        {showSuggestions ? (
          <>
            <Row title="使用目前位置" subtitle={myLoc?.addr ?? '需要定位權限'} icon={<Ionicons name="navigate-outline" size={18} />} onPress={useMyLocation} />
            {frequents.length > 0 ? (
              <>
                <H2 style={{ marginTop: 8 }}>常用地點</H2>
                {frequents.map((l) => (
                  <Row key={l.id} title={l.name} subtitle={l.addr} icon={<Ionicons name="star-outline" size={18} />} onPress={() => choose(l)} />
                ))}
              </>
            ) : null}
            {recents.length > 0 ? (
              <>
                <H2 style={{ marginTop: 8 }}>最近使用</H2>
                {recents.map((l) => (
                  <Row key={l.id} title={l.name} subtitle={l.addr} icon={<Ionicons name="time-outline" size={18} />} onPress={() => choose(l)} />
                ))}
              </>
            ) : (
              <Tiny style={{ marginTop: 12 }}>你送過的地點會出現在這裡，下次一點就好。</Tiny>
            )}
          </>
        ) : null}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button title={ready ? '下一步：貨物內容' : '先選擇起點與終點'} disabled={!ready} onPress={() => router.push('/cargo')} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  fields: { paddingHorizontal: 20, gap: 8 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.fill, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 2, borderColor: 'transparent' },
  fieldOn: { borderColor: colors.ink, backgroundColor: '#fff' },
  fieldText: { fontWeight: '700', fontSize: 15, paddingVertical: 4, color: colors.ink },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink },
  square: { width: 10, height: 10, backgroundColor: colors.ink },
  swap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line },
});

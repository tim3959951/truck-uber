import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, H2, MapView, RoundButton, Sheet, TIERS, Tag, Tiny, cargoById, classById, colors, formatNTD, recommendClass, tierById, showAlert } from '@truck/shared';
import { backend, useStore } from '../store';

export default function Tier() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pickup, drop, pallets, cargoId, tierId, needTailLift, helpers, route, routeLoading, engine, pricing, busy, classes, classId, loadMode, weightT, quantityDesc, set, pickClass, loadRoute, requestTruck } = useStore();
  const addons = { needTailLift, helpers };
  const cls = classById(classes, classId);
  const recommended = recommendClass(classes, pallets, weightT ?? undefined, loadMode);
  const fits = (k: typeof cls) => (loadMode === 'full' || k.maxPallets >= pallets) && (weightT == null || k.maxWeightT >= weightT);

  useEffect(() => {
    if (!route) loadRoute();
  }, []);

  const km = route?.km ?? 0;
  const tier = tierById(tierId);
  const q = engine.quote(km, pallets, tier, addons, cls, loadMode);

  // 0017: record the price this customer was shown, so we can later see what was quoted but never ordered.
  // Server-side throttled to one row per 10 s; failures are swallowed inside the backend.
  const logged = useRef('');
  useEffect(() => {
    if (!route || !q.total) return;
    const key = `${pickup.name}|${drop.name}|${classId}|${tierId}|${pallets}|${loadMode}`;
    if (logged.current === key) return;
    logged.current = key;
    backend.logQuote({
      pickup: { name: pickup.name, lat: pickup.lat, lng: pickup.lng },
      dest: { name: drop.name, lat: drop.lat, lng: drop.lng },
      km, class_id: classId, load_mode: loadMode, pallets, weight_t: weightT,
      tier: tierId, need_tail_lift: needTailLift, helpers, price: q.total,
    });
  }, [route, classId, tierId, pallets, loadMode, q.total]);

  const confirm = async () => {
    try {
      await requestTruck(); // root layout routes to /checkout when the order is created
    } catch (e) {
      showAlert('無法建立訂單', (e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView pickup={pickup} drop={drop} path={route?.path ?? null} bottomPadding={560} />
      <View style={{ position: 'absolute', top: insets.top + 6, left: 16 }}>
        <RoundButton glyph="‹" onPress={() => router.back()} />
      </View>

      <Sheet style={{ paddingBottom: insets.bottom + 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <H2>選擇車種</H2>
          {routeLoading ? <ActivityIndicator /> : route ? <Tag label={route.source === 'osrm' ? '道路里程' : '估算里程'} tone={route.source === 'osrm' ? 'go' : 'warn'} /> : null}
        </View>
        <Tiny>
          {routeLoading ? '計算道路里程中…' : `${km} km · 約 ${route?.minutes ?? '–'} 分鐘`} · {loadMode === 'full' ? `整車 ${quantityDesc || ''}`.trim() : `${pallets} 托`} {cargoById(cargoId).name}
          {weightT != null ? ` · ${weightT} 噸` : ''}
        </Tiny>

        <Text style={s.section}>車型（系統建議 {recommended.name}，可自行更換）</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -4 }}>
          {classes.filter((k) => k.active).map((k) => {
            const on = k.id === classId;
            const ok = fits(k);
            const kq = engine.quote(km, pallets, tier, addons, k, loadMode);
            return (
              <Pressable key={k.id} onPress={() => (ok ? pickClass(k.id) : showAlert('這台載不下', `${k.name} 單層最多 ${k.maxPallets} 托、載重 ${k.maxWeightT} 噸。`))} style={[s.cls, on && s.clsOn, !ok && s.clsOff]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.clsName, on && { color: '#fff' }]}>{k.name}</Text>
                  {k.id === recommended.id ? <Tag label="建議" tone="go" /> : null}
                </View>
                <Text style={[s.clsSub, on && { color: '#ddd' }]}>{k.nickname} · {k.deckM} m · {k.maxPallets} 托 · {k.maxWeightT} 噸</Text>
                <Text style={[s.clsPrice, on && { color: '#fff' }]}>{routeLoading ? '—' : ok ? formatNTD(kq.total) : '載不下'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={s.section}>專車或回頭車</Text>
        {TIERS.map((t) => {
          const tq = engine.quote(km, pallets, t, addons, cls, loadMode);
          const on = tierId === t.id;
          return (
            <Pressable key={t.id} onPress={() => set({ tierId: t.id })} style={[s.tier, on && s.tierOn]}>
              <Ionicons name={t.id === 'backhaul' ? 'return-down-back' : 'bus'} size={30} color={colors.ink} />
              <View style={{ flex: 1 }}>
                <Text style={s.tierName}>{t.name}</Text>
                <Tiny>
                  {t.eta} · {t.desc}
                </Tiny>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.price}>{routeLoading ? '—' : formatNTD(tq.total)}</Text>
                {tq.factor < 1 && !routeLoading ? <Text style={s.strike}>{formatNTD(tq.subtotal + tq.tailLiftFee + tq.helperFee)}</Text> : null}
              </View>
            </Pressable>
          );
        })}

        <View style={s.summary}>
          <Line label={`${cls.name} 基本里程費（起步 ${formatNTD(cls.baseFare)} + ${km} km × ${cls.perKm}）`} value={formatNTD(q.distanceFee)} />
          <Line label={loadMode === 'full' ? `整車費（滿載 ${cls.maxPallets} 托 × ${cls.perPallet}）` : `棧板費（${pallets} 托 × ${cls.perPallet}）`} value={formatNTD(q.palletFee)} />
          {q.factor < 1 ? <Line label={`回頭車 ×${q.factor}`} value={`−${formatNTD(q.subtotal - q.baseTotal)}`} /> : null}
          {q.tailLiftFee > 0 ? <Line label="升降尾門" value={formatNTD(q.tailLiftFee)} /> : null}
          {q.helperFee > 0 ? <Line label={`隨車搬運工 × ${helpers}`} value={formatNTD(q.helperFee)} /> : null}
          <View style={s.total}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>承運人報價（平台參考價）</Text>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{routeLoading ? '—' : formatNTD(q.total)}</Text>
          </View>
        </View>
        <Tiny>此價格為平台依公開費率算出的參考價；承運人接單即表示同意以此價承運，運送契約在你與承運人之間成立，運費由金流直接撥付承運人。</Tiny>
        <Button title={`確認叫車 · ${cls.name} ${tier.name}`} onPress={confirm} loading={busy} disabled={routeLoading || !route || !fits(cls)} />
      </Sheet>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: colors.ink2, fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 12, fontWeight: '700', color: colors.ink2, letterSpacing: 0.5, marginTop: 4 },
  cls: { width: 150, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 10, gap: 4, marginHorizontal: 4 },
  clsOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  clsOff: { opacity: 0.45 },
  clsName: { fontWeight: '800', fontSize: 15 },
  clsSub: { fontSize: 11, color: colors.ink2 },
  clsPrice: { fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'], marginTop: 2 },
  tier: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: 'transparent', borderRadius: 14, padding: 10 },
  tierOn: { borderColor: colors.ink, backgroundColor: colors.fill },
  tierName: { fontWeight: '800', fontSize: 16 },
  price: { fontWeight: '800', fontSize: 17, fontVariant: ['tabular-nums'] },
  strike: { fontSize: 12, color: colors.ink3, textDecorationLine: 'line-through' },
  summary: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, gap: 6 },
  total: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, marginTop: 2 },
});

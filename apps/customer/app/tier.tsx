import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, H2, MapView, RoundButton, Sheet, TIERS, Tag, Tiny, cargoById, colors, formatNTD, tierById, showAlert } from '@truck/shared';
import { useStore } from '../store';

export default function Tier() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pickup, drop, pallets, cargoId, tierId, needTailLift, helpers, route, routeLoading, engine, pricing, busy, set, loadRoute, requestTruck } = useStore();
  const addons = { needTailLift, helpers };

  useEffect(() => {
    if (!route) loadRoute();
  }, []);

  const km = route?.km ?? 0;
  const tier = tierById(tierId);
  const q = engine.quote(km, pallets, tier, addons);

  const confirm = async () => {
    try {
      await requestTruck(); // root layout routes to /checkout when the order is created
    } catch (e) {
      showAlert('無法建立訂單', (e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView pickup={pickup} drop={drop} path={route?.path ?? null} bottomPadding={450} />
      <View style={{ position: 'absolute', top: insets.top + 6, left: 16 }}>
        <RoundButton glyph="‹" onPress={() => router.back()} />
      </View>

      <Sheet style={{ paddingBottom: insets.bottom + 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <H2>選擇車種</H2>
          {routeLoading ? <ActivityIndicator /> : route ? <Tag label={route.source === 'osrm' ? '道路里程' : '估算里程'} tone={route.source === 'osrm' ? 'go' : 'warn'} /> : null}
        </View>
        <Tiny>
          {routeLoading ? '計算道路里程中…' : `${km} km · 約 ${route?.minutes ?? '–'} 分鐘`} · {pallets} 托 {cargoById(cargoId).name}
        </Tiny>
        {TIERS.map((t) => {
          const tq = engine.quote(km, pallets, t, addons);
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
          <Line label={`基本里程費（起步 ${formatNTD(pricing.baseFare)} + ${km} km × ${pricing.perKm}）`} value={formatNTD(q.distanceFee)} />
          <Line label={`棧板費（${pallets} 托 × ${pricing.perPallet}）`} value={formatNTD(q.palletFee)} />
          {q.factor < 1 ? <Line label={`回頭車 ×${q.factor}`} value={`−${formatNTD(q.subtotal - q.baseTotal)}`} /> : null}
          {q.tailLiftFee > 0 ? <Line label="升降尾門" value={formatNTD(q.tailLiftFee)} /> : null}
          {q.helperFee > 0 ? <Line label={`隨車搬運工 × ${helpers}`} value={formatNTD(q.helperFee)} /> : null}
          <View style={s.total}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>預估總運費</Text>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{routeLoading ? '—' : formatNTD(q.total)}</Text>
          </View>
        </View>
        <Button title={`確認叫車 · ${tier.name}`} onPress={confirm} loading={busy} disabled={routeLoading || !route} />
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
  tier: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: 'transparent', borderRadius: 14, padding: 10 },
  tierOn: { borderColor: colors.ink, backgroundColor: colors.fill },
  tierName: { fontWeight: '800', fontSize: 16 },
  price: { fontWeight: '800', fontSize: 17, fontVariant: ['tabular-nums'] },
  strike: { fontSize: 12, color: colors.ink3, textDecorationLine: 'line-through' },
  summary: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, gap: 6 },
  total: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, marginTop: 2 },
});

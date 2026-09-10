import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, H1, H2, Tiny, colors, formatNTD } from '@truck/shared';
import { useStore } from '../store';

const TAGS = ['準時', '貨物綁妥', '服務親切', '裝卸專業'];

export default function Receipt() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { order: o, rating, set, submitRating } = useStore();
  const [tags, setTags] = useState<string[]>([]);
  if (!o) return null;
  const hm = (t?: number) => (t ? new Date(t).toTimeString().slice(0, 5) : '');

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, gap: 18, alignItems: 'stretch' }}>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <View style={s.check}>
            <Ionicons name="checkmark" size={30} color={colors.goInk} />
          </View>
          <H1 style={{ textAlign: 'center' }}>已送達 {o.drop.name}</H1>
          <Tiny>
            {o.orderNo} · {hm(o.createdAt)} 叫車 → {hm(o.completedAt)} 完成
          </Tiny>
        </View>

        <View style={s.summary}>
          <Line label={`基本里程費（${o.km} km）`} value={formatNTD(o.quote.distanceFee)} />
          <Line label={o.loadMode === 'full' ? '整車費（滿載）' : `棧板費（${o.pallets} 托）`} value={formatNTD(o.quote.palletFee)} />
          {o.quote.factor < 1 ? <Line label="回頭車折扣" value={`−${formatNTD(o.quote.subtotal - o.quote.baseTotal)}`} /> : null}
          {o.quote.tailLiftFee > 0 ? <Line label="升降尾門" value={formatNTD(o.quote.tailLiftFee)} /> : null}
          {o.quote.helperFee > 0 ? <Line label={`隨車搬運工 × ${o.helpers}`} value={formatNTD(o.quote.helperFee)} /> : null}
          <View style={s.total}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>總運費</Text>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{formatNTD(o.quote.total)}</Text>
          </View>
        </View>

        <H2 style={{ textAlign: 'center' }}>為司機 {o.driver?.name} 評分</H2>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => set({ rating: n })}>
              <Ionicons name="star" size={40} color={rating >= n ? colors.warn : colors.fill2} />
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          {TAGS.map((t) => (
            <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))} />
          ))}
        </View>
      </ScrollView>
      <View style={{ padding: 20, paddingBottom: insets.bottom + 16 }}>
        <Button
          title="送出評分"
          disabled={!rating}
          onPress={async () => {
            try {
              await submitRating(tags);
            } finally {
              router.replace('/');
            }
          }}
        />
      </View>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: colors.ink2, fontSize: 13 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  check: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: colors.go, alignItems: 'center', justifyContent: 'center' },
  summary: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, gap: 6 },
  total: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, marginTop: 2 },
});

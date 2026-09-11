import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, H1, H2, RouteBlock, Tag, Tiny, className, colors, formatNTD, loadLabel, showAlert } from '@truck/shared';
import { useStore } from '../store';

/**
 * Quote → Checkout → Pay (sandbox) → order confirmed.
 * The payment record, platform fee and driver earnings are created server-side;
 * a real provider (TapPay / ECPay / Stripe) later replaces only the "pay" call.
 */
export default function Checkout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { order: o, busy, pay, cancel, classes } = useStore();
  if (!o) return null;

  const onPay = async () => {
    try {
      await pay(); // root layout routes to /trip once the order is searching
    } catch (e) {
      showAlert('付款失敗', (e as Error).message);
    }
  };
  const onCancel = () =>
    showAlert('放棄此訂單？', undefined, [
      { text: '再想想', style: 'cancel' },
      { text: '放棄', style: 'destructive', onPress: async () => { await cancel('未付款'); router.replace('/'); } },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20, gap: 16 }}>
        <Tiny>{o.orderNo}</Tiny>
        <H1>確認付款</H1>
        <RouteBlock pickup={o.pickup} drop={o.drop} />
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Tag label={`${loadLabel(o)} · ${o.cargo.name}`} />
          <Tag label={className(classes, o.classId)} />
          <Tag label={o.tier.name} />
          <Tag label={`${o.km} km`} tone={o.distanceSource === 'osrm' ? 'go' : 'warn'} />
          {o.needTailLift ? <Tag label="需升降尾門" tone="warn" /> : null}
          {o.helpers > 0 ? <Tag label={`搬運工 × ${o.helpers}`} tone="warn" /> : null}
        </View>

        <View style={s.summary}>
          <Line label="基本里程費" value={formatNTD(o.quote.distanceFee)} />
          <Line label={o.loadMode === 'full' ? '整車費（滿載）' : `棧板費（${o.pallets} 托）`} value={formatNTD(o.quote.palletFee)} />
          {o.quote.factor < 1 ? <Line label="回頭車折扣" value={`−${formatNTD(o.quote.subtotal - o.quote.baseTotal)}`} /> : null}
          {o.quote.tailLiftFee > 0 ? <Line label="升降尾門" value={formatNTD(o.quote.tailLiftFee)} /> : null}
          {o.quote.helperFee > 0 ? <Line label={`隨車搬運工 × ${o.helpers}`} value={formatNTD(o.quote.helperFee)} /> : null}
          <View style={s.total}>
            <Text style={{ fontWeight: '800', fontSize: 18 }}>應付金額</Text>
            <Text style={{ fontWeight: '800', fontSize: 18 }}>{formatNTD(o.quote.total)}</Text>
          </View>
        </View>

        <H2>付款方式</H2>
        <View style={s.method}>
          <Ionicons name="card-outline" size={22} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '800' }}>測試付款（沙盒）</Text>
            <Tiny>不會實際扣款。正式版接金流後此處變成信用卡 / 月結。</Tiny>
          </View>
          <Ionicons name="checkmark-circle" size={22} color={colors.ink} />
        </View>
        <Tiny>付款後平台會通知符合條件的 {className(classes, o.classId)} 承運人，由承運人決定是否承接；沒有承運人承接時可隨時取消並全額退款。</Tiny>
      </ScrollView>
      <View style={{ padding: 20, paddingBottom: insets.bottom + 16, gap: 10 }}>
        <Button title={`付款 ${formatNTD(o.quote.total)}`} onPress={onPay} loading={busy} />
        <Button title="放棄訂單" variant="secondary" onPress={onCancel} />
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
  summary: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, gap: 6 },
  total: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, marginTop: 2 },
  method: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: colors.ink, borderRadius: 12, padding: 12 },
});

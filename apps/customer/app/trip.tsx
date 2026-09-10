import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, H2, MapView, Plate, Progress, RoundButton, RouteBlock, Sheet, Tag, Tiny, Toast, colors, formatNTD, haversineKm, loadLabel, showAlert } from '@truck/shared';
import { useStore } from '../store';

export default function Trip() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { order: o, toast, cancel } = useStore();

  if (!o) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text style={{ color: colors.ink2 }}>目前沒有進行中的訂單</Text>
        <Button title="回首頁" small onPress={() => router.replace('/')} />
      </View>
    );
  }

  const waiting = o.status === 'searching' || o.status === 'offered' || o.status === 'created';
  const label = { accepted: '司機前往裝貨點', arrived: '司機已抵達，裝貨中', in_transit: '運送中', delivered: '已抵達卸貨點，卸貨中' }[o.status as 'accepted'] ?? '';
  const here = o.driverPos ? { lat: o.driverPos[0], lng: o.driverPos[1] } : null;
  const remainingKm = here ? Math.round(haversineKm(here, o.status === 'accepted' ? o.pickup : o.drop) * 1.2) : null;
  const eta =
    o.status === 'accepted'
      ? remainingKm != null ? `距離裝貨點約 ${remainingKm} km` : '等待司機位置…'
      : o.status === 'arrived'
        ? '請於 30 分鐘內完成裝貨'
        : o.status === 'in_transit'
          ? remainingKm != null ? `距離卸貨點約 ${remainingKm} km · 約 ${Math.max(1, remainingKm)} 分鐘` : '運送中'
          : '司機等候卸貨中';

  const confirmCancel = () =>
    showAlert('取消叫車？', o.status === 'accepted' ? '司機已在路上，正式版可能酌收空趟費；沙盒付款會全額退款。' : '款項將全額退款。', [
      { text: '再想想', style: 'cancel' },
      {
        text: '確認取消',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancel('客戶取消');
            router.replace('/');
          } catch (e) {
            showAlert('無法取消', (e as Error).message);
          }
        },
      },
    ]);

  const call = () => (o.driver?.phone ? Linking.openURL(`tel:${o.driver.phone}`) : showAlert('尚無司機電話'));
  const sms = () => (o.driver?.phone ? Linking.openURL(`sms:${o.driver.phone}`) : showAlert('尚無司機電話'));

  return (
    <View style={{ flex: 1 }}>
      <MapView
        pickup={o.pickup}
        drop={o.drop}
        path={o.path}
        truck={o.driverPos ? { pos: o.driverPos, heading: o.heading } : null}
        bottomPadding={waiting ? 380 : 430}
      />
      <Toast message={toast} />
      <View style={{ position: 'absolute', top: insets.top + 6, left: 16 }}>
        <RoundButton glyph="‹" onPress={() => router.replace('/')} />
      </View>

      <Sheet style={{ paddingBottom: insets.bottom + 16 }}>
        {waiting ? (
          <>
            <View style={{ alignItems: 'center', gap: 6, paddingVertical: 6 }}>
              <View style={s.radar}>
                <Ionicons name="bus" size={26} />
              </View>
              <H2>正在為您尋找 17噸 大貨車</H2>
              <Tiny>{o.status === 'offered' ? '已通知附近司機，等待接單…' : '搜尋附近上線中的司機…'}</Tiny>
              {o.needTailLift ? <Tiny>此單需要升降尾門，只會派給有尾門的車輛，等候時間可能較久。</Tiny> : null}
            </View>
            <RouteBlock pickup={o.pickup} drop={o.drop} />
            <View style={s.tags}>
              <Tag label={loadLabel(o)} />
              <Tag label={o.cargo.name} />
              <Tag label={o.tier.name} />
              <Text style={s.fare}>{formatNTD(o.quote.total)}</Text>
            </View>
            <Button title="取消叫車" variant="secondary" onPress={confirmCancel} />
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <H2>{label}</H2>
                <Tiny>{eta}</Tiny>
              </View>
              <Tag label={o.orderNo} />
            </View>
            <Progress value={o.progress} />
            {o.driver ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar initials={o.driver.initials} rating={o.driver.rating} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 16 }}>{o.driver.name}</Text>
                  <Tiny>{o.driver.truck}</Tiny>
                </View>
                <Plate plate={o.driver.plate} />
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="撥打" variant="secondary" small style={{ flex: 1 }} onPress={call} />
              <Button title="傳簡訊" variant="secondary" small style={{ flex: 1 }} onPress={sms} />
            </View>
            <RouteBlock pickup={o.pickup} drop={o.drop} />
            <View style={s.tags}>
              <Tag label={`${loadLabel(o)} · ${o.cargo.name}`} />
              <Tag label={o.tier.name} />
              <Text style={s.fare}>{formatNTD(o.quote.total)}</Text>
            </View>
            {o.status === 'accepted' ? <Button title="取消叫車" variant="secondary" onPress={confirmCancel} /> : null}
          </>
        )}
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  radar: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  fare: { marginLeft: 'auto', fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] },
});

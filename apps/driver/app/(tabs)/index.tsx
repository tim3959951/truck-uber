import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  H2,
  MapView,
  Order,
  Progress,
  RouteBlock,
  RoundButton,
  Sheet,
  Tag,
  Tiny,
  Toast,
  colors,
  formatNTD,
  kmToMinutes, showAlert, } from '@truck/shared';
import { useStore } from '../../store';

const FALLBACK_CENTER = { lat: 25.09, lng: 121.14 };

export default function DriverHome() {
  const insets = useSafeAreaInsets();
  const { session, online, order: o, offerLeft, lastLoc, locationDenied, toast, earnings, busy, toggleOnline, accept, decline, advance } = useStore();

  const offered = o?.status === 'offered';
  const active = !!o && ['accepted', 'arrived', 'in_transit', 'delivered', 'completed'].includes(o.status);
  const truckPos: [number, number] = lastLoc ? [lastLoc.lat, lastLoc.lng] : [FALLBACK_CENTER.lat, FALLBACK_CENTER.lng];

  const onToggle = async () => {
    try {
      await toggleOnline();
    } catch (e) {
      showAlert('無法切換狀態', (e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        center={lastLoc ?? FALLBACK_CENTER}
        zoom={12}
        pickup={o && (offered || active) ? o.pickup : null}
        drop={o && (offered || active) ? o.drop : null}
        path={o && (offered || active) ? o.path : null}
        truck={{ pos: truckPos, heading: lastLoc?.heading }}
        bottomPadding={offered ? 480 : active ? 400 : 210}
      />
      <Toast message={toast} />

      <View style={[s.topbar, { top: insets.top + 6 }]}>
        <RoundButton glyph="≡" />
        <View style={s.earnPill}>
          <Text style={s.earnText}>{formatNTD(earnings?.today ?? 0)}</Text>
        </View>
        <RoundButton glyph="⌕" />
      </View>

      {offered && o ? (
        <Sheet style={{ paddingBottom: insets.bottom + 16 }}>
          <View style={s.request}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Tag label={o.tier.name} tone="go" />
              <Tiny>{offerLeft} 秒</Tiny>
            </View>
            <Progress value={offerLeft / 15} />
            <Text style={s.fare}>
              {formatNTD(o.quote.driverAmount)} <Text style={s.fareSub}>司機實收（運費 {formatNTD(o.quote.total)}）</Text>
            </Text>
            <View style={s.tags}>
              <Tag label={`${o.pallets} 托`} />
              <Tag label={o.cargo.name} />
              <Tag label={`${o.km} km · 約 ${kmToMinutes(o.km)} 分`} />
              {o.needTailLift ? <Tag label="需升降尾門" tone="warn" /> : null}
              {o.helpers > 0 ? <Tag label={`搬運工 × ${o.helpers}（平台加派）`} tone="warn" /> : null}
            </View>
            <RouteBlock pickup={o.pickup} drop={o.drop} />
            {o.cargo.hint ? <Tiny>{o.cargo.hint}</Tiny> : null}
            {o.note ? <Tiny>備註：{o.note}</Tiny> : null}
            <CargoPhoto url={o.cargoPhotoUrl} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="拒絕" variant="secondary" style={{ flex: 1 }} onPress={decline} disabled={busy} />
              <Button title="接單" variant="go" style={{ flex: 1 }} onPress={() => accept().catch((e) => showAlert('接單失敗', (e as Error).message))} loading={busy} />
            </View>
          </View>
        </Sheet>
      ) : active && o ? (
        <ActiveTrip order={o} busy={busy} onAdvance={(n) => advance(n).catch((e) => showAlert('無法更新狀態', (e as Error).message))} bottom={insets.bottom} />
      ) : (
        <>
          <Pressable onPress={onToggle} disabled={busy} style={[s.go, online && s.goOn, { bottom: 220 + insets.bottom, opacity: busy ? 0.6 : 1 }]}>
            <Text style={[s.goText, online && { fontSize: 14 }]}>{online ? '下線' : '上線'}</Text>
          </Pressable>
          <Sheet style={{ paddingBottom: insets.bottom + 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <H2>{online ? '已上線 · 等待派單' : '您目前離線'}</H2>
                <Tiny>{online ? (lastLoc ? '定位中 · 位置每 5 秒回報' : locationDenied ? '未允許定位：仍可接單，但客戶看不到車輛位置' : '取得定位中…') : '按「上線」開始接單（需要定位權限）'}</Tiny>
              </View>
              <Tag label={online ? '● 上線' : '○ 離線'} tone={online ? 'go' : 'neutral'} />
            </View>
            <View style={{ flexDirection: 'row', gap: 22 }}>
              <Stat label="今日趟數" value={String(earnings?.tripsToday ?? 0)} />
              <Stat label="今日收入" value={formatNTD(earnings?.today ?? 0)} />
              <Stat label="車輛" value={session?.vehicle ? `${session.vehicle.plate}` : '未設定'} small />
            </View>
            {session?.verification === 'pending' ? <Tiny>帳號審核中：管理員驗證前仍可測試接單。</Tiny> : null}
            {session?.vehicle && !session.vehicle.hasTailLift ? <Tiny>你的車輛設定為「無升降尾門」，需尾門的訂單不會派給你（可在「帳戶」開啟）。</Tiny> : null}
          </Sheet>
        </>
      )}
    </View>
  );
}

function ActiveTrip({ order: o, busy, onAdvance, bottom }: { order: Order; busy: boolean; onAdvance: (next: 'arrived' | 'in_transit' | 'delivered' | 'completed') => void; bottom: number }) {
  const head = { accepted: '前往裝貨點', arrived: '已抵達 · 等候裝貨', in_transit: '運送至卸貨點', delivered: '已抵達 · 卸貨中', completed: '此單已完成' }[o.status as 'accepted'] ?? '';
  const dest = o.status === 'accepted' || o.status === 'arrived' ? o.pickup : o.drop;
  const navigate = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`;
    Linking.openURL(url).catch(() => showAlert('無法開啟導航'));
  };
  const call = () => (o.customer.phone ? Linking.openURL(`tel:${o.customer.phone}`) : showAlert('客戶未留電話'));
  return (
    <Sheet style={{ paddingBottom: bottom + 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <H2>{head}</H2>
          <Tiny>
            {dest.name} · {dest.addr}
          </Tiny>
        </View>
        <RoundButton glyph="➤" dark onPress={navigate} />
      </View>
      <Progress value={o.progress} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar initials={(o.customer.company || o.customer.contact || '客').slice(0, 1)} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', fontSize: 15 }}>{o.customer.company || o.customer.contact}</Text>
          <Tiny>
            {o.customer.contact} · {o.customer.phone}
          </Tiny>
        </View>
        <RoundButton glyph="✆" onPress={call} />
      </View>
      <View style={s.tags}>
        <Tag label={`${o.pallets} 托 · ${o.cargo.name}`} />
        <Tag label={o.tier.name} />
        <Tag label={`實收 ${formatNTD(o.quote.driverAmount)}`} tone="go" />
        {o.needTailLift ? <Tag label="需升降尾門" tone="warn" /> : null}
        {o.helpers > 0 ? <Tag label={`搬運工 × ${o.helpers}`} tone="warn" /> : null}
      </View>
      {o.note ? <Tiny>備註：{o.note}</Tiny> : null}
      <CargoPhoto url={o.cargoPhotoUrl} />
      {o.status === 'accepted' ? (
        <Button title="已抵達裝貨點" onPress={() => onAdvance('arrived')} loading={busy} />
      ) : o.status === 'arrived' ? (
        <Button title="裝貨完成，開始運送" onPress={() => onAdvance('in_transit')} loading={busy} />
      ) : o.status === 'in_transit' ? (
        <Button title="已抵達卸貨點" onPress={() => onAdvance('delivered')} loading={busy} />
      ) : o.status === 'delivered' ? (
        <Button title="確認卸貨完成，結束此單" variant="go" onPress={() => onAdvance('completed')} loading={busy} />
      ) : (
        <Button title="已完成 · 等待下一筆派單" variant="secondary" disabled />
      )}
    </Sheet>
  );
}

/** 客戶拍的現場貨物照片；點一下用瀏覽器開大圖 */
function CargoPhoto({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <Pressable onPress={() => Linking.openURL(url)} style={{ gap: 4 }}>
      <Image source={{ uri: url }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#eee' }} resizeMode="cover" />
      <Tiny>現場貨物照片（點一下放大）</Tiny>
    </Pressable>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View>
      <Tiny>{label}</Tiny>
      <Text style={{ fontWeight: '800', fontSize: small ? 14 : 18, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  topbar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earnPill: { backgroundColor: colors.ink, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  earnText: { color: '#fff', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
  request: { borderWidth: 2, borderColor: colors.ink, borderRadius: 18, padding: 14, gap: 12, backgroundColor: colors.paper },
  fare: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  fareSub: { fontSize: 12, fontWeight: '700', color: colors.ink2, letterSpacing: 0 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  go: {
    position: 'absolute',
    alignSelf: 'center',
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: colors.info,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: colors.info,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 5,
  },
  goOn: { backgroundColor: colors.bad, shadowColor: colors.bad },
  goText: { color: '#fff', fontWeight: '800', fontSize: 17 },
});

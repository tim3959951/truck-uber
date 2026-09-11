import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, MapView, H2, RoundButton, Row, Sheet, Toast, colors, isSet, recentPlaces } from '@truck/shared';
import { useStore } from '../../store';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pickup, drop, myLoc, history, order, toast, set, swapRoute } = useStore();
  const ready = isSet(pickup) && isSet(drop);
  const recents = recentPlaces(history, 3).filter((l) => l.name !== pickup.name && l.name !== drop.name);
  const center = isSet(pickup) ? pickup : myLoc ?? pickup;

  return (
    <View style={{ flex: 1 }}>
      <MapView center={center} zoom={isSet(pickup) || myLoc ? 13 : 8} pickup={isSet(pickup) ? pickup : myLoc ?? undefined} />
      <Toast message={toast} />

      <View style={[s.topbar, { top: insets.top + 6 }]}>
        <RoundButton glyph="≡" onPress={() => router.push('/account')} />
        <Pressable style={s.pill} onPress={() => router.push('/route?edit=pickup')}>
          <Ionicons name="location" size={14} />
          <Text style={s.pillText} numberOfLines={1}>{pickup.name}</Text>
          <Ionicons name="chevron-down" size={14} />
        </Pressable>
      </View>

      <Sheet>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[s.searchBox, { flex: 1 }]}>
            <Pressable style={s.searchRow} onPress={() => router.push('/route?edit=pickup')}>
              <View style={s.dot} />
              <View style={{ flex: 1 }}>
                <Text style={s.searchLabel}>裝貨地點（起點）</Text>
                <Text style={[s.searchText, !isSet(pickup) && { color: colors.ink3 }]} numberOfLines={1}>{pickup.name}</Text>
              </View>
              <Text style={s.change}>{isSet(pickup) ? '更改' : '搜尋'}</Text>
            </Pressable>
            <View style={s.divider} />
            <Pressable style={s.searchRow} onPress={() => router.push('/route?edit=drop')}>
              <View style={s.square} />
              <View style={{ flex: 1 }}>
                <Text style={s.searchLabel}>卸貨地點（終點）</Text>
                <Text style={[s.searchText, !isSet(drop) && { color: colors.ink3 }]} numberOfLines={1}>{drop.name}</Text>
              </View>
              <Text style={s.change}>{isSet(drop) ? '更改' : '搜尋'}</Text>
            </Pressable>
          </View>
          <Pressable onPress={swapRoute} style={s.swap} accessibilityLabel="對調起點與終點">
            <Ionicons name="swap-vertical" size={20} color={colors.ink} />
          </Pressable>
        </View>
        <Button title={ready ? '下一步：貨物內容' : '先選擇起點與終點'} disabled={!ready} onPress={() => router.push('/cargo')} />

        {order && order.status !== 'cancelled' ? (
          <Pressable style={s.banner} onPress={() => router.push(order.status === 'created' ? '/checkout' : order.status === 'completed' ? '/receipt' : '/trip')}>
            <Ionicons name="bus" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800', flex: 1 }}>
              {order.status === 'created' ? '待付款' : '進行中'}：{order.orderNo}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        ) : null}

        {recents.length > 0 ? (
          <View>
            <H2>最近送過</H2>
            {recents.map((l) => (
              <Row
                key={l.id}
                title={l.name}
                subtitle={l.addr}
                icon={<Ionicons name="time-outline" size={18} />}
                onPress={() => {
                  // fill whichever end is still empty (drop first, like Uber's "where to?")
                  if (!isSet(drop)) set({ drop: l, route: null });
                  else if (!isSet(pickup)) set({ pickup: l, route: null });
                  else set({ drop: l, route: null });
                }}
              />
            ))}
          </View>
        ) : null}

      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  topbar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.paper,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    maxWidth: '70%',
  },
  pillText: { fontWeight: '800', fontSize: 13, flexShrink: 1 },
  searchBox: { backgroundColor: colors.fill, borderRadius: 16, paddingHorizontal: 16 },
  swap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  searchLabel: { fontSize: 11, fontWeight: '700', color: colors.ink2, letterSpacing: 0.4 },
  searchText: { fontWeight: '700', fontSize: 16, color: colors.ink },
  change: { fontWeight: '700', fontSize: 12, color: colors.ink2 },
  divider: { height: 1, backgroundColor: colors.line, marginLeft: 22 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink },
  square: { width: 10, height: 10, backgroundColor: colors.ink },
  now: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.paper, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ink, borderRadius: 12, padding: 12 },
});

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, CARGO_TYPES, LOCATIONS, MapView, Chip, H2, RoundButton, Row, Sheet, Toast, colors } from '@truck/shared';
import { useStore } from '../../store';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pickup, drop, order, toast, set } = useStore();

  return (
    <View style={{ flex: 1 }}>
      <MapView center={pickup} zoom={11} pickup={pickup} />
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
        <View style={s.searchBox}>
          <Pressable style={s.searchRow} onPress={() => router.push('/route?edit=pickup')}>
            <View style={s.dot} />
            <View style={{ flex: 1 }}>
              <Text style={s.searchLabel}>裝貨地點（起點）</Text>
              <Text style={s.searchText} numberOfLines={1}>{pickup.name}</Text>
            </View>
            <Text style={s.change}>更改</Text>
          </Pressable>
          <View style={s.divider} />
          <Pressable style={s.searchRow} onPress={() => router.push('/route?edit=drop')}>
            <View style={s.square} />
            <View style={{ flex: 1 }}>
              <Text style={s.searchLabel}>卸貨地點（終點）</Text>
              <Text style={s.searchText} numberOfLines={1}>{drop.name}</Text>
            </View>
            <Text style={s.change}>更改</Text>
          </Pressable>
        </View>
        <Button title="下一步：貨物內容" onPress={() => router.push('/cargo')} />

        {order && order.status !== 'cancelled' ? (
          <Pressable style={s.banner} onPress={() => router.push(order.status === 'created' ? '/checkout' : order.status === 'completed' ? '/receipt' : '/trip')}>
            <Ionicons name="bus" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800', flex: 1 }}>
              {order.status === 'created' ? '待付款' : '進行中'}：{order.orderNo}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        ) : null}

        <View>
          {LOCATIONS.filter((l) => l.name !== pickup.name)
            .slice(0, 3)
            .map((l) => (
              <Row
                key={l.id}
                title={l.name}
                subtitle={l.addr}
                icon={<Ionicons name="business-outline" size={18} />}
                onPress={() => {
                  set({ drop: l, route: null });
                  router.push('/route?edit=drop');
                }}
              />
            ))}
        </View>

        <H2>常用出貨</H2>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CARGO_TYPES.slice(0, 4).map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              onPress={() => {
                set({ cargoId: c.id });
                router.push('/route');
              }}
            />
          ))}
        </View>
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

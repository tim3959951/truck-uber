import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { H1, H2, Row, Tiny, colors, formatNTD, loadLabel } from '@truck/shared';
import { useStore } from '../../store';

export default function Activity() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { history, order, loadHistory } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => { loadHistory().catch(() => {}); }, []));
  const refresh = async () => { setRefreshing(true); await loadHistory().catch(() => {}); setRefreshing(false); };
  const live = order && !['completed', 'cancelled'].includes(order.status);
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, gap: 14 }}
      style={{ backgroundColor: '#fff' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <H1>行程</H1>
      {live ? (
        <Pressable
          onPress={() => router.push(order.status === 'created' ? '/checkout' : '/trip')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ink, borderRadius: 12, padding: 12 }}
        >
          <Ionicons name="bus" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', flex: 1 }}>{order.status === 'created' ? '待付款' : '進行中'}：{order.orderNo}</Text>
          <Text style={{ color: '#fff', fontWeight: '800' }}>{formatNTD(order.quote.total)}</Text>
        </Pressable>
      ) : null}
      <H2>過去</H2>
      {history.length === 0 ? <Tiny>還沒有完成的訂單。</Tiny> : null}
      <View>
        {history.map((h) => (
          <Row
            key={h.id}
            title={`${h.from} → ${h.to}`}
            subtitle={`${h.date} · ${loadLabel(h)} ${h.cargo}${h.status === 'cancelled' ? ' · 已取消' : ''}`}
            icon={<Ionicons name={h.status === 'cancelled' ? 'close-circle-outline' : 'bus-outline'} size={18} />}
            right={<Text style={{ fontWeight: '800', color: h.status === 'cancelled' ? colors.ink3 : colors.ink }}>{formatNTD(h.total)}</Text>}
          />
        ))}
      </View>
    </ScrollView>
  );
}

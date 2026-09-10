import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { H2, Row, Tiny, colors, formatNTD, loadLabel } from '@truck/shared';
import { useStore } from '../../store';

const DAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** Everything here is derived from the driver_earnings ledger (my_earnings RPC). */
export default function Earnings() {
  const insets = useSafeAreaInsets();
  const { earnings, history, loadEarnings, loadHistory } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => { loadEarnings().catch(() => {}); loadHistory().catch(() => {}); }, []));
  const refresh = async () => { setRefreshing(true); await Promise.all([loadEarnings(), loadHistory()]).catch(() => {}); setRefreshing(false); };

  const week = earnings?.week ?? [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...week, 1);
  const rows: [string, string][] = [
    ['今日收入', formatNTD(earnings?.today ?? 0)],
    ['今日趟數', `${earnings?.tripsToday ?? 0} 趟`],
    ['可撥款', formatNTD(earnings?.available ?? 0)],
    ['保留中（7 天後可撥）', formatNTD(earnings?.pending ?? 0)],
  ];
  return (
    <ScrollView
      style={{ backgroundColor: '#fff' }}
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, gap: 14 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Tiny>本週收入</Tiny>
      <Text style={s.hero}>{formatNTD(week.reduce((a, b) => a + b, 0))}</Text>
      <View style={s.bars}>
        {week.map((v, i) => {
          const today = (new Date().getDay() + 6) % 7 === i;
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4, height: 110, justifyContent: 'flex-end' }}>
              <View style={[s.bar, { height: `${Math.max(3, Math.round((v / max) * 90))}%` }, today && { backgroundColor: colors.ink }]} />
              <Tiny>{DAYS[i]}</Tiny>
            </View>
          );
        })}
      </View>
      <View>
        {rows.map(([t, v]) => (
          <Row key={t} title={t} right={<Text style={{ fontWeight: '800' }}>{v}</Text>} />
        ))}
      </View>
      <H2>最近趟次</H2>
      {(earnings?.recent ?? []).length === 0 ? <Tiny>完成第一趟後這裡會出現每趟的分帳明細。</Tiny> : null}
      <View>
        {(earnings?.recent ?? []).map((h) => (
          <Row
            key={h.id}
            title={`${h.from} → ${h.to}`}
            subtitle={`${h.date} · ${loadLabel(h)} ${h.cargo} · 運費 ${formatNTD(h.total)}`}
            icon={<Ionicons name="bus-outline" size={18} />}
            right={<Text style={{ fontWeight: '800' }}>{formatNTD(h.driverAmount)}</Text>}
          />
        ))}
      </View>
      {history.some((h) => h.status === 'cancelled') ? (
        <>
          <H2>已取消</H2>
          <View>
            {history.filter((h) => h.status === 'cancelled').map((h) => (
              <Row key={h.id} title={`${h.from} → ${h.to}`} subtitle={`${h.date} · ${h.orderNo}`} icon={<Ionicons name="close-circle-outline" size={18} />} />
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  hero: { fontSize: 36, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { width: '100%', backgroundColor: colors.fill2, borderRadius: 4 },
});

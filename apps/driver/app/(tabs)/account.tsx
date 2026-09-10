import { ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, H1, Row, Tag, Tiny, colors, showAlert } from '@truck/shared';
import { backend, useStore } from '../../store';

const V = { pending: '待審核', verified: '已驗證', rejected: '未通過' } as const;

export default function Account() {
  const insets = useSafeAreaInsets();
  const { session, signOut, setTailLift } = useStore();
  const rows: [string, string][] = [
    ['車輛', session?.vehicle?.desc ?? '未設定'],
    ['車牌', session?.vehicle?.plate ?? '未設定'],
    ['手機', session?.phone ?? ''],
    ['Email', session?.email ?? ''],
    ['撥款', '每週三撥款（正式版接金流後啟用）'],
    ['後端', backend.kind === 'supabase' ? 'Supabase（正式資料）' : '離線示範模式'],
  ];
  return (
    <ScrollView style={{ backgroundColor: '#fff' }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar initials={(session?.name ?? '司').slice(0, 1)} rating={session?.driverRating ?? 5} size={56} />
        <View style={{ flex: 1 }}>
          <H1>{session?.name ?? '司機'}</H1>
          <Tiny>{session?.driverTrips ?? 0} 趟</Tiny>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Tag label={`司機 ${V[session?.verification ?? 'pending']}`} tone={session?.verification === 'verified' ? 'go' : 'warn'} />
        <Tag label={`車輛 ${V[session?.vehicle?.verification ?? 'pending']}`} tone={session?.vehicle?.verification === 'verified' ? 'go' : 'warn'} />
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 15 }}>車輛有油壓升降尾門</Text>
            <Tiny>{session?.vehicle?.hasTailLift ? '開啟：會收到「需升降尾門」的訂單' : '關閉：需尾門的訂單不會派給你'}</Tiny>
          </View>
          <Switch
            value={!!session?.vehicle?.hasTailLift}
            onValueChange={(v) => setTailLift(v).catch((e) => showAlert('無法更新', (e as Error).message))}
            trackColor={{ true: colors.go, false: colors.fill2 }}
          />
        </View>
        {rows.map(([t, sub]) => (
          <Row key={t} title={t} subtitle={sub} />
        ))}
      </View>
      <Button
        title="登出"
        variant="secondary"
        onPress={() => showAlert('登出？', '登出前會自動下線。', [{ text: '取消', style: 'cancel' }, { text: '登出', style: 'destructive', onPress: () => signOut() }])}
      />
    </ScrollView>
  );
}

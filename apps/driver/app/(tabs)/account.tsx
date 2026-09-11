import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, DEFAULT_CLASSES, H1, Row, Tag, Tiny, colors, showAlert } from '@truck/shared';
import { backend, useStore } from '../../store';

const V = { pending: '待審核', verified: '已驗證', rejected: '未通過' } as const;

export default function Account() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, signOut, setTailLift, setVehicleClass } = useStore();
  const rows: [string, string][] = [
    ['資格審核', session?.onboardingStatus === 'approved' ? '已核可' : session?.onboardingStatus ?? '—'],
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
      <View style={{ gap: 8 }}>
        <Text style={{ fontWeight: '700', fontSize: 15 }}>我的車型級距</Text>
        <Tiny>{session?.onboardingStatus === 'submitted' || session?.onboardingStatus === 'approved' ? '送審後級距由平台審核變更；要改請聯絡客服。' : '只會收到同級距的媒合通知；送審前可自行修改。'}</Tiny>
        {session?.onboardingStatus === 'submitted' || session?.onboardingStatus === 'approved' ? (
          <Tag label={DEFAULT_CLASSES.find((k) => k.id === session?.vehicle?.classId)?.name ?? session?.vehicle?.classId ?? '—'} />
        ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DEFAULT_CLASSES.map((k) => {
            const on = session?.vehicle?.classId === k.id;
            return (
              <Pressable key={k.id} onPress={() => setVehicleClass(k.id).catch((e) => showAlert('無法更新', (e as Error).message))} style={{ width: '47%', flexGrow: 1, borderWidth: 1.5, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.ink : '#fff', borderRadius: 12, padding: 10 }}>
                <Text style={{ fontWeight: '800', color: on ? '#fff' : colors.ink }}>{k.name}</Text>
                <Tiny style={on ? { color: '#ddd' } : undefined}>{k.nickname} · 總重 {k.grossT}</Tiny>
              </Pressable>
            );
          })}
        </View>
        )}
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
      <Button title="查看資格申請資料" variant="secondary" onPress={() => router.push('/onboarding')} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="平台服務條款" variant="secondary" small style={{ flex: 1 }} onPress={() => router.push('/terms?kind=platform')} />
        <Button title="運送契約條款" variant="secondary" small style={{ flex: 1 }} onPress={() => router.push('/terms?kind=contract')} />
      </View>
      <Button
        title="登出"
        variant="secondary"
        onPress={() => showAlert('登出？', '登出前會自動下線。', [{ text: '取消', style: 'cancel' }, { text: '登出', style: 'destructive', onPress: () => signOut() }])}
      />
    </ScrollView>
  );
}

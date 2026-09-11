import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, H1, Row, Tiny, showAlert } from '@truck/shared';
import { backend, useStore } from '../../store';

export default function Account() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, signOut } = useStore();
  const rows: [string, string][] = [
    ['聯絡人', `${session?.name ?? ''} ${session?.phone ?? ''}`],
    ['Email', session?.email ?? ''],
    ['付款方式', '測試付款（沙盒）'],
    ['後端', backend.kind === 'supabase' ? 'Supabase（正式資料）' : '離線示範模式'],
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, gap: 16 }} style={{ backgroundColor: '#fff' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <H1>{session?.company || session?.name || '客戶'}</H1>
          <Tiny>企業帳戶</Tiny>
        </View>
        <Avatar initials={(session?.company || session?.name || '客').slice(0, 1)} />
      </View>
      <View>
        {rows.map(([t, sub]) => (
          <Row key={t} title={t} subtitle={sub} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="平台服務條款" variant="secondary" small style={{ flex: 1 }} onPress={() => router.push('/terms?kind=platform')} />
        <Button title="運送契約條款" variant="secondary" small style={{ flex: 1 }} onPress={() => router.push('/terms?kind=contract')} />
      </View>
      <Button
        title="登出"
        variant="secondary"
        onPress={() => showAlert('登出？', undefined, [{ text: '取消', style: 'cancel' }, { text: '登出', style: 'destructive', onPress: () => signOut() }])}
      />
    </ScrollView>
  );
}

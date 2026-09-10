import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors } from '@truck/shared';
import { useStore } from '../../store';

export default function TabsLayout() {
  const status = useStore((s) => s.order?.status);
  // Like Uber Driver: hide the tab bar while a request or trip is on screen.
  const busy = !!status && status !== 'searching';
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.ink3,
        tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
        tabBarStyle: busy ? { display: 'none' } : { borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '出車', tabBarIcon: ({ color, size }) => <Ionicons name="navigate" size={size} color={color} /> }} />
      <Tabs.Screen name="earnings" options={{ title: '收入', tabBarIcon: ({ color, size }) => <Ionicons name="card-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="account" options={{ title: '帳戶', tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} /> }} />
    </Tabs>
  );
}

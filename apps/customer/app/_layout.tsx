import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { configureForegroundNotifications } from '@truck/shared';
import { backend, useStore } from '../store';

configureForegroundNotifications();

export default function RootLayout() {
  const { authReady, session, init } = useStore();
  const status = useStore((s) => s.order?.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    init();
  }, []);

  // Auth gate + order-driven navigation.
  useEffect(() => {
    if (!authReady) return;
    const inAuth = segments[0] === '(auth)';
    if (!session) {
      if (!inAuth && segments[0] !== 'terms') router.replace('/(auth)/login');
      return;
    }
    if (inAuth) {
      router.replace('/');
      return;
    }
    const screen = segments[0];
    // while an order is live the customer stays on its screen (checkout → trip → receipt); the contract page is always allowed
    if (screen === 'contract' || screen === 'terms') return;
    if (status === 'created' && screen !== 'checkout') router.replace('/checkout');
    else if (status && ['searching', 'offered', 'accepted', 'arrived', 'in_transit', 'delivered'].includes(status) && screen !== 'trip') router.replace('/trip');
    else if (status === 'completed' && screen !== 'receipt') router.replace('/receipt');
  }, [authReady, session, status, segments[0]]);

  if (!authReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      {backend.kind === 'mock' ? (
        <View style={{ backgroundColor: '#e11900', paddingVertical: 6, paddingHorizontal: 12, zIndex: 999 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, textAlign: 'center' }}>離線示範模式：未連接 Supabase，資料都是假的（任何帳密都能登入）</Text>
        </View>
      ) : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="route" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="cargo" />
        <Stack.Screen name="tier" />
        <Stack.Screen name="checkout" options={{ gestureEnabled: false }} />
        <Stack.Screen name="trip" options={{ gestureEnabled: false }} />
        <Stack.Screen name="receipt" options={{ gestureEnabled: false }} />
        <Stack.Screen name="contract" />
        <Stack.Screen name="terms" />
      </Stack>
    </>
  );
}

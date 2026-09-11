import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { configureForegroundNotifications } from '@truck/shared';
import { backend, useStore } from '../store';

configureForegroundNotifications();

export default function RootLayout() {
  const { authReady, session, init } = useStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const inAuth = segments[0] === '(auth)';
    if (!session && !inAuth) router.replace('/(auth)/login');
    if (session && inAuth) router.replace('/');
    // carriers must pass eligibility review before they see the dispatch screen
    if (session && !inAuth && session.role === 'driver' && (session.onboardingStatus ?? 'draft') !== 'approved' && segments[0] !== 'onboarding' && segments[0] !== 'terms') router.replace('/onboarding');
  }, [authReady, session, segments[0]]);

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
        <Stack.Screen name="contract" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="terms" />
      </Stack>
    </>
  );
}

import { useRouter } from 'expo-router';
import { PhoneVerifyView } from '@truck/shared';
import { backend, useStore } from '../store';

/** 手機簡訊驗證：登入後 profiles.phone_verified_at 為空就會被 _layout 導到這裡 */
export default function VerifyScreen() {
  const router = useRouter();
  const { session, refreshSession, signOut } = useStore();
  if (!session) return null;
  return (
    <PhoneVerifyView
      backend={backend}
      session={session}
      onDone={async () => { await refreshSession(); router.replace('/'); }}
      onSkip={() => { useStore.setState({ phoneSkipped: true }); router.replace('/'); }}
      onSignOut={() => signOut()}
    />
  );
}

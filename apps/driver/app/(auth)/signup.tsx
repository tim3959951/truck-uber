import { useRouter } from 'expo-router';
import { AuthForm } from '@truck/shared';
import { backend, useStore } from '../../store';

export default function SignUp() {
  const router = useRouter();
  const { signIn, signUp, adoptSession } = useStore();
  return <AuthForm role="driver" mode="signup" backend={backend} onVerified={adoptSession} onLogin={signIn} onSignUp={signUp} onSwitch={() => router.replace('/(auth)/login')} onOpenTerms={(k) => router.push(`/terms?kind=${k}`)} />;
}

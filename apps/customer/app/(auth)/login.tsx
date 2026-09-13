import { useRouter } from 'expo-router';
import { AuthForm } from '@truck/shared';
import { backend, useStore } from '../../store';

export default function Login() {
  const router = useRouter();
  const { signIn, signUp, adoptSession } = useStore();
  return <AuthForm role="customer" mode="login" backend={backend} onVerified={adoptSession} onLogin={signIn} onSignUp={signUp} onSwitch={() => router.replace('/(auth)/signup')} onOpenTerms={(k) => router.push(`/terms?kind=${k}`)} />;
}

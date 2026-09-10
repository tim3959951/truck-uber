import { useRouter } from 'expo-router';
import { AuthForm } from '@truck/shared';
import { backend, useStore } from '../../store';

export default function Login() {
  const router = useRouter();
  const { signIn, signUp } = useStore();
  return <AuthForm role="customer" mode="login" backendKind={backend.kind} onLogin={signIn} onSignUp={signUp} onSwitch={() => router.replace('/(auth)/signup')} />;
}

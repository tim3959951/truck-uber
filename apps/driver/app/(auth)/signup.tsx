import { useRouter } from 'expo-router';
import { AuthForm } from '@truck/shared';
import { backend, useStore } from '../../store';

export default function SignUp() {
  const router = useRouter();
  const { signIn, signUp } = useStore();
  return <AuthForm role="driver" mode="signup" backendKind={backend.kind} onLogin={signIn} onSignUp={signUp} onSwitch={() => router.replace('/(auth)/login')} />;
}

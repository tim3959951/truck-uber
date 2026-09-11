import { useLocalSearchParams, useRouter } from 'expo-router';
import { TermsView } from '@truck/shared';
import { backend } from '../store';

export default function TermsScreen() {
  const router = useRouter();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  return <TermsView backend={backend} kind={kind === 'contract' ? 'contract' : 'platform'} onBack={() => router.back()} />;
}

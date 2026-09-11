import { useLocalSearchParams, useRouter } from 'expo-router';
import { ContractView } from '@truck/shared';
import { backend, useStore } from '../store';

export default function ContractScreen() {
  const router = useRouter();
  const { order: id } = useLocalSearchParams<{ order?: string }>();
  const current = useStore((s) => s.order);
  const orderId = id || current?.id || '';
  return <ContractView backend={backend} orderId={orderId} me="customer" onBack={() => router.back()} />;
}

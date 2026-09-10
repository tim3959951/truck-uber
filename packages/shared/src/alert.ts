/**
 * Cross-platform alert/confirm. react-native-web does not implement Alert.alert,
 * so on web we fall back to window.alert / window.confirm.
 */
import { Alert, Platform } from 'react-native';

export type AlertButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };

export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }
  const ok = window.confirm(text);
  const cancel = buttons.find((b) => b.style === 'cancel') ?? buttons[0];
  const confirm = buttons.find((b) => b !== cancel) ?? buttons[buttons.length - 1];
  (ok ? confirm : cancel).onPress?.();
}

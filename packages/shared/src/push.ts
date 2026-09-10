/**
 * Expo push registration. Remote push does NOT work in Expo Go (SDK 53+);
 * it needs a development build (eas build --profile development). This
 * function degrades to null in that case so the rest of the app is unaffected.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export async function registerForPush(): Promise<{ token: string; platform: string } | null> {
  try {
    if (Platform.OS === 'web') return null;
    if (!Device.isDevice) return null;
    if (Constants.appOwnership === 'expo') return null; // Expo Go: no remote push
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return { token: t.data, platform: Platform.OS };
  } catch (e) {
    console.warn('[push] registration skipped:', (e as Error).message);
    return null;
  }
}

/** Show notifications while the app is in the foreground too. */
export function configureForegroundNotifications() {
  if (Platform.OS === 'web') return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    /* not available (e.g. web) */
  }
}

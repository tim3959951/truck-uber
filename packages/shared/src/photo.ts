import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/**
 * 現場貨物照片：拍照或從相簿選一張，回傳本機 uri（web 是 blob:/data: uri）。
 * 回傳 null = 使用者取消或沒有權限。照片縮到 1600px、品質 0.7，手機上傳約 200–500 KB。
 */
const OPTS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.7,
  allowsEditing: false,
  exif: false,
};

export async function takeCargoPhoto(): Promise<string | null> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }
  // On web this opens the file picker with capture="environment" (rear camera on phones).
  const r = await ImagePicker.launchCameraAsync({ ...OPTS, cameraType: ImagePicker.CameraType.back });
  return r.canceled || !r.assets?.[0]?.uri ? null : r.assets[0].uri;
}

export async function pickCargoPhoto(): Promise<string | null> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
  }
  const r = await ImagePicker.launchImageLibraryAsync({ ...OPTS, selectionLimit: 1 });
  return r.canceled || !r.assets?.[0]?.uri ? null : r.assets[0].uri;
}

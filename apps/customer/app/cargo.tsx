import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, CARGO_TYPES, H1, RoundButton, Stepper, Tiny, colors, formatNTD, pickCargoPhoto, showAlert, takeCargoPhoto } from '@truck/shared';
import { useStore } from '../store';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  soil: 'leaf-outline',
  build: 'grid-outline',
  steel: 'reorder-four-outline',
  mach: 'cog-outline',
  agri: 'nutrition-outline',
  box: 'cube-outline',
};

export default function Cargo() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pallets, cargoId, note, pricing, needTailLift, helpers, cargoPhotoUri, set } = useStore();

  const snap = async (fn: () => Promise<string | null>) => {
    try {
      const uri = await fn();
      if (uri) set({ cargoPhotoUri: uri });
    } catch (e) {
      showAlert('無法取得照片', (e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top + 8 }}>
      <View style={s.head}>
        <RoundButton glyph="‹" onPress={() => router.back()} />
        <H1>要載什麼貨？</H1>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 18, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <Text style={s.label}>棧板數量（托）</Text>
          <Stepper value={pallets} min={1} max={pricing.maxPallets} unit="托" hint={`17噸車最多 ${pricing.maxPallets} 托`} onChange={(v) => set({ pallets: v })} />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={s.label}>貨物種類</Text>
          <View style={s.grid}>
            {CARGO_TYPES.map((c) => {
              const on = cargoId === c.id;
              return (
                <Pressable key={c.id} onPress={() => set({ cargoId: c.id })} style={[s.cargo, on && s.cargoOn]}>
                  <Ionicons name={ICONS[c.id]} size={26} color={on ? '#fff' : colors.ink} />
                  <Text style={[s.cargoText, on && { color: '#fff' }]}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={s.label}>品名 / 備註（選填）</Text>
          <TextInput
            value={note}
            onChangeText={(t) => set({ note: t })}
            placeholder="例：XX牌培養土 25kg，怕雨淋"
            placeholderTextColor={colors.ink3}
            style={s.input}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={s.label}>現場裝卸需求（加價項目）</Text>
          <Pressable onPress={() => set({ needTailLift: !needTailLift })} style={[s.addon, needTailLift && s.addonOn]}>
            <Ionicons name="arrow-up-circle-outline" size={24} color={needTailLift ? '#fff' : colors.ink} />
            <View style={{ flex: 1 }}>
              <Text style={[s.addonTitle, needTailLift && { color: '#fff' }]}>需要升降尾門</Text>
              <Text style={[s.addonSub, needTailLift && { color: '#ddd' }]}>現場沒有堆高機，車輛需配備油壓升降尾門把棧板升上車斗</Text>
            </View>
            <Text style={[s.addonPrice, needTailLift && { color: '#fff' }]}>+{formatNTD(pricing.tailLiftFee)}</Text>
          </Pressable>
          <View style={[s.addon, helpers > 0 && s.addonOn]}>
            <Ionicons name="people-outline" size={24} color={helpers > 0 ? '#fff' : colors.ink} />
            <View style={{ flex: 1 }}>
              <Text style={[s.addonTitle, helpers > 0 && { color: '#fff' }]}>額外隨車搬運工</Text>
              <Text style={[s.addonSub, helpers > 0 && { color: '#ddd' }]}>人工搬運、疊貨、定位；每趟 {formatNTD(pricing.helperFee)}（隨車 1 人）</Text>
            </View>
            <View style={s.mini}>
              <Pressable onPress={() => set({ helpers: Math.max(0, helpers - 1) })} style={s.miniBtn}><Text style={s.miniText}>−</Text></Pressable>
              <Text style={[s.miniVal, helpers > 0 && { color: '#fff' }]}>{helpers}</Text>
              <Pressable onPress={() => set({ helpers: Math.min(1, helpers + 1) })} style={s.miniBtn}><Text style={s.miniText}>+</Text></Pressable>
            </View>
          </View>
          <Tiny>司機本人只負責開車與綁繩帆布；需要人力搬運請加搬運工。</Tiny>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={s.label}>現場貨物照片（強烈建議）</Text>
          <Tiny>拍已經打包好、準備出貨的實際貨態。司機接單前會看，也是出貨證明與運輸途中倒塌時的責任釐清依據。</Tiny>
          {cargoPhotoUri ? (
            <View style={{ gap: 8 }}>
              <Image source={{ uri: cargoPhotoUri }} style={s.photo} resizeMode="cover" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="重拍" variant="secondary" style={{ flex: 1 }} onPress={() => snap(takeCargoPhoto)} />
                <Button title="移除" variant="secondary" style={{ flex: 1 }} onPress={() => set({ cargoPhotoUri: null })} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="拍照" variant="secondary" style={{ flex: 1 }} onPress={() => snap(takeCargoPhoto)} />
              <Button title="從相簿選" variant="secondary" style={{ flex: 1 }} onPress={() => snap(pickCargoPhoto)} />
            </View>
          )}
        </View>
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button title="下一步：選擇車種" onPress={() => router.push('/tier')} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: colors.fill },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14 },
  label: { fontSize: 12, fontWeight: '700', color: colors.ink2, letterSpacing: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cargo: { width: '31%', flexGrow: 1, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center', gap: 6 },
  cargoOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  cargoText: { fontWeight: '700', fontSize: 12, textAlign: 'center' },
  input: { backgroundColor: colors.fill, borderRadius: 10, padding: 14, fontSize: 15, fontWeight: '600' },
  addon: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 12 },
  addonOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  addonTitle: { fontWeight: '800', fontSize: 15, color: colors.ink },
  addonSub: { fontSize: 12, color: colors.ink2, marginTop: 2 },
  addonPrice: { fontWeight: '800', fontVariant: ['tabular-nums'], color: colors.ink },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  miniText: { fontSize: 18, fontWeight: '700', color: colors.ink },
  miniVal: { width: 24, textAlign: 'center', fontWeight: '800', fontSize: 16, color: colors.ink },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line },
});

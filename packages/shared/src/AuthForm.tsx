import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAlert } from './alert';
import { DEFAULT_CLASSES } from './data';
import { colors } from './theme';
import type { SignUpInput } from './types';
import { Button, H1, Tiny } from './ui';

type Props = {
  role: 'customer' | 'driver';
  mode: 'login' | 'signup';
  onLogin: (email: string, password: string) => Promise<void>;
  onSignUp: (input: SignUpInput) => Promise<boolean>;
  onSwitch: () => void;
  backendKind: 'supabase' | 'mock';
};

export function AuthForm({ role, mode, onLogin, onSignUp, onSwitch, backendKind }: Props) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [plate, setPlate] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [hasTailLift, setHasTailLift] = useState(false);
  const [classId, setClassId] = useState('17t');
  const [busy, setBusy] = useState(false);

  const isDriver = role === 'driver';
  const title = mode === 'login' ? (isDriver ? '司機登入' : '登入') : isDriver ? '註冊成為大車司機' : '建立帳號';

  const submit = async () => {
    if (!email || !password) return showAlert('請輸入 Email 與密碼');
    if (mode === 'signup' && (!name || !phone)) return showAlert('請輸入姓名與電話');
    if (mode === 'signup' && isDriver && !plate) return showAlert('請輸入車牌號碼');
    setBusy(true);
    try {
      if (mode === 'login') await onLogin(email, password);
      else {
        const ok = await onSignUp({ email, password, role, name, phone, company, plate, makeModel, hasTailLift, classId });
        if (!ok) showAlert('請確認 Email', '我們已寄出確認信，點擊信中連結後再回來登入。');
      }
    } catch (e) {
      showAlert('無法完成', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 40, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Text style={s.brand}>大車叫車{isDriver ? ' · 司機端' : ''}</Text>
        <H1>{title}</H1>
        {backendKind === 'mock' ? <Tiny>目前是離線示範模式（未設定 Supabase），任何帳密都能登入。</Tiny> : null}

        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@company.tw" />
        <Field label="密碼" value={password} onChangeText={setPassword} secureTextEntry placeholder="至少 6 碼" />
        {mode === 'signup' ? (
          <>
            <Field label={isDriver ? '司機姓名' : '聯絡人姓名'} value={name} onChangeText={setName} placeholder="王小明" />
            <Field label="手機" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="09xx-xxx-xxx" />
            {isDriver ? (
              <>
                <Field label="車牌號碼" value={plate} onChangeText={(t) => setPlate(t.toUpperCase())} autoCapitalize="characters" placeholder="KEA-5177" />
                <View style={{ gap: 6 }}>
                  <Text style={s.label}>車型級距（只會收到同級距的媒合通知）</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {DEFAULT_CLASSES.map((k) => {
                      const on = classId === k.id;
                      return (
                        <Pressable key={k.id} onPress={() => setClassId(k.id)} style={[s.chip, on && s.chipOn]}>
                          <Text style={[{ fontWeight: '800' }, on && { color: '#fff' }]}>{k.name}</Text>
                          <Tiny style={on ? { color: '#ddd' } : undefined}>{k.nickname} · 總重 {k.grossT}</Tiny>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <Field label="廠牌型號（選填）" value={makeModel} onChangeText={setMakeModel} placeholder="HINO 700" />
                <Pressable onPress={() => setHasTailLift((v) => !v)} style={s.check}>
                  <View style={[s.checkBox, hasTailLift && s.checkBoxOn]}>{hasTailLift ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>車輛有油壓升降尾門</Text>
                    <Tiny>勾了才會收到「需升降尾門」的訂單（每趟另計尾門費）</Tiny>
                  </View>
                </Pressable>
                <Tiny>註冊後車輛預設為「待審核」，管理員驗證後才會顯示已驗證；測試期間不影響接單。</Tiny>
              </>
            ) : (
              <Field label="公司 / 工廠名稱（選填）" value={company} onChangeText={setCompany} placeholder="大明園藝資材行" />
            )}
          </>
        ) : null}

        <Button title={mode === 'login' ? '登入' : '建立帳號'} onPress={submit} loading={busy} style={{ marginTop: 6 }} />
        <Pressable onPress={onSwitch} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.ink2 }}>{mode === 'login' ? '還沒有帳號？註冊' : '已有帳號？登入'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.ink3} style={s.input} {...rest} />
    </View>
  );
}

const s = StyleSheet.create({
  brand: { fontSize: 13, fontWeight: '800', letterSpacing: 1, color: colors.ink2 },
  label: { fontSize: 12, fontWeight: '700', color: colors.ink2, letterSpacing: 0.5 },
  input: { backgroundColor: colors.fill, borderRadius: 10, padding: 14, fontSize: 15, fontWeight: '600' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  chip: { width: '47%', flexGrow: 1, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 10, gap: 2 },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  checkBoxOn: { backgroundColor: colors.ink },
});

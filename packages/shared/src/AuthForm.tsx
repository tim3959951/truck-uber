import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAlert } from './alert';
import type { Backend } from './backend';
import { DEFAULT_CLASSES } from './data';
import { PLATFORM_TERMS_VERSION } from './platformTerms';
import { colors } from './theme';
import type { SignUpInput } from './types';
import { Button, H1, Tiny } from './ui';

type Props = {
  role: 'customer' | 'driver';
  mode: 'login' | 'signup';
  backend: Backend;
  onLogin: (email: string, password: string) => Promise<void>;
  /** resolves false when the project wants the e-mail verified first (the form then shows the code step) */
  onSignUp: (input: SignUpInput) => Promise<boolean>;
  /** called once the e-mail code is accepted and a session exists; the app adopts the session and moves on (phone step) */
  onVerified: () => Promise<void>;
  onSwitch: () => void;
  /** open the terms page (platform terms or contract template) */
  onOpenTerms?: (kind: 'platform' | 'contract') => void;
};

/* ---- validation (kept here so both apps behave identically) ---- */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const isTwMobile = (v: string) => /^09\d{8}$/.test(v.replace(/[^0-9]/g, ''));
/** 台灣車牌：ABC-1234、123-AB、KEA-5177、1234-AB… 只檢查「有字母有數字、長度合理」 */
export const isPlate = (v: string) => /^[A-Z0-9]{2,4}-?[A-Z0-9]{2,4}$/.test(v.trim().toUpperCase()) && /[A-Z]/.test(v) && /[0-9]/.test(v);
export const MIN_PASSWORD = 6;

export function AuthForm({ role, mode, backend, onLogin, onSignUp, onVerified, onSwitch, onOpenTerms }: Props) {
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
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  /** signup flow: fill the form → (project requires e-mail confirmation) enter the 6-digit code */
  const [step, setStep] = useState<'form' | 'email'>('form');

  const isDriver = role === 'driver';
  const isSignup = mode === 'signup';
  const title = mode === 'login' ? (isDriver ? '承運人登入' : '登入') : isDriver ? '註冊成為 Pallo 承運人' : '建立帳號';
  const touch = (k: string) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));

  // inline rules: an error shows once the field was left, or as soon as something invalid is typed
  const err = (k: string, value: string, bad: boolean, msg: string) => (bad && (touched[k] || value.length > 0) ? msg : null);
  const eEmail = err('email', email, !isEmail(email), '請輸入正確的 Email');
  const ePassword = err('password', password, password.length < MIN_PASSWORD, `密碼至少 ${MIN_PASSWORD} 碼`);
  const eName = isSignup ? err('name', name, name.trim().length < 2, isDriver ? '請輸入姓名' : '請輸入聯絡人姓名') : null;
  const ePhone = isSignup ? err('phone', phone, !isTwMobile(phone), '請輸入 10 碼手機號碼（09 開頭）') : null;
  const eCompany = isSignup && !isDriver ? err('company', company, company.trim().length < 2, '請輸入公司／單位名稱（個人請填姓名）') : null;
  const ePlate = isSignup && isDriver ? err('plate', plate, !isPlate(plate), '請輸入車牌號碼，例如 ABC-1234') : null;

  const loginValid = isEmail(email) && password.length >= MIN_PASSWORD;
  const signupValid =
    loginValid && name.trim().length >= 2 && isTwMobile(phone) && agree && (isDriver ? isPlate(plate) : company.trim().length >= 2);
  const canSubmit = mode === 'login' ? loginValid : signupValid;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (mode === 'login') await onLogin(email.trim(), password);
      else {
        const ok = await onSignUp({
          email: email.trim(), password, role, name: name.trim(), phone: phone.replace(/[^0-9]/g, ''), company: company.trim(),
          plate: plate.trim().toUpperCase(), makeModel: makeModel.trim(), hasTailLift, classId, termsVersion: PLATFORM_TERMS_VERSION,
        });
        if (!ok) setStep('email');
      }
    } catch (e) {
      showAlert('無法完成', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'email') return <EmailCodeStep email={email.trim()} backend={backend} onVerified={onVerified} onBack={() => setStep('form')} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 40, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Text style={s.brand}>Pallo{isDriver ? ' · 承運人端' : ''}</Text>
        <H1>{title}</H1>
        {backend.kind === 'mock' ? <Tiny>目前是離線示範模式（未設定 Supabase），任何帳密都能登入。</Tiny> : null}

        <Field label="Email" value={email} onChangeText={setEmail} onBlur={() => touch('email')} error={eEmail} ok={isEmail(email)} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
        <Field label="密碼" value={password} onChangeText={setPassword} onBlur={() => touch('password')} error={ePassword} ok={password.length >= MIN_PASSWORD} hint={isSignup ? `至少 ${MIN_PASSWORD} 碼` : undefined} secureTextEntry autoComplete={isSignup ? 'new-password' : 'password'} textContentType={isSignup ? 'newPassword' : 'password'} />
        {isSignup ? (
          <>
            {!isDriver ? (
              <Field label="公司／單位名稱" value={company} onChangeText={setCompany} onBlur={() => touch('company')} error={eCompany} ok={company.trim().length >= 2} hint="公司、工廠、建商、農場都可以；個人請填姓名" />
            ) : null}
            <Field label={isDriver ? '司機姓名' : '聯絡人姓名'} value={name} onChangeText={setName} onBlur={() => touch('name')} error={eName} ok={name.trim().length >= 2} autoComplete="name" textContentType="name" />
            <Field label="手機" value={phone} onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, '').slice(0, 10))} onBlur={() => touch('phone')} error={ePhone} ok={isTwMobile(phone)} hint="註冊後會傳簡訊驗證碼到這支手機" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
            {isDriver ? (
              <>
                <Field label="車牌號碼" value={plate} onChangeText={(t) => setPlate(t.toUpperCase())} onBlur={() => touch('plate')} error={ePlate} ok={isPlate(plate)} autoCapitalize="characters" />
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
                <Field label="廠牌型號（選填）" value={makeModel} onChangeText={setMakeModel} />
                <Pressable onPress={() => setHasTailLift((v) => !v)} style={s.check}>
                  <View style={[s.checkBox, hasTailLift && s.checkBoxOn]}>{hasTailLift ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>車輛有油壓升降尾門</Text>
                    <Tiny>勾了才會收到「需升降尾門」的訂單（每趟另計尾門費）</Tiny>
                  </View>
                </Pressable>
                <Tiny>註冊後還要上傳證件送審，審核通過才能上線接單。</Tiny>
              </>
            ) : null}
            <Pressable onPress={() => setAgree((v) => !v)} style={s.check}>
              <View style={[s.checkBox, agree && s.checkBoxOn]}>{agree ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700' }}>我已閱讀並同意平台服務條款（v{PLATFORM_TERMS_VERSION}）</Text>
                <Tiny>Pallo 是資訊媒合平台，不承運貨物；運送契約於接單時在託運人與承運人之間成立。</Tiny>
              </View>
            </Pressable>
            <Pressable onPress={() => onOpenTerms?.('platform')}><Text style={s.link}>閱讀平台服務條款全文</Text></Pressable>
            <Pressable onPress={() => onOpenTerms?.('contract')}><Text style={s.link}>閱讀運送契約條款範本</Text></Pressable>
          </>
        ) : null}

        <Button title={mode === 'login' ? '登入' : '建立帳號'} onPress={submit} loading={busy} disabled={!canSubmit} style={{ marginTop: 6 }} />
        {isSignup && !canSubmit ? <Tiny style={{ textAlign: 'center' }}>{agree ? '填完上面的欄位就可以建立帳號' : '請填完欄位並勾選同意條款'}</Tiny> : null}
        <Pressable onPress={onSwitch} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.ink2 }}>{mode === 'login' ? '還沒有帳號？註冊' : '已有帳號？登入'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Step 2 of sign-up: the confirmation e-mail carries a 6-digit code (Supabase template uses {{ .Token }}).
 * Red frame until the code is accepted, green once verified. The link in the e-mail still works too.
 */
function EmailCodeStep({ email, backend, onVerified, onBack }: { email: string; backend: Backend; onVerified: () => Promise<void>; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle');
  const [msg, setMsg] = useState('');
  const [cooldown, setCooldown] = useState(60);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  // the user may click the link in the e-mail instead of typing the code: the session then lands in storage → pick it up
  useEffect(() => {
    let done = false;
    const t = setInterval(async () => {
      if (done) return;
      const s = await backend.getSession().catch(() => null);
      if (s && !done) {
        done = true;
        clearInterval(t);
        setState('ok');
        setMsg('Email 驗證成功');
        onVerified().catch(() => {});
      }
    }, 4000);
    return () => { done = true; clearInterval(t); };
  }, []);

  const check = async (c: string) => {
    setState('checking');
    setMsg('');
    try {
      await backend.verifyEmailCode(email, c);
      setState('ok');
      setMsg('Email 驗證成功');
      await onVerified();
    } catch (e) {
      setState('bad');
      setMsg((e as Error).message);
    }
  };
  const onChange = (t: string) => {
    const c = t.replace(/[^0-9]/g, '').slice(0, 6);
    setCode(c);
    if (state !== 'ok') setState('idle');
    if (c.length === 6) check(c);
  };
  const resend = async () => {
    try {
      await backend.resendEmailCode(email);
      setCooldown(60);
      setMsg('已重新寄送');
      setState('idle');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', padding: 24, paddingTop: insets.top + 40, gap: 14 }}>
      <Text style={s.brand}>Pallo</Text>
      <H1>驗證 Email</H1>
      <Text style={{ fontSize: 14, lineHeight: 22 }}>驗證信已寄到 <Text style={{ fontWeight: '800' }}>{email}</Text>。輸入信中的 6 位數驗證碼，或直接點信裡的「確認」連結再回到這個畫面。找不到的話看一下垃圾郵件。</Text>
      <CodeInput value={code} onChangeText={onChange} state={state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : code.length === 6 ? 'idle' : 'pending'} editable={state !== 'ok' && state !== 'checking'} />
      {msg ? <Text style={{ color: state === 'ok' ? colors.go : state === 'bad' ? colors.bad : colors.ink2, fontWeight: '700' }}>{msg}</Text> : null}
      {state === 'checking' ? <Tiny>檢查中…</Tiny> : null}
      {state !== 'ok' ? (
        <>
          <Button title={cooldown > 0 ? `重新寄送驗證碼（${cooldown} 秒後）` : '重新寄送驗證碼'} variant="secondary" disabled={cooldown > 0} onPress={resend} />
          <Pressable onPress={onBack} style={{ alignItems: 'center', padding: 8 }}>
            <Text style={{ fontWeight: '700', color: colors.ink2 }}>Email 打錯了？回上一步</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

/** 6-digit code box shared by the e-mail and phone steps: red = wrong / not yet, green = accepted */
export function CodeInput({ value, onChangeText, state, editable = true, autoFocus = true }: { value: string; onChangeText: (t: string) => void; state: 'pending' | 'idle' | 'ok' | 'bad'; editable?: boolean; autoFocus?: boolean }) {
  const ref = useRef<TextInput>(null);
  const border = state === 'ok' ? colors.go : state === 'bad' || state === 'pending' ? colors.bad : colors.ink;
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>驗證碼</Text>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        style={[s.input, s.code, { borderColor: border }]}
      />
    </View>
  );
}

export function Field(props: React.ComponentProps<typeof TextInput> & { label: string; error?: string | null; ok?: boolean; hint?: string }) {
  const { label, error, ok, hint, style, ...rest } = props;
  const border = error ? colors.bad : ok ? colors.go : 'transparent';
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.ink3} style={[s.input, { borderColor: border }, style]} {...rest} />
      {error ? <Text style={s.err}>{error}</Text> : hint ? <Tiny>{hint}</Tiny> : null}
    </View>
  );
}

const s = StyleSheet.create({
  brand: { fontSize: 13, fontWeight: '800', letterSpacing: 1, color: colors.ink2 },
  label: { fontSize: 12, fontWeight: '700', color: colors.ink2, letterSpacing: 0.5 },
  input: { backgroundColor: colors.fill, borderRadius: 10, padding: 14, fontSize: 15, fontWeight: '600', borderWidth: 1.5, borderColor: 'transparent' },
  code: { fontSize: 26, letterSpacing: 12, textAlign: 'center', fontWeight: '800' },
  err: { fontSize: 12, color: colors.bad, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  link: { color: colors.ink2, textDecorationLine: 'underline', fontSize: 13 },
  chip: { width: '47%', flexGrow: 1, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 10, gap: 2 },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  checkBoxOn: { backgroundColor: colors.ink },
});

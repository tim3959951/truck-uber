import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CodeInput, Field, isTwMobile } from './AuthForm';
import type { Backend } from './backend';
import { colors } from './theme';
import type { Session } from './types';
import { Button, H1, Tiny } from './ui';

/**
 * 手機簡訊驗證（客戶端與司機端共用）。登入後若 profiles.phone_verified_at 為空就會被導到這頁。
 * 流程：確認／修改手機 → 傳送驗證碼（Supabase phone_change OTP）→ 輸入 6 碼 → 紅框變綠框 → 回 App。
 * required = false 時可以「稍後再驗證」（試營運、簡訊還沒開通時用）。
 */
export function PhoneVerifyView({ backend, session, onDone, onSkip, onSignOut }: { backend: Backend; session: Session; onDone: () => Promise<void>; onSkip?: () => void; onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState((session.phone ?? '').replace(/[^0-9]/g, ''));
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setBusy(true);
    setMsg('');
    try {
      await backend.startPhoneVerification(phone);
      setSent(true);
      setCooldown(60);
      setCode('');
      setState('idle');
    } catch (e) {
      setMsg((e as Error).message);
      setState('bad');
    } finally {
      setBusy(false);
    }
  };
  const check = async (c: string) => {
    setState('checking');
    setMsg('');
    try {
      await backend.verifyPhoneCode(phone, c);
      setState('ok');
      setMsg('手機驗證成功');
      await onDone();
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
  const required = session.phoneVerificationRequired === true;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 40, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Text style={s.brand}>Pallo</Text>
        <H1>驗證手機</H1>
        <Text style={{ fontSize: 14, lineHeight: 22 }}>
          {session.role === 'driver' ? '貨主接單後會用這支手機聯絡你，' : '承運人接單後會用這支手機聯絡你，'}請確認號碼並輸入簡訊驗證碼。
        </Text>
        {backend.kind === 'mock' ? <Tiny>示範模式：驗證碼是 123456。</Tiny> : null}

        <Field label="手機" value={phone} onChangeText={(t) => { setPhone(t.replace(/[^0-9]/g, '').slice(0, 10)); setSent(false); }} error={phone.length > 0 && !isTwMobile(phone) ? '請輸入 10 碼手機號碼（09 開頭）' : null} ok={isTwMobile(phone)} keyboardType="phone-pad" editable={state !== 'ok'} />
        {!sent ? (
          <Button title="傳送簡訊驗證碼" onPress={send} loading={busy} disabled={!isTwMobile(phone)} />
        ) : (
          <>
            <CodeInput value={code} onChangeText={onChange} state={state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : code.length === 6 ? 'idle' : 'pending'} editable={state !== 'ok' && state !== 'checking'} />
            {state === 'checking' ? <Tiny>檢查中…</Tiny> : null}
            {state !== 'ok' ? <Button title={cooldown > 0 ? `重新傳送（${cooldown} 秒後）` : '重新傳送驗證碼'} variant="secondary" disabled={cooldown > 0} onPress={send} loading={busy} /> : null}
          </>
        )}
        {msg ? <Text style={{ color: state === 'ok' ? colors.go : state === 'bad' ? colors.bad : colors.ink2, fontWeight: '700' }}>{msg}</Text> : null}

        {state !== 'ok' && !required && onSkip ? (
          <Pressable onPress={onSkip} style={{ alignItems: 'center', padding: 8 }}>
            <Text style={{ fontWeight: '700', color: colors.ink2 }}>稍後再驗證</Text>
          </Pressable>
        ) : null}
        {required ? <Tiny style={{ textAlign: 'center' }}>{session.role === 'driver' ? '驗證後才能送出資格審核與接單。' : '驗證後才能下單。'}</Tiny> : null}
        <Pressable onPress={onSignOut} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.ink3 }}>登出</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  brand: { fontSize: 13, fontWeight: '800', letterSpacing: 1, color: colors.ink2 },
});

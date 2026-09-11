import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  CARRIER_DECLARATION,
  CarrierDoc,
  DEFAULT_CLASSES,
  DOC_LABELS,
  DocKind,
  H1,
  H2,
  Onboarding,
  TW_AREAS,
  Tag,
  Tiny,
  colors,
  pickCargoPhoto,
  showAlert,
  takeCargoPhoto,
} from '@truck/shared';
import { backend, useStore } from '../store';

/**
 * 承運人資格申請：一頁到底、邊填邊存。證件上傳即存到私密空間；文字欄位按「儲存」或「送出審核」時寫入。
 * 審核狀態：draft → submitted（審核中）→ approved / needs_fix（附原因，可補件重送）/ rejected。
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, signOut, refreshSession, setVehicleClass } = useStore();
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [docs, setDocs] = useState<CarrierDoc[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [o, d] = await Promise.all([backend.getOnboarding(), backend.listCarrierDocs()]);
    setOb(o);
    setDocs(d);
    const u: Record<string, string> = {};
    await Promise.all(d.map(async (x) => { const s = await backend.carrierDocUrl(x.storagePath); if (s) u[x.kind] = s; }));
    setUrls(u);
  };
  useEffect(() => {
    load().catch((e) => showAlert('讀取失敗', (e as Error).message));
  }, []);

  if (!ob) return <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top + 20 }}><Tiny style={{ padding: 20 }}>載入中…</Tiny></View>;

  const locked = ob.status === 'submitted' || ob.status === 'approved';
  const patch = (p: Partial<Onboarding>) => setOb({ ...ob, ...p });

  const save = async (silent = false) => {
    setBusy(true);
    try {
      const saved = await backend.saveOnboarding(ob);
      setOb(saved);
      if (!silent) showAlert('已儲存', '資料已存成草稿，隨時可以回來繼續。');
      return true;
    } catch (e) {
      showAlert('儲存失敗', (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!(await save(true))) return;
    setBusy(true);
    try {
      const o = await backend.submitOnboarding();
      setOb(o);
      await refreshSession();
      showAlert('已送出審核', '平台會人工核對證件，通常 1–2 個工作天；通過後就能上線接單。');
    } catch (e) {
      showAlert('還不能送出', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (kind: DocKind, fn: () => Promise<string | null>) => {
    try {
      const uri = await fn();
      if (!uri) return;
      setBusy(true);
      const d = await backend.uploadCarrierDoc(kind, uri);
      setDocs((prev) => [...prev.filter((x) => x.kind !== kind), d]);
      const s = await backend.carrierDocUrl(d.storagePath);
      if (s) setUrls((u) => ({ ...u, [kind]: s }));
    } catch (e) {
      showAlert('上傳失敗', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const Doc = ({ kind }: { kind: DocKind }) => {
    const d = docs.find((x) => x.kind === kind);
    const meta = DOC_LABELS[kind];
    return (
      <View style={s.doc}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontWeight: '700', flex: 1 }}>{meta.title}</Text>
          {d ? <Tag label={d.status === 'approved' ? '已核可' : d.status === 'rejected' ? '退件' : '已上傳'} tone={d.status === 'approved' ? 'go' : d.status === 'rejected' ? 'warn' : 'neutral'} /> : <Tag label="未上傳" tone="warn" />}
        </View>
        {meta.hint ? <Tiny>{meta.hint}</Tiny> : null}
        {d?.note ? <Tiny style={{ color: '#a33' }}>審核備註：{d.note}</Tiny> : null}
        {urls[kind] ? <Image source={{ uri: urls[kind] }} style={s.thumb} resizeMode="contain" /> : null}
        {!locked ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={d ? '重拍' : '拍照'} variant="secondary" small style={{ flex: 1 }} onPress={() => upload(kind, takeCargoPhoto)} disabled={busy} />
            <Button title="從相簿選" variant="secondary" small style={{ flex: 1 }} onPress={() => upload(kind, pickCargoPhoto)} disabled={busy} />
          </View>
        ) : null}
      </View>
    );
  };

  const Chips = <T extends string>({ options, value, onPick, multi }: { options: { id: T; label: string }[]; value: T[] | T | undefined; onPick: (id: T) => void; multi?: boolean }) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = multi ? (value as T[] | undefined)?.includes(o.id) : value === o.id;
        return (
          <Pressable key={o.id} disabled={locked} onPress={() => onPick(o.id)} style={[s.chip, on && s.chipOn]}>
            <Text style={[{ fontWeight: '700', fontSize: 13 }, on && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const Field = ({ label, value, onChange, placeholder, keyboardType }: { label: string; value: string; onChange: (t: string) => void; placeholder?: string; keyboardType?: 'default' | 'numeric' }) => (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} editable={!locked} placeholder={placeholder} placeholderTextColor={colors.ink3} keyboardType={keyboardType} style={[s.input, locked && { color: colors.ink2 }]} />
    </View>
  );

  const statusBanner = () => {
    if (ob.status === 'approved') return <View style={[s.banner, { backgroundColor: colors.goSoft }]}><Text style={{ fontWeight: '800', color: colors.goInk }}>資格已核可，可以上線接單。</Text></View>;
    if (ob.status === 'submitted') return <View style={[s.banner, { backgroundColor: colors.fill }]}><Text style={{ fontWeight: '800' }}>審核中</Text><Tiny>平台正在核對你的證件，通過會通知你。送出後資料鎖定，如需修改請聯絡平台。</Tiny></View>;
    if (ob.status === 'needs_fix') return <View style={[s.banner, { backgroundColor: colors.warnSoft }]}><Text style={{ fontWeight: '800', color: '#7a4b00' }}>需要補件</Text><Tiny>{ob.reviewNote || '請依審核備註補齊後重新送出。'}</Tiny></View>;
    if (ob.status === 'rejected') return <View style={[s.banner, { backgroundColor: '#fde8e8' }]}><Text style={{ fontWeight: '800', color: '#a33' }}>未通過</Text><Tiny>{ob.reviewNote || '不符合平台承運資格。'}</Tiny></View>;
    return <View style={[s.banner, { backgroundColor: colors.fill }]}><Text style={{ fontWeight: '800' }}>完成資格申請才能接單</Text><Tiny>平台只核對「有沒有合法資格」：身分、職業駕照、車籍、營業資格、保險、撥款帳戶。資料只有你和平台看得到。</Tiny></View>;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120, gap: 18 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <H1>承運人資格申請</H1>
          {ob.status === 'approved' ? <Button title="返回" small variant="secondary" onPress={() => router.replace('/')} /> : null}
        </View>
        {statusBanner()}

        <H2>1. 基本資料</H2>
        <Tiny>{session?.name} · {session?.phone} · {session?.email}（在「帳戶」修改）</Tiny>

        <H2>2. 職業駕照</H2>
        <Chips options={[{ id: '大貨車', label: '職業大貨車' }, { id: '聯結車', label: '職業聯結車' }]} value={ob.licenseClass} onPick={(v) => patch({ licenseClass: v as Onboarding['licenseClass'] })} />
        <Field label="駕照到期日（西元 年-月-日）" value={ob.licenseExpiresOn ?? ''} onChange={(t) => patch({ licenseExpiresOn: t.replace(/[^0-9-]/g, '') })} placeholder="2029-05-31" />
        <Doc kind="license" />

        <H2>3. 身分證</H2>
        <Doc kind="id_front" />
        <Doc kind="id_back" />

        <H2>4. 車籍</H2>
        <Tiny>車牌 {session?.vehicle?.plate ?? '—'} · 級距 {DEFAULT_CLASSES.find((k) => k.id === session?.vehicle?.classId)?.name ?? '—'}（級距可在「帳戶」修改）</Tiny>
        <Doc kind="vehicle_reg" />
        <Doc kind="vehicle_front" />
        <Doc kind="vehicle_bed" />

        <H2>5. 營業資格</H2>
        <Tiny>營業用大貨車必須掛在貨運業者名下；請選你的實際情況並提供證明。</Tiny>
        <Chips
          options={[{ id: 'own_operator', label: '自營貨運行' }, { id: 'affiliated', label: '靠行' }, { id: 'employee', label: '受僱於貨運公司' }]}
          value={ob.businessType}
          onPick={(v) => patch({ businessType: v as Onboarding['businessType'] })}
        />
        {ob.businessType ? (
          <>
            <Field label={ob.businessType === 'own_operator' ? '貨運行名稱' : '所屬貨運業者名稱'} value={ob.operatorName} onChange={(t) => patch({ operatorName: t })} placeholder="大同貨運行" />
            <Field label="統一編號" value={ob.operatorTaxId} onChange={(t) => patch({ operatorTaxId: t.replace(/[^0-9]/g, '') })} placeholder="12345678" keyboardType="numeric" />
            <Doc kind={ob.businessType === 'affiliated' ? 'affiliation_proof' : 'business_proof'} />
          </>
        ) : null}

        <H2>6. 保險</H2>
        <Tiny>平台不提供保險；你的保單狀態會讓貨主在媒合時看到。</Tiny>
        <Doc kind="insurance_compulsory" />
        <Doc kind="insurance_liability" />
        <Doc kind="insurance_cargo" />

        <H2>7. 服務區域與貨源</H2>
        <Chips options={TW_AREAS.map((a) => ({ id: a, label: a }))} value={ob.serviceAreas} multi onPick={(a) => patch({ serviceAreas: ob.serviceAreas.includes(a) ? ob.serviceAreas.filter((x) => x !== a) : [...ob.serviceAreas, a] })} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>承接平台第三方貨源</Text>
            <Tiny>關閉的話只會收到你自己車行的單（之後開放）。</Tiny>
          </View>
          <Switch value={ob.acceptExternalLoads} disabled={locked} onValueChange={(v) => patch({ acceptExternalLoads: v })} trackColor={{ true: colors.go, false: colors.fill2 }} />
        </View>

        <H2>8. 撥款帳戶</H2>
        <Tiny>運費由金流直接撥到這個帳戶（平台不經手）。審核通過後啟用，之後可修改。</Tiny>
        <Field label="銀行代碼" value={ob.bankCode} onChange={(t) => patch({ bankCode: t.replace(/[^0-9]/g, '').slice(0, 3) })} placeholder="812" keyboardType="numeric" />
        <Field label="帳號" value={ob.bankAccountNo} onChange={(t) => patch({ bankAccountNo: t.replace(/[^0-9]/g, '') })} placeholder="0001234567890" keyboardType="numeric" />
        <Field label="戶名" value={ob.bankAccountName} onChange={(t) => patch({ bankAccountName: t })} placeholder="與本人或所屬業者一致" />
        <Doc kind="bank_passbook" />

        <H2>9. 聲明與條款</H2>
        <Pressable disabled={locked} onPress={() => patch({ declarationAcceptedAt: ob.declarationAcceptedAt ? undefined : Date.now() })} style={s.check}>
          <Ionicons name={ob.declarationAcceptedAt ? 'checkbox' : 'square-outline'} size={24} color={colors.ink} />
          <Text style={{ flex: 1, fontSize: 13, lineHeight: 20 }}>{CARRIER_DECLARATION}</Text>
        </Pressable>
        <Pressable disabled={locked} onPress={() => patch({ termsAcceptedAt: ob.termsAcceptedAt ? undefined : Date.now() })} style={s.check}>
          <Ionicons name={ob.termsAcceptedAt ? 'checkbox' : 'square-outline'} size={24} color={colors.ink} />
          <Text style={{ flex: 1, fontSize: 13, lineHeight: 20 }}>我已閱讀並同意平台服務條款與運送契約條款範本（v1）。</Text>
        </Pressable>

        <Button title="登出" variant="secondary" small onPress={() => signOut()} />
      </ScrollView>
      {!locked ? (
        <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Button title="儲存草稿" variant="secondary" style={{ flex: 1 }} onPress={() => save()} loading={busy} />
          <Button title="送出審核" style={{ flex: 1 }} onPress={submit} loading={busy} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  banner: { borderRadius: 12, padding: 14, gap: 4 },
  label: { fontSize: 12, fontWeight: '700', color: colors.ink2, letterSpacing: 0.5 },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontWeight: '600' },
  chip: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  doc: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, gap: 8 },
  thumb: { width: '100%', height: 180, borderRadius: 8, backgroundColor: '#111' },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 4 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, flexDirection: 'row', gap: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line },
});

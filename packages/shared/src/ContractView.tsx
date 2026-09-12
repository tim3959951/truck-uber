import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAlert } from './alert';
import type { Backend } from './backend';
import { formatNTD } from './pricing';
import { colors } from './theme';
import type { Contract } from './types';
import { Button, H1, H2, RoundButton, Tag, Tiny } from './ui';

const fmt = (iso?: string | number | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const PAY: Record<string, string> = { sandbox: '線上付款（測試沙盒）', newebpay_credit: '信用卡（藍新金流）', ecpay_credit: '信用卡（綠界）', transfer: '銀行匯款' };

/**
 * 電子運送契約畫面（客戶端與司機端共用）。內容來自伺服器成立時的快照，畫面只負責排版。
 * `me` 決定「我已閱讀」按鈕更新哪一方的確認時間。
 */
export function ContractView({ backend, orderId, me, onBack }: { backend: Backend; orderId: string; me: 'customer' | 'carrier'; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [c, setC] = useState<Contract | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend.getContract(orderId).then(setC).catch(() => setC(null));
  }, [orderId]);

  const ack = async () => {
    if (!c) return;
    setBusy(true);
    try {
      setC(await backend.ackContract(c.id));
    } catch (e) {
      showAlert('無法確認', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <View style={[s.head, { paddingTop: insets.top + 8 }]}>
      <RoundButton glyph="‹" onPress={onBack} />
      <H1>運送契約</H1>
    </View>
  );

  if (c === undefined) return <View style={{ flex: 1, backgroundColor: '#fff' }}>{head}<Tiny style={{ padding: 20 }}>載入中…</Tiny></View>;
  if (c === null)
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        {head}
        <Tiny style={{ padding: 20 }}>這筆訂單尚未成立契約（承運人接單後自動成立）。</Tiny>
      </View>
    );

  const o = c.content.order ?? {};
  const cu = c.content.customer ?? {};
  const ca = c.content.carrier ?? {};
  const drv = ca.driver ?? {};
  const veh = ca.vehicle ?? {};
  const op = ca.operator;
  const myAck = me === 'customer' ? c.customerAckAt : c.carrierAckAt;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {head}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 14 }}>
        <View style={s.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={s.no}>{c.contractNo}</Text>
            <Tag label="已成立" tone="go" />
          </View>
          <Tiny>成立時間 {fmt(c.formedAt)} · 條款版本 v{c.termsVersion} · 訂單 {o.order_no}</Tiny>
          <Tiny>本契約於承運人接單時自動成立，雙方無需另行同意；託運人下單、承運人接單即為同意。Pallo 僅提供媒合、參考價、付款工具與運送追蹤，非契約當事人。</Tiny>
        </View>

        <H2>當事人</H2>
        <Line k="託運人（客戶）" v={`${cu.name ?? ''}${cu.company ? ' · ' + cu.company : ''}`} sub={cu.phone} />
        <Line
          k={c.carrierType === 'operator' ? '承運人（車行）' : '承運人（司機本人）'}
          v={c.carrierType === 'operator' ? `${op?.company_name ?? ''}${op?.tax_id ? ' · 統編 ' + op.tax_id : ''}` : drv.name ?? ''}
          sub={c.carrierType === 'operator' ? `實際駕駛 ${drv.name ?? ''} · ${drv.phone ?? ''}` : drv.phone}
        />
        <Line k="車輛" v={`${veh.plate ?? ''} · ${o.class_name ?? veh.class_id ?? ''}${veh.make_model ? ' · ' + veh.make_model : ''}`} />

        <H2>運送內容</H2>
        <Line k="起運地" v={o.pickup?.name} sub={o.pickup?.addr} />
        <Line k="目的地" v={o.dest?.name} sub={o.dest?.addr} />
        <Line k="車型級距" v={`${o.class_name ?? o.class_id ?? ''} · ${o.tier === 'backhaul' ? '回頭車' : '專車'}`} />
        <Line k="貨物" v={`${o.cargo_type ?? ''}${o.note ? ' · ' + o.note : ''}`} />
        <Line k="數量／重量" v={`${o.load_mode === 'full' ? '整車' + (o.quantity_desc ? ' · ' + o.quantity_desc : '') : (o.pallets ?? 0) + ' 托'}${o.weight_t ? ' · ' + o.weight_t + ' 噸' : ''}`} />
        <Line k="裝卸需求" v={[o.need_tail_lift ? '需升降尾門' : null, o.helpers ? `隨車搬運工 × ${o.helpers}` : null].filter(Boolean).join('、') || '客戶自備堆高機／人員裝卸'} />
        <Line k="預計裝貨時間" v={fmt(o.pickup_at)} />
        <Line k="預計卸貨時間" v={fmt(o.dropoff_at)} sub={`預估里程 ${o.estimated_km ?? '—'} km`} />
        <Line k="運費" v={formatNTD(o.quoted_price ?? 0)} sub="含基本里程費、棧板／整車費與加價項目；明細見訂單" />
        <Line k="付款方式" v={PAY[o.payment_method] ?? o.payment_method ?? '—'} />

        <H2>契約條款</H2>
        <Text style={s.terms}>{c.termsText}</Text>
        <Tiny>內容雜湊 {c.contentHash.slice(0, 16)}… — 成立後任何一方（含平台）都無法修改本契約內容。</Tiny>

        <View style={s.card}>
          <Text style={{ fontWeight: '700' }}>閱讀紀錄（僅作紀錄，不影響契約效力）</Text>
          <Tiny>託運人：{c.customerAckAt ? '已閱讀 ' + fmt(c.customerAckAt) : '尚未開啟'}</Tiny>
          <Tiny>承運人：{c.carrierAckAt ? '已閱讀 ' + fmt(c.carrierAckAt) : '尚未開啟'}</Tiny>
        </View>
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        {myAck ? <Button title={`已於 ${fmt(myAck)} 收到並閱讀`} disabled onPress={() => {}} /> : <Button title="我已收到並閱讀本契約" onPress={ack} loading={busy} />}
      </View>
    </View>
  );
}

function Line({ k, v, sub }: { k: string; v?: string; sub?: string }) {
  return (
    <View style={s.line}>
      <Text style={s.k}>{k}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.v}>{v || '—'}</Text>
        {sub ? <Tiny>{sub}</Tiny> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  card: { backgroundColor: colors.fill, borderRadius: 12, padding: 14, gap: 6 },
  no: { fontWeight: '800', fontSize: 16 },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  k: { width: 96, fontSize: 12, fontWeight: '700', color: colors.ink2, paddingTop: 2 },
  v: { fontSize: 14, fontWeight: '600', color: colors.ink },
  terms: { fontSize: 13, lineHeight: 21, color: colors.ink },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line },
});

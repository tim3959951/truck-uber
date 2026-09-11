import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Backend } from './backend';
import { PLATFORM_TERMS_MD, PLATFORM_TERMS_VERSION } from './platformTerms';
import { colors } from './theme';
import { H1, RoundButton, Tiny } from './ui';

/**
 * 條款全文頁（客戶端與司機端共用）。
 * kind = 'platform'：平台服務條款（隨 App 打包）；kind = 'contract'：運送契約條款範本（從伺服器讀最新版）。
 * 純文字排版：把 Markdown 的 #、**、> 拿掉，段落照原樣顯示，夠讀就好。
 */
export function TermsView({ backend, kind, onBack }: { backend: Backend; kind: 'platform' | 'contract'; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(kind === 'platform' ? '平台服務條款' : '貨物運送契約條款');
  const [version, setVersion] = useState(kind === 'platform' ? PLATFORM_TERMS_VERSION : '');
  const [body, setBody] = useState(kind === 'platform' ? PLATFORM_TERMS_MD : '');

  useEffect(() => {
    if (kind !== 'contract') return;
    backend
      .getContractTerms()
      .then((t) => {
        setTitle(t.title);
        setVersion(String(t.version));
        setBody(t.body);
      })
      .catch((e) => setBody('無法載入條款：' + (e as Error).message));
  }, [kind]);

  const blocks = body
    .split('\n')
    .map((l) => l.replace(/^>\s?/, '').replace(/\*\*/g, ''))
    .filter((l, i, arr) => !(l.trim() === '' && arr[i - 1]?.trim() === ''));

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={[s.head, { paddingTop: insets.top + 8 }]}>
        <RoundButton glyph="‹" onPress={onBack} />
        <View style={{ flex: 1 }}>
          <H1>{title}</H1>
          {version ? <Tiny>版本 v{version}</Tiny> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {blocks.map((l, i) => {
          const h = l.match(/^(#+)\s*(.*)$/);
          if (h) return <Text key={i} style={[s.h, h[1].length === 1 ? s.h1 : s.h2]}>{h[2]}</Text>;
          const bullet = l.match(/^\s*-\s+(.*)$/);
          if (bullet) return <Text key={i} style={s.p}>• {bullet[1]}</Text>;
          return <Text key={i} style={s.p}>{l}</Text>;
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  h: { fontWeight: '800', color: colors.ink, marginTop: 14, marginBottom: 4 },
  h1: { fontSize: 18 },
  h2: { fontSize: 15 },
  p: { fontSize: 13, lineHeight: 21, color: colors.ink, marginBottom: 2 },
});

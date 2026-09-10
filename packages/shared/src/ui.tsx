import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, space } from './theme';
import type { Location } from './types';

/* ---------- Button ---------- */
type BtnVariant = 'primary' | 'secondary' | 'go' | 'danger';
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  small,
}: {
  title: string;
  onPress?: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  small?: boolean;
}) {
  const bg = { primary: colors.ink, secondary: colors.fill, go: colors.go, danger: colors.badSoft }[variant];
  const fg = { primary: '#fff', secondary: colors.ink, go: '#03301b', danger: colors.bad }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

/* ---------- Chip / Tag ---------- */
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, selected && s.chipOn]}>
      <Text style={[s.chipText, selected && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}
export function Tag({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'go' | 'warn' }) {
  const bg = tone === 'go' ? colors.goSoft : tone === 'warn' ? colors.warnSoft : colors.fill;
  const fg = tone === 'go' ? colors.goInk : tone === 'warn' ? '#7a4b00' : colors.ink;
  return (
    <View style={[s.tag, { backgroundColor: bg }]}>
      <Text style={[s.tagText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/* ---------- Typography ---------- */
export const H1 = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.h1, style]}>{children}</Text>
);
export const H2 = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.h2, style]}>{children}</Text>
);
export const Muted = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.muted, style]}>{children}</Text>
);
export const Tiny = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.tiny, style]}>{children}</Text>
);

/* ---------- Bottom sheet (static, Uber-style) ---------- */
export function Sheet({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[s.sheet, style]}>
      <View style={s.handle} />
      {children}
    </View>
  );
}

/* ---------- Route block (pickup ● → drop ■) ---------- */
export function RouteBlock({ pickup, drop }: { pickup: Location; drop: Location }) {
  return (
    <View style={s.route}>
      <View style={s.routeRow}>
        <View style={s.dot} />
        <View style={{ flex: 1 }}>
          <Text style={s.routeName} numberOfLines={1}>{pickup.name}</Text>
          <Text style={s.routeAddr} numberOfLines={1}>{pickup.addr}</Text>
        </View>
      </View>
      <View style={s.routeLine} />
      <View style={s.routeRow}>
        <View style={s.square} />
        <View style={{ flex: 1 }}>
          <Text style={s.routeName} numberOfLines={1}>{drop.name}</Text>
          <Text style={s.routeAddr} numberOfLines={1}>{drop.addr}</Text>
        </View>
      </View>
    </View>
  );
}

/* ---------- Progress bar ---------- */
export function Progress({ value }: { value: number }) {
  return (
    <View style={s.progress}>
      <View style={[s.progressFill, { width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }]} />
    </View>
  );
}

/* ---------- Avatar + plate ---------- */
export function Avatar({ initials, rating, size = 52 }: { initials: string; rating?: number; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={{ fontWeight: '800', fontSize: size * 0.36 }}>{initials}</Text>
      </View>
      {rating != null && (
        <View style={s.star}>
          <Text style={{ fontSize: 10, fontWeight: '800' }}>★ {rating}</Text>
        </View>
      )}
    </View>
  );
}
export function Plate({ plate }: { plate: string }) {
  return (
    <View style={s.plate}>
      <Text style={s.plateText}>{plate}</Text>
    </View>
  );
}

/* ---------- List row ---------- */
export function Row({
  title,
  subtitle,
  right,
  onPress,
  icon,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}>
      {icon ? <View style={s.rowIcon}>{icon}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

/* ---------- Stepper ---------- */
export function Stepper({
  value,
  min,
  max,
  onChange,
  unit,
  hint,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  unit: string;
  hint?: string;
}) {
  return (
    <View style={s.stepper}>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} style={s.stepBtn}>
        <Text style={[s.stepBtnText, value <= min && { opacity: 0.3 }]}>−</Text>
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={s.stepValue}>
          {value} <Text style={{ fontSize: 16 }}>{unit}</Text>
        </Text>
        {hint ? <Text style={s.tiny}>{hint}</Text> : null}
      </View>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} style={s.stepBtn}>
        <Text style={[s.stepBtnText, value >= max && { opacity: 0.3 }]}>+</Text>
      </Pressable>
    </View>
  );
}

/* ---------- Toast ---------- */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={s.toast} pointerEvents="none">
      <Text style={{ color: '#fff', fontWeight: '700' }}>✓  {message}</Text>
    </View>
  );
}

/* ---------- Round icon-ish button (text glyph) ---------- */
export function RoundButton({ glyph, onPress, dark }: { glyph: string; onPress?: () => void; dark?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.round, dark && { backgroundColor: colors.ink }]}>
      <Text style={{ fontSize: 18, fontWeight: '800', color: dark ? '#fff' : colors.ink }}>{glyph}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  btnText: { fontWeight: '800', fontSize: 16 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontWeight: '700', fontSize: 13, color: colors.ink },
  tag: { borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8 },
  tagText: { fontWeight: '700', fontSize: 12 },
  h1: { fontSize: 24, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: '800', color: colors.ink },
  muted: { color: colors.ink2, fontSize: 14 },
  tiny: { color: colors.ink3, fontSize: 12 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: 10,
    paddingBottom: 28,
    gap: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.fill2, alignSelf: 'center', marginBottom: 2 },
  route: { gap: 2 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink, marginLeft: 4 },
  square: { width: 10, height: 10, backgroundColor: colors.ink, marginLeft: 4 },
  routeLine: { width: 2, height: 14, backgroundColor: colors.ink, marginLeft: 8 },
  routeName: { fontWeight: '700', fontSize: 14, color: colors.ink },
  routeAddr: { color: colors.ink2, fontSize: 12 },
  progress: { height: 4, backgroundColor: colors.fill2, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.ink },
  avatar: { backgroundColor: colors.fill2, alignItems: 'center', justifyContent: 'center' },
  star: {
    position: 'absolute',
    bottom: -7,
    backgroundColor: colors.paper,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  plate: { borderWidth: 2, borderColor: colors.ink, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#fff' },
  plateText: { fontWeight: '800', letterSpacing: 1, fontSize: 14, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontWeight: '700', fontSize: 15, color: colors.ink },
  rowSub: { color: colors.ink2, fontSize: 12, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.fill, borderRadius: 12, overflow: 'hidden' },
  stepBtn: { width: 56, height: 64, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 28, fontWeight: '600' },
  stepValue: { fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  toast: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    zIndex: 50,
    backgroundColor: colors.ink,
    borderRadius: 12,
    padding: 13,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
});

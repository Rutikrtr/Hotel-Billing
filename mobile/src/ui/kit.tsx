import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon } from './icons';
import { C, F, shadow } from './theme';
import { useWide } from './wide';
import { isDesktop } from '../desktop';

/** Brand gradient fill behind any box (rounded to the box's own corners). */
let gradientIds = 0;
export function Gradient({ radius = 14 }: { radius?: number }) {
  // Each gradient gets its own id: SVG ids can clash between drawings on Android.
  const [id] = React.useState(() => `g${++gradientIds}`);
  // Android sizes a "100%" SVG before the box is laid out, so draw at the box's measured size.
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden', backgroundColor: C.brand1 }]}
      onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; setSize((s) => (s && s.w === w && s.h === h ? s : { w, h })); }}>
      {size ? (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={C.brand1} />
              <Stop offset="1" stopColor={C.brand2} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={size.w} height={size.h} rx={radius} ry={radius} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

export function T({ style, children, w = 'regular', numberOfLines, adjustsFontSizeToFit }: { style?: StyleProp<TextStyle>; children: React.ReactNode; w?: keyof typeof F; numberOfLines?: number; adjustsFontSizeToFit?: boolean }) {
  return <Text numberOfLines={numberOfLines} adjustsFontSizeToFit={adjustsFontSizeToFit} style={[{ fontFamily: F[w], color: C.text, fontSize: 13.5 }, style]}>{children}</Text>;
}

type Kind = 'primary' | 'secondary' | 'dark' | 'danger' | 'green' | 'red';
export function Button({ title, onPress, kind = 'primary', busy, disabled, style, small, icon }: {
  title: string; onPress: () => void; kind?: Kind; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
  icon?: (p: { color: string; size?: number }) => React.ReactElement;
}) {
  const off = disabled || busy;
  const fg = kind === 'secondary' ? C.text : kind === 'danger' ? C.danger : '#FFFFFF';
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      hitSlop={6}
      style={({ pressed }) => [
        s.btn, small && s.btnSmall,
        kind === 'secondary' && s.btnSecondary, kind === 'dark' && { backgroundColor: C.ink }, kind === 'green' && { backgroundColor: C.free }, kind === 'red' && { backgroundColor: C.danger }, kind === 'danger' && s.btnDanger,
        { opacity: off ? 0.55 : 1, transform: [{ scale: pressed && !off ? 0.97 : 1 }] }, style,
      ]}
    >
      {kind === 'primary' ? <Gradient radius={small ? 10 : 13} /> : null}
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon ? icon({ color: fg, size: small ? 16 : 18 }) : null}
          <T w="bold" style={{ color: fg, fontSize: small ? 13 : 14.5 }}>{title}</T>
        </View>
      )}
    </Pressable>
  );
}

/** Desktop app: marks a frosted-glass surface (the blur itself is CSS, added by the desktop app). */
export const glass = (isDesktop ? { dataSet: { glass: '1' } } : {}) as object;

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View {...glass} style={[s.card, isDesktop && s.cardGlass, style]}>{children}</View>;
}

export function Chip({ label, on, onPress, onLongPress }: { label: string; on?: boolean; onPress: () => void; onLongPress?: () => void }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} hitSlop={6} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      <T w="bold" style={{ fontSize: 12.5, color: on ? '#FFFFFF' : C.text }}>{label}</T>
    </Pressable>
  );
}

export function Diet({ veg }: { veg: boolean }) {
  return (
    <View style={[s.diet, { borderColor: veg ? C.veg : C.nonveg }]}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: veg ? C.veg : C.nonveg }} />
    </View>
  );
}

export const s = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  pageHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingLeft: 24, paddingRight: isDesktop ? 160 : 24, paddingVertical: 10, backgroundColor: isDesktop ? 'rgba(255,255,255,0.45)' : C.bg, borderBottomWidth: 1, borderBottomColor: C.line },
  btn: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: C.brand1 },
  btnSmall: { minHeight: 34, borderRadius: 10, paddingHorizontal: 12 },
  btnSecondary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  btnDanger: { backgroundColor: C.surface, borderWidth: 1, borderColor: '#E9B4B4' },
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 12 },
  cardGlass: { borderRadius: 20, borderColor: 'rgba(255,255,255,0.85)', padding: 16, shadowColor: '#8A4B12', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, justifyContent: 'center', marginRight: 6 },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 12, fontFamily: F.regular, fontSize: 14.5, color: C.text },
  sheet: { backgroundColor: isDesktop ? '#FFF9F2' : C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingTop: 10, maxHeight: '88%' },
  summary: { borderRadius: 18, padding: 12, marginBottom: 12, overflow: 'hidden', backgroundColor: C.brand1 },
  note: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginTop: 6 },
  big: { fontSize: 25, letterSpacing: -0.6, color: '#FFFFFF', fontVariant: ['tabular-nums'], marginTop: 2 },
  stat: { flex: 1, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: '#FFFFFF' },
  clear: { position: 'absolute', right: 10, width: 24, height: 24, borderRadius: 12, backgroundColor: '#A39589', alignItems: 'center', justifyContent: 'center' },
  diet: { width: 13, height: 13, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
});

/** Page title with a small line above it and an optional button on the right (same as the web app). */
export function Header({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
  // Computer: the page title is in the fixed page header (PageHeader); keep only the buttons here.
  if (useWide()) return right ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>{right}</View> : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 4, marginBottom: 10, gap: 10 }}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <T w="heavy" numberOfLines={1} style={{ color: C.accent, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}>{eyebrow}</T> : null}
        <T w="heavy" style={{ fontSize: 21, letterSpacing: -0.4 }}>{title}</T>
      </View>
      {right}
    </View>
  );
}

/**
 * Computer: the fixed header of a page – title and a short line under it on the left, actions on the right.
 * It is also where the desktop window is dragged, and leaves room for the window's own buttons on the right.
 */
export function PageHeader({ title, sub, right, onBack }: { title: string; sub?: string; right?: React.ReactNode; onBack?: () => void }) {
  return (
    <View {...({ dataSet: isDesktop ? { drag: '1', glass: '1' } : { drag: '1' } } as object)} style={s.pageHead}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Settings"
          style={(x) => [s.back, (x as { hovered?: boolean }).hovered && { backgroundColor: C.accentSoft }]}>
          <T w="heavy" style={{ fontSize: 16, color: C.accent }}>←</T>
          <T w="bold" style={{ fontSize: 13, color: C.accent }}>Settings</T>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <T w={isDesktop ? 'light' : 'heavy'} numberOfLines={1} style={{ fontSize: isDesktop ? 28 : 24, letterSpacing: isDesktop ? -0.8 : -0.5 }}>{title}</T>
        {sub ? <T w="semibold" numberOfLines={1} style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>{sub}</T> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 6 }}>
      <T w={isDesktop ? 'semibold' : 'heavy'} style={isDesktop ? { fontSize: 12, flex: 1, color: C.muted, letterSpacing: 1.1, textTransform: 'uppercase' } : { fontSize: 14.5, flex: 1 }}>{children}</T>
      {right}
    </View>
  );
}

export function Field({ label, style, ...p }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 5, flex: (style as ViewStyle | undefined)?.flex }}>
      <T w="semibold" style={{ fontSize: 12.5, color: C.muted }}>{label}</T>
      <TextInput placeholderTextColor="#A89A90" {...p} style={[s.input, style]} />
    </View>
  );
}

export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={{ flex: 1 }}>
        <T w="semibold">{label}</T>
        {hint ? <T style={{ color: C.muted, fontSize: 12 }}>{hint}</T> : null}
      </View>
      <Switch value={value} onValueChange={(v) => { onChange(v); }} trackColor={{ true: C.free, false: '#D6CCC4' }} thumbColor="#FFFFFF" />
    </Pressable>
  );
}

/** A card that slides up from the bottom (forms and confirmations). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(31,22,17,0.45)' }]} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 10 }} />
          <T w="heavy" style={{ fontSize: 19, marginBottom: 12 }}>{title}</T>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={[s.card, { alignItems: 'center', paddingVertical: 28, gap: 6 }]}>
      <T style={{ fontSize: 30 }}>{icon}</T>
      <T style={{ color: C.muted, textAlign: 'center' }}>{text}</T>
    </View>
  );
}

export const initials = (name: string) => name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function Pill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}><T w="bold" style={{ color, fontSize: 11 }}>{label}</T></View>;
}

export interface Stat { value: string | number; label: string; color: string; bg: string }

/**
 * The summary at the top of Tables, Bills and Analytics: one big number, then small coloured tiles.
 * Values are always larger and darker than their labels, and digits keep a fixed width so totals don't jump.
 */
export function SummaryCard({ label, value, note, noteColor, stats, right }: {
  label: string; value: string; note?: string; noteColor?: string; stats: Stat[]; right?: React.ReactNode;
}) {
  return (
    <View style={[s.summary, shadow]}>
      <Gradient radius={18} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <T w="semibold" style={{ color: '#FFFFFF', opacity: 0.9, fontSize: 12 }}>{label}</T>
          <T w="heavy" numberOfLines={1} adjustsFontSizeToFit style={s.big}>{value}</T>
          {note ? <View style={s.note}><T w="bold" style={{ fontSize: 12, color: noteColor ?? C.text }}>{note}</T></View> : null}
        </View>
        {right}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
        {stats.map((x) => (
          <View key={x.label} style={s.stat}>
            <T w="heavy" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 15, color: x.color, fontVariant: ['tabular-nums'] }}>{x.value}</T>
            <T w="semibold" numberOfLines={1} style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{x.label}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Top of the Tables screen: a serving-dish badge, the hotel's name, and today's date. */
export function HotelHeader({ name, subtitle, right }: { name: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 12 }}>
      <View style={{ width: 42, height: 42, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Gradient radius={14} />
        <View><Icon.cloche color="#FFFFFF" size={24} /></View>
      </View>
      <View style={{ flex: 1 }}>
        <T w="heavy" numberOfLines={1} style={{ fontSize: 17, letterSpacing: -0.2 }}>{name}</T>
        <T w="semibold" numberOfLines={1} style={{ fontSize: 12, color: C.muted }}>{subtitle}</T>
      </View>
      {right}
    </View>
  );
}

/** Search box with a ✕ to clear it (shown once there is text, typed or spoken). */
export function SearchBox({ value, onChange, placeholder, style }: { value: string; onChange: (v: string) => void; placeholder: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#A39589"
        style={[style, { paddingRight: 40 }]} accessibilityLabel="Search dishes" returnKeyType="search" />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={10} style={s.clear} accessibilityRole="button" accessibilityLabel="Clear search">
          <T w="heavy" style={{ color: '#FFFFFF', fontSize: 12, lineHeight: 14 }}>✕</T>
        </Pressable>
      ) : null}
    </View>
  );
}

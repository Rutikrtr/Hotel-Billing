import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { C, F } from './theme';

/** Brand gradient fill behind any box (rounded to the box's own corners). */
let gradientIds = 0;
export function Gradient({ radius = 14 }: { radius?: number }) {
  // Each gradient gets its own id: SVG ids can clash between drawings on Android.
  const [id] = React.useState(() => `g${++gradientIds}`);
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={C.brand1} />
          <Stop offset="1" stopColor={C.brand2} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${id})`} />
    </Svg>
  );
}

export function T({ style, children, w = 'regular', numberOfLines }: { style?: StyleProp<TextStyle>; children: React.ReactNode; w?: keyof typeof F; numberOfLines?: number }) {
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: F[w], color: C.text, fontSize: 14 }, style]}>{children}</Text>;
}

type Kind = 'primary' | 'secondary' | 'dark' | 'danger';
export function Button({ title, onPress, kind = 'primary', busy, disabled, style, small }: {
  title: string; onPress: () => void; kind?: Kind; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
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
        kind === 'secondary' && s.btnSecondary, kind === 'dark' && { backgroundColor: C.ink }, kind === 'danger' && s.btnDanger,
        { opacity: off ? 0.55 : 1, transform: [{ scale: pressed && !off ? 0.97 : 1 }] }, style,
      ]}
    >
      {kind === 'primary' ? <Gradient radius={small ? 10 : 13} /> : null}
      {busy ? <ActivityIndicator color={fg} /> : <T w="bold" style={{ color: fg, fontSize: small ? 13 : 15 }}>{title}</T>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      <T w="bold" style={{ fontSize: 13, color: on ? '#FFFFFF' : C.text }}>{label}</T>
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
  btn: { minHeight: 46, borderRadius: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: C.brand1 },
  btnSmall: { minHeight: 36, borderRadius: 10, paddingHorizontal: 12 },
  btnSecondary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  btnDanger: { backgroundColor: C.surface, borderWidth: 1, borderColor: '#E9B4B4' },
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 14 },
  chip: { height: 34, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, justifyContent: 'center', marginRight: 6 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  diet: { width: 13, height: 13, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
});

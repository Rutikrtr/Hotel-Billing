import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
import { FIXTURES, type FixtureKind } from '../types';

/** Android sizes a "100%" SVG before the box is laid out, so draw at the box's measured size. */
function useBox() {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => { const { width: w, height: h } = e.nativeEvent.layout; setBox((b) => (b && b.w === w && b.h === h ? b : { w, h })); };
  return [box, onLayout] as const;
}

/** Floor of a hall: warm paper with a faint dot grid, like an architect's floor plan. */
export function DotFloor() {
  const [box, onLayout] = useBox();
  return (
    <View pointerEvents="none" onLayout={onLayout} style={[StyleSheet.absoluteFill, { borderRadius: 18, overflow: 'hidden', backgroundColor: '#F7F2ED' }]}>
      {box ? <Svg width={box.w} height={box.h}>
        <Defs>
          <Pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse">
            <Circle cx="2" cy="2" r="1.1" fill="#D9CCC0" />
          </Pattern>
          <LinearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FBF7F3" />
            <Stop offset="1" stopColor="#F4EDE6" />
          </LinearGradient>
        </Defs>
        <Rect width={box.w} height={box.h} fill="url(#floor)" />
        <Rect width={box.w} height={box.h} fill="url(#dots)" />
      </Svg> : null}
    </View>
  );
}

const ink = '#FFFFFF';
/** Small line icons for the fixed places on a plan. */
export function FixtureIcon({ kind, size = 22 }: { kind: FixtureKind; size?: number }) {
  const p = { stroke: ink, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 1 ? (   // bill counter: a cash register with a receipt
        <G {...p}>
          <Path d="M8 3h6v4H8z" /><Path d="M10 5h2" />
          <Path d="M4 11h16l-1.5-4h-13z" />
          <Rect x="3" y="11" width="18" height="8" rx="1.5" />
          <Path d="M7 14h2M11 14h2M15 14h2M7 16.5h10" />
        </G>
      ) : kind === 2 ? (   // kitchen: chef's hat
        <G {...p}>
          <Path d="M7 18h10v-4.2a4 4 0 1 0-2.5-6.9 4 4 0 0 0-5 0A4 4 0 1 0 7 13.8z" />
          <Line x1="7" y1="21" x2="17" y2="21" />
        </G>
      ) : kind === 3 ? (   // entrance: open door with arrow
        <G {...p}>
          <Path d="M14 3h5v18h-5" />
          <Path d="M3 12h10M10 8.5 13.5 12 10 15.5" />
        </G>
      ) : (   // washroom
        <G {...p}>
          <Circle cx="7.5" cy="5" r="1.8" /><Circle cx="16.5" cy="5" r="1.8" />
          <Path d="M5.5 21v-6H4.5l1-6h4l1 6h-1v6M14.5 21v-7.5H14V9h5v4.5h-.5V21" />
          <Line x1="12" y1="3" x2="12" y2="21" />
        </G>
      )}
    </Svg>
  );
}

const TONES: Record<FixtureKind, [string, string]> = {
  1: ['#3F2E25', '#6B4A38'],   // counter: dark wood
  2: ['#1F4E46', '#2F7366'],   // kitchen: deep green
  3: ['#2B3A55', '#41557A'],   // entrance: slate blue
  4: ['#4B4453', '#6A6274'],   // washroom: grey violet
};

/** A fixed place on the plan (bill counter, kitchen…): a coloured block with a stripe texture and its icon only (the name is for screen readers). */
export function FixtureBlock({ kind, compact }: { kind: FixtureKind; compact?: boolean }) {
  const [a, b] = TONES[kind];
  const id = `fx${kind}`;
  const [box, onLayout] = useBox();
  return (
    <View onLayout={onLayout} style={{ flex: 1, alignSelf: 'stretch', backgroundColor: a, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', padding: 4 }} accessible accessibilityLabel={FIXTURES[kind]}>
      {box ? <Svg style={StyleSheet.absoluteFill} width={box.w} height={box.h}>
        <Defs>
          <LinearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={a} /><Stop offset="1" stopColor={b} />
          </LinearGradient>
          <Pattern id={`${id}s`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Line x1="0" y1="0" x2="0" y2="10" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="4" />
          </Pattern>
        </Defs>
        <Rect width={box.w} height={box.h} fill={`url(#${id}g)`} />
        <Rect width={box.w} height={box.h} fill={`url(#${id}s)`} />
      </Svg> : null}
      <View style={{ width: compact ? 36 : 46, height: compact ? 36 : 46, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
        <FixtureIcon kind={kind} size={compact ? 20 : 25} />
      </View>
    </View>
  );
}

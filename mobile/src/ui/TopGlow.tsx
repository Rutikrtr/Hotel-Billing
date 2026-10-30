import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useWide } from './wide';
import { isDesktop } from '../desktop';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * Soft orange wash at the top of the app that fades into the page, with a faint dine-in drawing
 * (plate, cutlery, a steaming bowl) behind the page title. Drawn, not a photo, so it stays sharp and light.
 */
export default function TopGlow() {
  if (isDesktop) return null;   // desktop app: clean pages under a fixed header
  // The drawing is 400 × 300; on wide screens (tablet, computer) it grows with the width so it is never cut off.
  const { width } = useWindowDimensions();
  // Computer (full-width pages): the wash spans the page and the drawing sits at its normal size on the right.
  const wide = useWide();
  const h = wide ? 320 : Math.max(300, Math.round(Math.min(width, 640) * 0.75));   // 640: the app column's width on tablets
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { height: h }]}>
      {wide ? (
        <Svg style={StyleSheet.absoluteFill} width="100%" height={h} viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="washWide" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFD9C2" stopOpacity="0.9" />
              <Stop offset="0.55" stopColor="#FFE9DC" stopOpacity="0.5" />
              <Stop offset="1" stopColor="#FAF6F2" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill="url(#washWide)" />
        </Svg>
      ) : null}
      <Svg width="100%" height={h} viewBox="0 0 400 300" preserveAspectRatio={wide ? 'xMaxYMin meet' : 'xMidYMin slice'}>
        <Defs>
          <LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFD9C2" stopOpacity="0.95" />
            <Stop offset="0.55" stopColor="#FFE9DC" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#FAF6F2" stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFB98F" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#FFB98F" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="rose" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#F9A8C0" stopOpacity="0.28" />
            <Stop offset="1" stopColor="#F9A8C0" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {wide ? null : <Rect x="0" y="0" width="400" height="300" fill="url(#wash)" />}
        {/* two soft light spots for depth */}
        <Circle cx="40" cy="20" r="120" fill="url(#sun)" />
        <Circle cx="380" cy="150" r="110" fill="url(#rose)" />
        {/* a gentle wave and a few spice dots */}
        <Path d="M0 176 C 70 150, 130 196, 200 172 S 330 150, 400 170" stroke="#E8743B" strokeWidth="1.4" fill="none" opacity="0.10" />
        <Path d="M0 188 C 80 166, 140 206, 210 184 S 330 166, 400 182" stroke="#E8743B" strokeWidth="1" fill="none" opacity="0.06" />
        <G fill="#E8743B" opacity="0.13">
          <Circle cx="182" cy="30" r="2.2" /><Circle cx="196" cy="20" r="1.4" /><Circle cx="170" cy="16" r="1.2" />
          <Circle cx="250" cy="150" r="1.8" /><Circle cx="236" cy="160" r="1.2" /><Circle cx="388" cy="118" r="1.6" />
        </G>
        {/* leaf sprig under the plate */}
        <G transform="translate(300 128) rotate(-18)" stroke="#16A34A" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.10">
          <Path d="M0 0 C 18 -2, 36 4, 52 14" />
          <Path d="M12 0 c 2 -10 10 -14 18 -14 c -2 8 -8 13 -18 14z" />
          <Path d="M26 4 c 6 -9 15 -11 22 -9 c -4 7 -12 11 -22 9z" />
          <Path d="M18 3 c -6 8 -4 16 2 20 c 4 -6 4 -14 -2 -20z" />
        </G>
        <G transform="translate(20 6)" stroke="#C2410C" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.08">
          {/* plate with fork and knife */}
          <Circle cx="318" cy="62" r="42" />
          <Circle cx="318" cy="62" r="29" />
          <Path d="M262 24v24a8 8 0 0 0 8 8v52M270 24v20M278 24v24a8 8 0 0 1-8 8" />
          <Path d="M372 24c-9 6-12 20-12 34h9v50" />
          {/* steaming bowl */}
          <Path d="M196 96h64a32 32 0 0 1-64 0z" />
          <Path d="M210 128h36" />
          <Path d="M214 84c-6-8 6-12 0-20M228 84c-6-8 6-12 0-20M242 84c-6-8 6-12 0-20" />
        </G>
      </Svg>
    </View>
  );
}

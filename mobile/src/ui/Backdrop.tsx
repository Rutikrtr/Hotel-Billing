import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, G, Line, Mask, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * Desktop app: the page behind the cards – light grey with soft blurred glows (peach top right and bottom
 * left, a hint of blue), a faint grid fading out from the top right, and thin orange wave lines at the bottom.
 */
export default function Backdrop() {
  const glow = (id: string, color: string, opacity: number) => (
    <RadialGradient id={id} cx="0.5" cy="0.5" r="0.5">
      <Stop offset="0" stopColor={color} stopOpacity={opacity} />
      <Stop offset="1" stopColor={color} stopOpacity="0" />
    </RadialGradient>
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <Defs>
          {glow('bgA', '#FF8A3D', 0.32)}
          {glow('bgB', '#FFBE8C', 0.34)}
          {glow('bgC', '#8CA0FF', 0.14)}
          {glow('bgFade', '#FFFFFF', 1)}
          <Pattern id="bgGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <Line x1="0" y1="0" x2="40" y2="0" stroke="#101014" strokeOpacity="0.05" strokeWidth="1" />
            <Line x1="0" y1="0" x2="0" y2="40" stroke="#101014" strokeOpacity="0.05" strokeWidth="1" />
          </Pattern>
          <Mask id="bgGridMask">
            <Rect x="500" y="-450" width="1400" height="1100" fill="url(#bgFade)" />
          </Mask>
        </Defs>
        <Rect width="1600" height="1000" fill="#F6F6F8" />
        <Rect width="1600" height="1000" fill="url(#bgGrid)" mask="url(#bgGridMask)" />
        <Rect x="1080" y="-420" width="760" height="760" fill="url(#bgA)" />
        <Rect x="80" y="560" width="760" height="760" fill="url(#bgB)" />
        <Rect x="900" y="560" width="620" height="620" fill="url(#bgC)" />
        <G fill="none" stroke="#E8590C" strokeOpacity="0.16" strokeWidth="1.2">
          {Array.from({ length: 6 }, (_, i) => (
            <Path key={i} d={`M -20 ${860 + i * 22} C 380 ${700 + i * 22}, 700 ${1000 + i * 22}, 1100 ${800 + i * 22} S 1560 ${660 + i * 22}, 1640 ${720 + i * 22}`} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

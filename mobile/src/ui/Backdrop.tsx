import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * Desktop app: the warm backdrop behind the frosted panels – a peach-orange wash, soft orange glows and
 * fine flowing ribbon lines in the corners (after the owner's reference design).
 */
export default function Backdrop() {
  const ribbon = (key: string, transform: string, n: number, opacity: number) => (
    <G key={key} transform={transform} opacity={opacity} fill="none" stroke="#E8893A" strokeWidth={1.4}>
      {Array.from({ length: n }, (_, i) => (
        <Path key={i} d={`M ${-200 + i * 14} 900 C ${80 + i * 10} 620, ${-60 + i * 12} 360, ${260 + i * 16} 80`} />
      ))}
    </G>
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="bdWash" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F9E3CC" />
            <Stop offset="0.5" stopColor="#F6D6B5" />
            <Stop offset="1" stopColor="#F3C79D" />
          </LinearGradient>
          <RadialGradient id="bdGlowA" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFB35C" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#FFB35C" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="bdGlowB" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#F28B4B" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#F28B4B" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="bdGlowC" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFF4E6" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#FFF4E6" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="1600" height="1000" fill="url(#bdWash)" />
        <Rect x="-250" y="-250" width="900" height="900" fill="url(#bdGlowB)" />
        <Rect x="1050" y="450" width="900" height="900" fill="url(#bdGlowA)" />
        <Rect x="500" y="200" width="900" height="700" fill="url(#bdGlowC)" />
        {ribbon('tl', 'translate(-120 -260) rotate(-8)', 34, 0.22)}
        {ribbon('br', 'translate(1180 260) rotate(14)', 34, 0.2)}
        {ribbon('bl', 'translate(60 380) rotate(28) scale(0.8)', 26, 0.14)}
      </Svg>
    </View>
  );
}

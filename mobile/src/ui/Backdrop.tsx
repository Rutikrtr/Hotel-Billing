import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

/**
 * Desktop app: the page behind the cards (Tracebit style) – warm off-white with faint geometric line art:
 * rings from the top right corner and a few long diagonal lines across the bottom.
 */
export default function Backdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <Rect width="1600" height="1000" fill="#F3EFEC" />
        <G fill="none" stroke="#BC4725" strokeOpacity="0.10" strokeWidth="1">
          {[150, 240, 330, 420, 510].map((r) => <Circle key={r} cx="1500" cy="40" r={r} />)}
          {[0, 34, 68].map((d) => <Path key={d} d={`M 250 ${940 + d} L 1600 ${720 + d}`} />)}
        </G>
      </Svg>
    </View>
  );
}

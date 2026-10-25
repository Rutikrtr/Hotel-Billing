import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * Soft orange wash at the top of the app that fades into the page, with a faint dine-in drawing
 * (plate, cutlery, a steaming bowl) behind the page title. Drawn, not a photo, so it stays sharp and light.
 */
export default function TopGlow() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { height: 300 }]}>
      <Svg width="100%" height="300" viewBox="0 0 400 300" preserveAspectRatio="xMidYMin slice">
        <Defs>
          <LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFD9C2" stopOpacity="0.95" />
            <Stop offset="0.55" stopColor="#FFE9DC" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#FAF6F2" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="400" height="300" fill="url(#wash)" />
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

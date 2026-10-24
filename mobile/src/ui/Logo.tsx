import React from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

/** Techyverve logo (same drawing as the web app). */
export function Logo({ size = 64, color }: { size?: number; color?: string }) {
  const paint = color ?? 'url(#tv)';
  return (
    <Svg width={size * 0.98} height={size} viewBox="120 370 784 800">
      <Defs>
        <LinearGradient id="tv" gradientUnits="userSpaceOnUse" x1="120" y1="370" x2="904" y2="1170">
          <Stop offset="0" stopColor="#E8590C" />
          <Stop offset="1" stopColor="#C2255C" />
        </LinearGradient>
      </Defs>
      <G fill="none" stroke={paint} strokeWidth={36} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M512 470V1022" />
        <Path d="M236 486 512 664 788 486" />
        <Path d="M288 640 410 722Q424 732 424 750V922" />
        <Path d="M736 640 614 722Q600 732 600 750V988L556 1036" />
        <Circle cx={198} cy={461} r={43} strokeWidth={30} />
        <Circle cx={826} cy={461} r={43} strokeWidth={30} />
        <Circle cx={253} cy={620} r={39} strokeWidth={32} />
        <Circle cx={771} cy={620} r={39} strokeWidth={32} />
        <Circle cx={512} cy={1080} r={46} strokeWidth={32} />
      </G>
      <Circle cx={512} cy={437} r={49} fill={paint} />
    </Svg>
  );
}

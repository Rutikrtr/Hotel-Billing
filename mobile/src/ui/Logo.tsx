import React from 'react';
import { Image } from 'react-native';

const LOGO = require('../../assets/logo.png');

/** The Master Bill app logo (the same picture as the app icon and the start screen). */
export function Logo({ size = 72 }: { size?: number }) {
  return <Image source={LOGO} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel="Master Bill" />;
}

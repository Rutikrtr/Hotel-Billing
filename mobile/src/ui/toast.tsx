import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useWide } from './wide';
import { T } from './kit';
import { C } from './theme';

type Msg = { text: string; error?: boolean; id: number };
let push: (m: Msg) => void = () => {};
let n = 0;
/** Short message at the bottom of the screen (no buttons, disappears by itself). */
export const toast = (text: string, error = false) => push({ text, error, id: ++n });

export function ToastHost() {
  const wide = useWide();
  const [msg, setMsg] = useState<Msg | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    push = (m) => {
      setMsg(m);
      Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      clearTimeout(timer);
      timer = setTimeout(() => Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setMsg(null)), m.error ? 4500 : 2600);
    };
    return () => clearTimeout(timer);
  }, [fade]);
  if (!msg) return null;
  // A small pill: centred above the bottom bar on phones, in the bottom-right corner on computers.
  return (
    <Animated.View pointerEvents="none" style={[st.box, wide && st.boxWide, {
      opacity: fade, backgroundColor: msg.error ? C.danger : C.ink,
      transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
    }]}>
      <View style={[st.icon, { backgroundColor: msg.error ? 'rgba(255,255,255,0.22)' : C.free }]}>
        <T w="heavy" style={{ color: '#FFFFFF', fontSize: 11 }}>{msg.error ? '!' : '✓'}</T>
      </View>
      <T w="semibold" style={{ color: '#FFFFFF', fontSize: 13, flexShrink: 1 }}>{msg.text}</T>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  box: { position: 'absolute', bottom: 96, alignSelf: 'center', maxWidth: '88%', flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 999, paddingVertical: 9, paddingLeft: 10, paddingRight: 16, elevation: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  boxWide: { bottom: 24, right: 24, alignSelf: 'auto', maxWidth: 420 },
  icon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});

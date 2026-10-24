import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { T } from './kit';
import { C } from './theme';

type Msg = { text: string; error?: boolean; id: number };
let push: (m: Msg) => void = () => {};
let n = 0;
/** Short message at the bottom of the screen (no buttons, disappears by itself). */
export const toast = (text: string, error = false) => push({ text, error, id: ++n });

export function ToastHost() {
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
  return (
    <Animated.View pointerEvents="none" style={[st.box, { opacity: fade, backgroundColor: msg.error ? C.danger : C.ink }]}>
      <T w="bold" style={{ color: '#FFFFFF', textAlign: 'center' }}>{msg.text}</T>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  box: { position: 'absolute', left: 16, right: 16, bottom: 90, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, elevation: 8 },
});

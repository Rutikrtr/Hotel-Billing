import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { T } from './kit';
import { TechyverveLogo } from './TechyverveLogo';
import { C } from './theme';

// The phone's own start screen shows the Techyverve logo 200 px wide image with the logo filling 39% of it.
const LOGO = 78;

/**
 * Techyverve start animation. It begins exactly like the phone's start screen (same logo, same place),
 * then the logo breathes and the names rise in; when the app is ready the whole screen fades away.
 */
export function StartScreen({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const words = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;
  const shown = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.timing(words, { toValue: 1, duration: 520, delay: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start(() => { shown.current = true; if (ready) leave(); });
  }, []);
  useEffect(() => { if (ready && shown.current) leave(); }, [ready]);
  // Never longer than 4 s, even with a very slow phone or network.
  useEffect(() => { const t = setTimeout(leave, 4000); return () => clearTimeout(t); }, []);

  const leaving = useRef(false);
  function leave() {
    if (leaving.current) return;
    leaving.current = true;
    Animated.timing(out, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(onDone);
  }

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const rise = words.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.wrap, { opacity: out }]}>
      <Animated.View style={{ transform: [{ scale }] }}><TechyverveLogo size={LOGO} /></Animated.View>
      <View style={st.words}>
        <Animated.View style={{ opacity: words, transform: [{ translateY: rise }], alignItems: 'center' }}>
          <T w="heavy" style={st.brand}>TECHYVERVE</T>
          <T w="semibold" style={st.app}>Master Bill</T>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  words: { position: 'absolute', top: '50%', marginTop: LOGO / 2 + 22 },
  brand: { fontSize: 15, letterSpacing: 5, color: C.accent },
  app: { fontSize: 13, color: C.muted, marginTop: 4, letterSpacing: 0.5 },
});

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, T } from './kit';
import { C } from './theme';

export interface AskButton { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }
type Tone = 'info' | 'danger';
type Req = { title: string; message?: string; buttons: AskButton[]; extra?: React.ReactNode; tone?: Tone; id: number };
let push: (r: Req | null) => void = () => {};
let n = 0;

/**
 * In-app popup in the Master Bill style (same shape as Alert.alert): a title, a short message and
 * full-width buttons. A 'destructive' button is red; 'cancel' is the quiet one at the bottom.
 * `extra` can hold custom controls (e.g. size chips) between the message and the buttons.
 */
export const ask = (title: string, message?: string, buttons: AskButton[] = [{ text: 'OK' }], extra?: React.ReactNode, tone?: Tone) =>
  push({ title, message, buttons: buttons.length ? buttons : [{ text: 'OK' }], extra, tone, id: ++n });
/** Close the popup (for custom controls in `extra`). */
export const closeAsk = () => push(null);

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    push = (r) => {
      if (r) { setReq(r); anim.setValue(0); Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 90 }).start(); }
      else Animated.timing(anim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => setReq(null));
    };
  }, [anim]);
  if (!req) return null;
  const tone: Tone = req.tone ?? (req.buttons.some((b) => b.style === 'destructive') ? 'danger' : 'info');
  const cancel = req.buttons.find((b) => b.style === 'cancel');
  const actions = req.buttons.filter((b) => b !== cancel);
  const tap = (b?: AskButton) => { closeAsk(); setTimeout(() => b?.onPress?.(), 130); };
  const lastPlain = [...actions].reverse().find((b) => b.style !== 'destructive');
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => tap(cancel)} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, st.dim, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => tap(cancel)} accessibilityLabel="Close" />
      </Animated.View>
      <View style={st.center} pointerEvents="box-none">
        <Animated.View accessibilityViewIsModal style={[st.card, { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
          <View style={[st.badge, { backgroundColor: tone === 'danger' ? C.dangerSoft : C.accentSoft }]}>
            <T w="heavy" style={{ fontSize: 20, color: tone === 'danger' ? C.danger : C.accent }}>{tone === 'danger' ? '!' : 'i'}</T>
          </View>
          <T w="heavy" style={{ fontSize: 18, textAlign: 'center' }}>{req.title}</T>
          {req.message ? <T style={{ color: C.muted, textAlign: 'center', lineHeight: 20 }}>{req.message}</T> : null}
          {req.extra}
          <View style={{ gap: 8, alignSelf: 'stretch', marginTop: 6 }}>
            {actions.map((b) => (
              <Button key={b.text} title={b.text} onPress={() => tap(b)}
                kind={b.style === 'destructive' ? 'red' : b === lastPlain ? 'primary' : 'secondary'} />
            ))}
            {cancel ? (
              <Pressable onPress={() => tap(cancel)} hitSlop={6} style={({ pressed }) => [st.cancel, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <T w="bold" style={{ color: C.muted }}>{cancel.text}</T>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  dim: { backgroundColor: 'rgba(31,22,17,0.5)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: C.surface, borderRadius: 24, padding: 22, paddingTop: 20, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  cancel: { alignItems: 'center', paddingVertical: 10 },
});

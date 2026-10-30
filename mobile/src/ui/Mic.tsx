import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import React, { useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { isDesktop } from '../desktop';
import { useAppSelector } from '../store';
import Svg, { Path } from 'react-native-svg';
import { C } from './theme';
import { toast } from './toast';

/**
 * Mic for the dish search: the waiter says "chicken biryani" and the words go into the search box.
 * Uses the phone's own speech recognition in Indian English. Hidden when switched off in Settings.
 */
export function MicButton({ onText, hints }: { onText: (text: string) => void; hints?: string[] }) {
  const enabled = useAppSelector((s) => s.printer.voice !== false);
  const [listening, setListening] = useState(false);
  const mine = useRef(false);   // several screens have a mic; only the one tapped takes the words
  const pulse = useRef(new Animated.Value(0)).current;

  useSpeechRecognitionEvent('result', (e) => { if (mine.current) onText(e.results[0]?.transcript ?? ''); });
  useSpeechRecognitionEvent('end', () => { if (mine.current) { mine.current = false; setListening(false); pulse.stopAnimation(); } });
  useSpeechRecognitionEvent('error', (e) => {
    if (!mine.current) return;
    mine.current = false; setListening(false); pulse.stopAnimation();
    if (e.error === 'no-speech' || e.error === 'speech-timeout') toast('Didn’t hear anything. Tap the mic and say the dish name.', true);
    else if (e.error !== 'aborted') toast(`Voice search: ${e.message || e.error}`, true);
  });

  // Desktop app: speech recognition is not available there.
  if (!enabled || isDesktop) return null;
  const start = async () => {
    if (listening) { ExpoSpeechRecognitionModule.stop(); return; }
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) { toast('Allow the microphone for Master Bill in phone Settings to use voice search.', true); return; }
      mine.current = true;
      setListening(true);
      Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true })).start();
      ExpoSpeechRecognitionModule.start({
        lang: 'en-IN', interimResults: true, maxAlternatives: 1, continuous: false,
        contextualStrings: hints?.slice(0, 100),
        androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1200 },
      });
    } catch (err) { mine.current = false; setListening(false); toast((err as Error).message, true); }
  };

  return (
    <Pressable onPress={start} hitSlop={8} style={[st.btn, listening && { backgroundColor: C.accent }]} accessibilityRole="button" accessibilityLabel={listening ? 'Stop listening' : 'Search by voice'}>
      {listening ? <Animated.View style={[st.ring, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }] }]} /> : null}
      <Svg width={20} height={20} viewBox="0 0 24 24" fill={listening ? '#FFFFFF' : C.accent}>
        <Path d="M12 2.5a3.5 3.5 0 0 0-3.5 3.5v6a3.5 3.5 0 0 0 7 0V6A3.5 3.5 0 0 0 12 2.5zM6 11.5h-2a8 8 0 0 0 7 7.9V22h2v-2.6a8 8 0 0 0 7-7.9h-2a6 6 0 0 1-12 0z" />
      </Svg>
    </Pressable>
  );
}

const st = StyleSheet.create({
  btn: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 42, height: 42, borderRadius: 12, backgroundColor: C.accent },
});

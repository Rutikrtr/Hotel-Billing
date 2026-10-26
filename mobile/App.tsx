import { Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, Text, View, Platform, UIManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import Root from './src/Root';
import { restoreFromPhone, store } from './src/store';
import { start } from './src/store/auth';
import { C } from './src/ui/theme';
import { DialogHost } from './src/ui/dialog';
import { ToastHost } from './src/ui/toast';

// Smooth show/hide of parts of a screen (e.g. the floor plan switch) on Android.
if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

/** If anything fails while drawing, show the error instead of a frozen screen (so it can be reported and fixed). */
class Guard extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: C.text }}>Something went wrong</Text>
        <Text style={{ marginTop: 8, color: C.muted }}>Please send a screenshot of this screen to Techyverve, then close and reopen the app.</Text>
        <Text selectable style={{ marginTop: 16, color: C.danger }}>{String(this.state.error?.message ?? this.state.error)}</Text>
      </ScrollView>
    );
  }
}

// Keep the start screen (logo) until the app has drawn its first screen, then fade it out smoothly.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 250 });

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const [fontWait, setFontWait] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Never wait more than 3 s for the font: fall back to the phone's font.
    const t = setTimeout(() => setFontWait(false), 3000);
    // Safety net: the start screen never stays longer than 3 s, whatever happens.
    const s = setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, 3000);
    // Unsaved orders and printer choices first, then the login.
    restoreFromPhone().catch(() => {}).finally(() => { store.dispatch(start()); setReady(true); });
    return () => { clearTimeout(t); clearTimeout(s); };
  }, []);
  const fontsReady = fontsLoaded || !!fontError || !fontWait;
  // Keep the phone's Techyverve start screen until the first real screen (login or tables) can be drawn,
  // then fade it out once. Nothing else is shown in between, so there is no second screen or jump.
  const authKnown = useSyncExternalStore(store.subscribe, () => store.getState().auth.status !== 'starting');
  const appReady = fontsReady && ready && authKnown;
  useEffect(() => { if (appReady) SplashScreen.hideAsync().catch(() => {}); }, [appReady]);
  return (
    <Guard>
      <Provider store={store}>
        <SafeAreaProvider style={{ backgroundColor: C.bg }}>
          <View style={{ flex: 1 }}>
            <StatusBar style="dark" translucent backgroundColor="transparent" />
            {fontsReady && ready ? (
              <View style={{ flex: 1 }}>
                <Root />
                <ToastHost />
                <DialogHost />
              </View>
            ) : <View style={{ flex: 1 }} />}
          </View>
        </SafeAreaProvider>
      </Provider>
    </Guard>
  );
}

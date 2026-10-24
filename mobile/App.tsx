import {
  PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import Root from './src/Root';
import { restoreFromPhone, store } from './src/store';
import { start } from './src/store/auth';
import { C } from './src/ui/theme';
import { ToastHost } from './src/ui/toast';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [fonts] = useFonts({ PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Unsaved orders and printer choices first, then the login.
    restoreFromPhone().finally(() => { store.dispatch(start()); setReady(true); });
  }, []);
  useEffect(() => { if (fonts && ready) SplashScreen.hideAsync().catch(() => {}); }, [fonts, ready]);
  if (!fonts || !ready) return null;
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
          <StatusBar style="dark" />
          <View style={{ flex: 1 }}>
            <Root />
            <ToastHost />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Provider>
  );
}

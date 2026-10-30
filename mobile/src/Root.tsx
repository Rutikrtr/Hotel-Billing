import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { warmUp } from './printing/ble';
import AnalyticsScreen from './screens/AnalyticsScreen';
import RoomsScreen from './screens/RoomsScreen';
import StayScreen from './screens/StayScreen';
import BillScreen from './screens/BillScreen';
import BillsScreen from './screens/BillsScreen';
import LoginScreen from './screens/LoginScreen';
import MenuScreen from './screens/MenuScreen';
import OrderScreen from './screens/OrderScreen';
import PrinterScreen from './screens/PrinterScreen';
import SettingsScreen from './screens/SettingsScreen';
import TablesScreen from './screens/TablesScreen';
import { store, useAppDispatch, useAppSelector } from './store';
import { recheck, signOut } from './store/auth';
import { loadAll, refreshOrders, resetData, syncIfChanged } from './store/data';
import { sb } from './supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, T } from './ui/kit';
import { Icon } from './ui/icons';
import { TechyverveLogo } from './ui/TechyverveLogo';
import TabBar from './ui/TabBar';
import TopGlow from './ui/TopGlow';
import { useWide } from './ui/wide';
import { C, F } from './ui/theme';

export type Stack = {
  Main: undefined;
  Order: { tableId?: number; section?: string; parcelId?: number | null };
  Printer: undefined;
  Bill: { orderId: number; parcel?: boolean };
  Stay: { stayId: number };
  Bills: undefined;
  Analytics: undefined;
};
const S = createNativeStackNavigator<Stack>();
const Tab = createBottomTabNavigator();

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: C.bg, primary: C.accent, card: C.surface, text: C.text, border: C.line } };

/** Each tab draws on its own page background with the soft orange glow at the top. */
// The glow also runs under the phone's status bar, so the top of the screen is one smooth colour.
// On a computer (wide): pages get a comfortable reading width (Tables uses the full width); Bills and
// Analytics, which have no heading of their own there, get a page title.
const glow = (Screen: React.ComponentType, title?: string, full = false) => function Glowing() {
  const insets = useSafeAreaInsets();
  const wide = useWide();
  if (wide) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopGlow />
        <View style={{ flex: 1, width: '100%', maxWidth: full ? undefined : 1080, alignSelf: 'center' }}>
          {title ? <T w="heavy" style={{ fontSize: 26, letterSpacing: -0.5, paddingHorizontal: 12, paddingTop: 22, paddingBottom: 4 }}>{title}</T> : null}
          <Screen />
        </View>
      </View>
    );
  }
  return <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}><TopGlow /><Screen /></View>;
};
const G = {
  Rooms: glow(RoomsScreen), Tables: glow(TablesScreen, undefined, true), Menu: glow(MenuScreen), Settings: glow(SettingsScreen),
  Bills: glow(BillsScreen, 'Bills'), Analytics: glow(AnalyticsScreen, 'Analytics'),
};

function Tabs() {
  const account = useAppSelector((s) => s.auth.account);
  const feat = (k: string) => account?.features?.[k] === true;
  const bill = account?.can_bill === true;
  const owner = account?.role === 'owner';
  const wide = useWide();
  return (
    <Tab.Navigator tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg }, tabBarPosition: wide ? 'left' : 'bottom' }}>
      {feat('tables') || !feat('rooms') ? <Tab.Screen name="Tables" component={G.Tables} options={{ tabBarIcon: Icon.tables }} /> : null}
      {bill && feat('rooms') ? <Tab.Screen name="Rooms" component={G.Rooms} options={{ tabBarIcon: Icon.tables }} /> : null}
      {owner ? <Tab.Screen name="Menu" component={G.Menu} options={{ tabBarIcon: Icon.menu }} /> : null}
      {/* Computer: Bills and Analytics sit in the sidebar (on phones they open from Settings). */}
      {wide && bill ? <Tab.Screen name="Bills" component={G.Bills} /> : null}
      {wide && bill && feat('trending') ? <Tab.Screen name="Analytics" component={G.Analytics} /> : null}
      <Tab.Screen name="Settings" component={G.Settings} options={{ tabBarIcon: Icon.settings }} />
    </Tab.Navigator>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>{children}</View>;
}

/** While signed in: live order updates from other phones (one small message per change), and a refresh on return. */
function useLive(enabled: boolean) {
  const dispatch = useAppDispatch();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!enabled) return;
    const later = () => { clearTimeout(timer.current); timer.current = setTimeout(() => dispatch(refreshOrders()), 300); };
    const channel = sb.channel('orders-live').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, later).subscribe();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { dispatch(recheck()); dispatch(syncIfChanged()); later(); }
    });
    return () => { clearTimeout(timer.current); sub.remove(); sb.removeChannel(channel); };
  }, [enabled]);
}

export default function Root() {
  const dispatch = useAppDispatch();
  const { status, account } = useAppSelector((s) => s.auth);
  const loaded = useAppSelector((s) => s.data.loadedAt > 0);
  const loadError = useAppSelector((s) => s.data.error);
  const hotel = status === 'signedIn' && account?.staff && account.active;
  useLive(Boolean(hotel));
  useEffect(() => {
    if (hotel) {
      dispatch(loadAll());
      const p = store.getState().printer;
      warmUp([p.bill?.wifi ? undefined : p.bill?.id, p.separateKitchen && !p.kitchen?.wifi ? p.kitchen?.id : undefined]);
    }
    if (status === 'signedOut') dispatch(resetData());
  }, [hotel, status]);

  // Only seen if the start screen's 3 s safety limit passes first: the same Techyverve logo in the same place.
  if (status === 'starting') return <Centered><TechyverveLogo size={78} /></Centered>;
  if (status === 'signedOut') return <LoginScreen />;
  if (account && !account.staff) {
    return (
      <Centered>
        <T w="heavy" style={{ fontSize: 20, textAlign: 'center' }}>No access yet</T>
        <T style={{ textAlign: 'center', color: C.muted }}>Ask your hotel owner to add you in Settings → Staff Logins.</T>
        <Button kind="secondary" title="Sign Out" onPress={() => dispatch(signOut())} />
      </Centered>
    );
  }
  if (account && !account.active) {
    return (
      <Centered>
        <T w="heavy" style={{ fontSize: 20 }}>Service paused</T>
        <T style={{ textAlign: 'center', color: C.muted }}>Billing for {account.hotel} is paused.{account.paused_reason ? ` Reason: “${account.paused_reason}”.` : ''} Please contact Techyverve. Your bills and menu are safe.</T>
        <Button kind="secondary" title="Try Again" onPress={() => dispatch(recheck())} />
      </Centered>
    );
  }
  if (!loaded) {
    return (
      <Centered>
        {loadError ? (
          <>
            <T w="heavy" style={{ fontSize: 18 }}>Couldn’t load</T>
            <T style={{ textAlign: 'center', color: C.muted }}>{loadError}</T>
            <Button title="Try Again" onPress={() => dispatch(loadAll())} />
          </>
        ) : <ActivityIndicator color={C.brand1} size="large" />}
      </Centered>
    );
  }
  return (
    <NavigationContainer theme={theme}>
      <S.Navigator screenOptions={{ headerTitleStyle: { fontFamily: F.heavy }, headerShadowVisible: false, headerStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }}>
        <S.Screen name="Main" component={Tabs} options={{ headerShown: false }} />
        <S.Screen name="Order" component={OrderScreen} options={{ title: '' }} />
        <S.Screen name="Bill" component={BillScreen} options={{ title: 'Bill' }} />
        <S.Screen name="Stay" component={StayScreen} options={{ title: 'Room' }} />
        <S.Screen name="Bills" component={BillsScreen} options={{ title: 'Bills' }} />
        <S.Screen name="Analytics" component={AnalyticsScreen} options={{ title: 'Analytics' }} />
        <S.Screen name="Printer" component={PrinterScreen} options={{ title: 'Printer Setup' }} />
      </S.Navigator>
    </NavigationContainer>
  );
}

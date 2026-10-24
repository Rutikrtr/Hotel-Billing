import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { warmUp } from './printing/ble';
import BillsScreen from './screens/BillsScreen';
import LoginScreen from './screens/LoginScreen';
import OrderScreen from './screens/OrderScreen';
import PrinterScreen from './screens/PrinterScreen';
import SettingsScreen from './screens/SettingsScreen';
import TablesScreen from './screens/TablesScreen';
import { store, useAppDispatch, useAppSelector } from './store';
import { recheck, signOut } from './store/auth';
import { loadAll, refreshOrders, resetData } from './store/data';
import { sb } from './supabase';
import { Button, T } from './ui/kit';
import { Logo } from './ui/Logo';
import { C, F } from './ui/theme';

export type Stack = {
  Main: undefined;
  Order: { tableId?: number; section?: string; parcelId?: number | null };
  Printer: undefined;
};
const S = createNativeStackNavigator<Stack>();
const Tab = createBottomTabNavigator();

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: C.bg, primary: C.accent, card: C.surface, text: C.text, border: C.line } };

const icon = (d: string) => ({ color }: { color: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill={color}><Path d={d} fillRule="evenodd" /></Svg>
);
const ICONS = {
  tables: ({ color }: { color: string }) => (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill={color}>
      <Rect x={3} y={3} width={8} height={8} rx={2} /><Rect x={13} y={3} width={8} height={8} rx={2} />
      <Rect x={3} y={13} width={8} height={8} rx={2} /><Rect x={13} y={13} width={8} height={8} rx={2} />
    </Svg>
  ),
  bills: icon('M5 2.5h14v19l-2.33-1.6L14.33 21.5 12 19.9l-2.33 1.6-2.34-1.6L5 21.5zM8 7v1.6h8V7zm0 4v1.6h8V11zm0 4v1.6h5V15z'),
  settings: icon('M10.3 2h3.4l.5 2.6a8 8 0 0 1 1.9 1.1l2.5-.9 1.7 2.9-2 1.7a8 8 0 0 1 0 2.2l2 1.7-1.7 2.9-2.5-.9a8 8 0 0 1-1.9 1.1l-.5 2.6h-3.4l-.5-2.6a8 8 0 0 1-1.9-1.1l-2.5.9-1.7-2.9 2-1.7a8 8 0 0 1 0-2.2l-2-1.7 1.7-2.9 2.5.9a8 8 0 0 1 1.9-1.1zM12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z'),
};

function Tabs() {
  const canBill = useAppSelector((s) => s.auth.account?.can_bill === true);
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false, tabBarActiveTintColor: C.accent, tabBarInactiveTintColor: C.muted,
      tabBarLabelStyle: { fontFamily: F.bold, fontSize: 11 }, tabBarStyle: { height: 60, paddingBottom: 8, paddingTop: 6 },
    }}>
      <Tab.Screen name="Tables" component={TablesScreen} options={{ tabBarIcon: ICONS.tables }} />
      {canBill ? <Tab.Screen name="Bills" component={BillsScreen} options={{ tabBarIcon: ICONS.bills }} /> : null}
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: ICONS.settings }} />
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
      if (st === 'active') { dispatch(recheck()); later(); }
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
      warmUp([p.bill?.id, p.separateKitchen ? p.kitchen?.id : undefined]);
    }
    if (status === 'signedOut') dispatch(resetData());
  }, [hotel, status]);

  if (status === 'starting') return <Centered><Logo size={88} /><T w="heavy" style={{ fontSize: 22 }}>Master Bill</T></Centered>;
  if (status === 'signedOut') return <LoginScreen />;
  if (account && !account.staff) {
    return (
      <Centered>
        <T w="heavy" style={{ fontSize: 20, textAlign: 'center' }}>{account.super_admin ? 'Super admin' : 'No access yet'}</T>
        <T style={{ textAlign: 'center', color: C.muted }}>{account.super_admin ? 'The super admin console is in the Master Bill web app.' : 'Ask your hotel owner to add you in Settings → Staff Logins.'}</T>
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
        <S.Screen name="Printer" component={PrinterScreen} options={{ title: 'Printer Setup' }} />
      </S.Navigator>
    </NavigationContainer>
  );
}

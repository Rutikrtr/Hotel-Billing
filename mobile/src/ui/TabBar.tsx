import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icons';
import { Gradient, T } from './kit';
import { C, F } from './theme';
import { useWide } from './wide';
import { useAppSelector } from '../store';
import { TechyverveLogo } from './TechyverveLogo';

const ICONS: Record<string, (p: { color: string; size?: number }) => React.ReactElement> = {
  Tables: Icon.tables, Rooms: Icon.bed, Bills: Icon.bills, Analytics: Icon.analytics, Menu: Icon.dish, Settings: Icon.settings,
};
const GAP = 6;   // space between the sliding pill and the sides of its slot

/**
 * Floating bottom dock: a white rounded bar resting above the phone's own buttons. The open tab sits
 * in an orange gradient pill (icon and name in white) that slides to the tapped tab; icons pop slightly.
 */
export default function TabBar(props: BottomTabBarProps) {
  return useWide() ? <SideBar {...props} /> : <Dock {...props} />;
}

// Pages reached from Settings on a computer, not listed in the sidebar (Settings stays highlighted).
const IN_SETTINGS = new Set(['Analytics']);
let collapsedOnce = false;   // remembered while the app is open

/**
 * Computer: a dark sidebar with the brand, the pages and the hotel. The « button folds it to icons only
 * (more room for tables and orders); » opens it again.
 */
function SideBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const settings = useAppSelector((s) => s.data.settings);
  const account = useAppSelector((s) => s.auth.account);
  const [mini, setMini] = useState(collapsedOnce);
  const fold = () => { collapsedOnce = !mini; setMini(!mini); };
  const current = state.routes[state.index]?.name;
  const hotel = settings?.hotel_name ?? account?.hotel ?? '';
  return (
    <View style={[st.side, mini && st.sideMini]}>
      <View {...({ dataSet: { drag: '1' } } as object)} style={[st.brand, mini && { justifyContent: 'center', paddingHorizontal: 0 }]}>
        <View style={st.brandIcon}><Gradient radius={12} /><View><TechyverveLogo size={22} color="#FFFFFF" /></View></View>
        {mini ? null : (
          <View style={{ flex: 1 }}>
            <T w="heavy" style={{ fontSize: 16.5, letterSpacing: -0.3, color: '#FFFFFF' }}>Master Bill</T>
            <T w="semibold" style={{ fontSize: 11, color: '#9AA3C7' }}>by Techyverve</T>
          </View>
        )}
      </View>
      {mini ? null : <T w="heavy" style={st.group}>MAIN</T>}
      <View style={{ gap: 4, marginTop: mini ? 18 : 6 }}>
        {state.routes.map((route) => {
          if (IN_SETTINGS.has(route.name)) return null;
          const on = route.name === current || (route.name === 'Settings' && IN_SETTINGS.has(current));
          const label = descriptors[route.key].options.title ?? route.name;
          const Ico = ICONS[route.name] ?? Icon.tables;
          const press = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (route.name !== current && !e.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable key={route.key} onPress={press} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [st.item, mini && st.itemMini, !on && (hovered || pressed) && { backgroundColor: 'rgba(255,255,255,0.07)' }]}>
              {on ? <Gradient radius={12} /> : null}
              <View><Ico color={on ? '#FFFFFF' : '#AEB5D3'} size={20} /></View>
              {mini ? null : <T w={on ? 'heavy' : 'semibold'} style={{ fontSize: 14.5, color: on ? '#FFFFFF' : '#D5D9EC' }}>{label}</T>}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      {mini ? null : (
        <View style={st.hotel}>
          <View style={st.hotelDot}><T w="heavy" style={{ color: '#FFFFFF', fontSize: 13 }}>{hotel.replace(/^(hotel|हॉटेल)\s+/i, '').slice(0, 1).toUpperCase() || 'H'}</T></View>
          <View style={{ flex: 1 }}>
            <T w="heavy" numberOfLines={1} style={{ fontSize: 13, color: '#FFFFFF' }}>{hotel}</T>
            <T w="semibold" numberOfLines={1} style={{ fontSize: 11.5, color: '#9AA3C7' }}>{account?.role ? account.role[0].toUpperCase() + account.role.slice(1) : ''}</T>
          </View>
        </View>
      )}
      <Pressable onPress={fold} accessibilityRole="button" accessibilityLabel={mini ? 'Open the side menu' : 'Fold the side menu'}
        style={(x) => [st.fold, (x as { hovered?: boolean }).hovered && { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
        <T w="heavy" style={{ color: '#D5D9EC', fontSize: 15 }}>{mini ? '»' : '«'}</T>
        {mini ? null : <T w="semibold" style={{ color: '#AEB5D3', fontSize: 12.5 }}>Fold menu</T>}
      </Pressable>
    </View>
  );
}

/** Phone: the floating bottom dock. */
function Dock({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(state.index)).current;
  const n = state.routes.length;
  useEffect(() => {
    Animated.spring(x, { toValue: state.index, useNativeDriver: true, friction: 9, tension: 80 }).start();
  }, [state.index]);
  const slot = width / n;

  return (
    <View style={[st.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={st.dock} onLayout={(e) => setWidth(e.nativeEvent.layout.width - 14)}>
        {width ? (
          <Animated.View pointerEvents="none" style={[st.pill, { width: slot - GAP * 2,
            transform: [{ translateX: x.interpolate({ inputRange: [0, Math.max(n - 1, 1)], outputRange: [GAP, slot * Math.max(n - 1, 1) + GAP] }) }],
          }]}>
            <Gradient radius={18} />
          </Animated.View>
        ) : null}
        {state.routes.map((route, i) => {
          const on = state.index === i;
          const label = descriptors[route.key].options.title ?? route.name;
          const Ico = ICONS[route.name] ?? Icon.tables;
          const press = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!on && !e.defaultPrevented) navigation.navigate(route.name);
          };
          const pop = x.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [1, 1.12, 1], extrapolate: 'clamp' });
          return (
            <Pressable key={route.key} onPress={press} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
              <Animated.View style={{ transform: [{ scale: pop }] }}><Ico color={on ? '#FFFFFF' : '#9C8E83'} size={21} /></Animated.View>
              <T numberOfLines={1} style={[st.label, on && { color: '#FFFFFF', fontFamily: F.heavy }]}>{label}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  side: { width: 240, backgroundColor: '#151A33', paddingHorizontal: 14, paddingTop: 16, paddingBottom: 14 },
  sideMini: { width: 76, paddingHorizontal: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, minHeight: 48 },
  group: { color: '#6E77A0', fontSize: 10.5, letterSpacing: 1.2, marginTop: 22, marginLeft: 10 },
  itemMini: { justifyContent: 'center', paddingHorizontal: 0 },
  hotelDot: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  fold: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 38, borderRadius: 10, marginTop: 10 },
  brandIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 46, paddingHorizontal: 14, borderRadius: 12, overflow: 'hidden' },
  hotel: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: 10 },
  wrap: { backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 6 },
  dock: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 24, borderWidth: 1, borderColor: C.line, padding: 6,
    shadowColor: '#7C2D12', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  pill: { position: 'absolute', top: 6, bottom: 6, left: 6, borderRadius: 18, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: 52 },
  label: { fontSize: 11, color: '#9C8E83', fontFamily: F.semibold },
});

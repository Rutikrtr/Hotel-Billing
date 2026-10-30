import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
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
  // Computer: Root draws the sidebar beside every screen instead of a tab bar.
  return useWide() ? null : <Dock {...props} />;
}

export interface SidePage { name: string; label: string }

/**
 * Computer: the app's sidebar, drawn by Root beside every screen (also while taking an order), so it never
 * disappears. The « button folds it to icons only and » opens it again; the width slides between the two.
 */
export function AppSideBar({ pages, current, onGo, mini, onFold }: { pages: SidePage[]; current: string; onGo: (name: string) => void; mini: boolean; onFold: () => void }) {
  const settings = useAppSelector((s) => s.data.settings);
  const account = useAppSelector((s) => s.auth.account);
  const hotel = settings?.hotel_name ?? account?.hotel ?? '';
  // Icons stay in the same place; the names keep their size and are simply covered by the sliding edge
  // (and fade), so nothing squeezes or wraps while the sidebar folds or opens.
  const width = useRef(new Animated.Value(mini ? 76 : 248)).current;
  useEffect(() => {
    Animated.timing(width, { toValue: mini ? 76 : 248, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [mini]);
  const fade = width.interpolate({ inputRange: [76, 180, 248], outputRange: [0, 0.6, 1] });
  const Label = ({ children, style }: { children: React.ReactNode; style?: object }) => (
    <Animated.View style={{ opacity: fade, width: 160 }} pointerEvents="none"><T numberOfLines={1} style={style}>{children}</T></Animated.View>
  );
  return (
    <Animated.View style={[st.side, { width }]}>
      <View {...({ dataSet: { drag: '1' } } as object)} style={st.brand}>
        <View style={{ width: 28, alignItems: 'center' }}><TechyverveLogo size={28} color="#FFFFFF" /></View>
        <Animated.View style={{ opacity: fade, width: 160 }}>
          <T w="heavy" numberOfLines={1} style={{ fontSize: 17, letterSpacing: -0.3, color: '#FFFFFF' }}>Master Bill</T>
          <T w="semibold" numberOfLines={1} style={{ fontSize: 11, color: '#A8A29E' }}>by Techyverve</T>
        </Animated.View>
      </View>
      <View style={{ gap: 4, marginTop: 26 }}>
        {pages.map((pg) => {
          const on = pg.name === current;
          const Ico = ICONS[pg.name] ?? Icon.tables;
          return (
            <Pressable key={pg.name} onPress={() => onGo(pg.name)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={pg.label}
              style={(x) => [st.item, !on && (x as { hovered?: boolean }).hovered && st.itemHover]}>
              {on ? <Gradient radius={12} /> : null}
              <View style={{ width: 28, alignItems: 'center' }}><Ico color={on ? '#FFFFFF' : '#A8A29E'} size={20} /></View>
              <Label style={{ fontSize: 14.5, fontFamily: on ? F.heavy : F.semibold, color: on ? '#FFFFFF' : '#E7E5E4' }}>{pg.label}</Label>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <Animated.View style={[st.hotel, { opacity: fade }]}>
        <T w="heavy" numberOfLines={2} style={{ fontSize: 15.5, lineHeight: 20, color: '#FFFFFF', width: 196 }}>{hotel}</T>
        <T w="semibold" numberOfLines={1} style={{ fontSize: 12, color: '#A8A29E', marginTop: 2, width: 196 }}>{account?.role ? account.role[0].toUpperCase() + account.role.slice(1) : ''}</T>
      </Animated.View>
      <Pressable onPress={onFold} accessibilityRole="button" accessibilityLabel={mini ? 'Open the side menu' : 'Fold the side menu'}
        style={(x) => [st.fold, (x as { hovered?: boolean }).hovered && st.foldHover]}>
        <View style={{ width: 28, alignItems: 'center' }}><T w="heavy" style={{ color: '#FFFFFF', fontSize: 16 }}>{mini ? '»' : '«'}</T></View>
        <Label style={{ color: '#D6D3D1', fontSize: 12.5, fontFamily: F.semibold }}>Fold menu</Label>
      </Pressable>
    </Animated.View>
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
  itemOn: { backgroundColor: '#FFFFFF' },
  side: { backgroundColor: '#1C1917', paddingHorizontal: 12, paddingTop: 16, paddingBottom: 14, overflow: 'hidden' },
  itemHover: { backgroundColor: 'rgba(255,255,255,0.08)' },
  foldHover: { backgroundColor: 'rgba(255,255,255,0.14)' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, minHeight: 48, overflow: 'hidden' },
  group: { color: '#6B7280', fontSize: 10.5, letterSpacing: 1.2, marginTop: 22, marginLeft: 10 },
  itemMini: { justifyContent: 'center', paddingHorizontal: 0 },
  hotelDot: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  fold: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 42, paddingHorizontal: 11, borderRadius: 12, marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  brandIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 46, paddingHorizontal: 12, borderRadius: 12, overflow: 'hidden' },
  hotel: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, overflow: 'hidden' },
  wrap: { backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 6 },
  dock: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 24, borderWidth: 1, borderColor: C.line, padding: 6,
    shadowColor: '#7C2D12', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  pill: { position: 'absolute', top: 6, bottom: 6, left: 6, borderRadius: 18, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: 52 },
  label: { fontSize: 11, color: '#9C8E83', fontFamily: F.semibold },
});

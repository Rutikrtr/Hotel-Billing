import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from './icons';
import { Gradient, T } from './kit';
import { C, F, SIDEBAR } from './theme';
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

export interface SidePage { name: string; label: string; group?: 'manage' }

const FEATHER: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  Tables: 'grid', Rooms: 'key', Menu: 'book-open', Bills: 'file-text', Analytics: 'bar-chart-2', Settings: 'settings',
};
const MINI = 72, OPEN = 248;

/** Web: the browser's own tooltip (shows a page's name over its icon while the sidebar is collapsed). */
function useTitle(text: string | undefined) {
  const ref = useRef<View>(null);
  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el?.setAttribute) return;
    if (text) el.setAttribute('title', text); else el.removeAttribute('title');
  }, [text]);
  return ref;
}

/**
 * Computer: the black sidebar, drawn by Root beside every screen (also while taking an order). It always
 * sits beside the page, never over it; Collapse shrinks it to icons (names show as tooltips) and opens it
 * again. Bills, Analytics and Settings are grouped under Manage.
 */
export function AppSideBar({ pages, current, onGo, mini, onFold, onSignOut }: { pages: SidePage[]; current: string; onGo: (name: string) => void; mini: boolean; onFold: () => void; onSignOut: () => void }) {
  const { account, email } = useAppSelector((s) => s.auth);
  const settings = useAppSelector((s) => s.data.settings);
  const hotel = settings?.hotel_name ?? account?.hotel ?? '';
  const width = useRef(new Animated.Value(mini ? MINI : OPEN)).current;
  useEffect(() => {
    Animated.timing(width, { toValue: mini ? MINI : OPEN, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [mini]);
  const fade = width.interpolate({ inputRange: [MINI, 170, OPEN], outputRange: [0, 0.5, 1] });
  const Label = ({ children, style }: { children: React.ReactNode; style?: object }) => (
    <Animated.View style={{ opacity: fade, width: 150 }} pointerEvents="none"><T numberOfLines={1} style={style}>{children}</T></Animated.View>
  );
  const [manage, setManage] = useState(false);   // Manage starts closed; a click opens it
  const service = pages.filter((p) => !p.group);
  const managed = pages.filter((p) => p.group === 'manage');
  const inManage = managed.some((p) => p.name === current);
  const manageRef = useTitle(mini ? 'Manage' : undefined);
  const role = account?.role ? account.role[0].toUpperCase() + account.role.slice(1) : '';
  const foldRef = useTitle(mini ? 'Open the menu' : undefined);
  const outRef = useTitle('Sign out');
  return (
    <Animated.View style={[st.side, { width }]}>
      <View {...({ dataSet: { drag: '1' } } as object)} style={st.brand}>
        <View style={st.logo}><Gradient radius={9} /><View><TechyverveLogo size={20} color="#FFFFFF" /></View></View>
        <Animated.View style={{ opacity: fade, width: 160 }}>
          <T w="bold" numberOfLines={1} style={{ fontSize: 15.5, color: SIDEBAR.text }}>Master Bill</T>
          <T numberOfLines={1} style={{ fontSize: 11.5, color: SIDEBAR.soft }}>{hotel}</T>
        </Animated.View>
      </View>
      <View style={{ height: 22, justifyContent: 'center' }}>
        {mini ? <View style={st.groupLine} /> : <Label style={st.group}>SERVICE</Label>}
      </View>
      <View style={{ gap: 2, marginBottom: 12 }}>
        {service.map((pg) => <Item key={pg.name} pg={pg} on={pg.name === current} mini={mini} onGo={onGo} fade={fade} />)}
      </View>
      {managed.length ? (
        <View style={{ gap: 2 }}>
          <Pressable ref={manageRef} onPress={() => setManage(!manage)} accessibilityRole="button" accessibilityState={{ expanded: manage }} accessibilityLabel="Manage"
            style={(x) => [st.item, (x as { hovered?: boolean }).hovered && st.itemHover]}>
            {/* Closed while one of its pages is open: the icon shows it in orange. */}
            <View style={st.ico}><Feather name="sliders" size={18} color={inManage && !manage ? C.accent : SIDEBAR.icon} /></View>
            <Label style={{ fontSize: 14.5, fontFamily: F.semibold, color: '#E4E4E6' }}>Manage</Label>
            <Animated.View style={{ opacity: fade, marginLeft: 'auto' }}><Feather name={manage ? 'chevron-up' : 'chevron-down'} size={16} color={SIDEBAR.soft} /></Animated.View>
          </Pressable>
          {manage ? managed.map((pg) => <Item key={pg.name} pg={pg} on={pg.name === current} mini={mini} onGo={onGo} fade={fade} sub />) : null}
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <Pressable ref={foldRef} onPress={onFold} accessibilityRole="button" accessibilityLabel={mini ? 'Open the menu' : 'Collapse the menu'}
        style={(x) => [st.item, (x as { hovered?: boolean }).hovered && st.itemHover]}>
        <View style={st.ico}><Feather name={mini ? 'chevrons-right' : 'chevrons-left'} size={17} color={SIDEBAR.icon} /></View>
        <Label style={{ fontSize: 13.5, fontFamily: F.semibold, color: SIDEBAR.soft }}>Collapse</Label>
      </Pressable>
      <View style={st.me}>
        <View style={st.avatar}><Feather name="user" size={16} color="#C9C9CC" /></View>
        <Animated.View style={{ opacity: fade, width: 124 }} pointerEvents="none">
          <T w="semibold" numberOfLines={1} style={{ fontSize: 13, color: SIDEBAR.text }}>{email ?? ''}</T>
          <T numberOfLines={1} style={{ fontSize: 11.5, color: SIDEBAR.soft }}>{role}</T>
        </Animated.View>
        {mini ? null : (
          <Pressable ref={outRef} onPress={onSignOut} hitSlop={6} accessibilityRole="button" accessibilityLabel="Sign out"
            style={(x) => [st.out, (x as { hovered?: boolean }).hovered && st.itemHover]}>
            <Feather name="log-out" size={16} color={SIDEBAR.icon} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

/** One page in the sidebar: icon and name; collapsed, the name shows as a tooltip. */
function Item({ pg, on, mini, onGo, fade, sub }: { pg: SidePage; on: boolean; mini: boolean; onGo: (name: string) => void; fade: Animated.AnimatedInterpolation<number>; sub?: boolean }) {
  const ref = useTitle(mini ? pg.label : undefined);
  return (
    <Pressable ref={ref} onPress={() => onGo(pg.name)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={pg.label}
      style={(x) => [st.item, sub && !mini && st.sub, on && st.itemOn, !on && (x as { hovered?: boolean }).hovered && st.itemHover]}>
      <View style={st.ico}><Feather name={FEATHER[pg.name] ?? 'circle'} size={sub ? 16 : 18} color={on ? C.accent : SIDEBAR.icon} /></View>
      <Animated.View style={{ opacity: fade, width: 150 }} pointerEvents="none">
        <T numberOfLines={1} style={{ fontSize: 14.5, fontFamily: on ? F.bold : F.semibold, color: on ? '#FFFFFF' : '#B4B4B8' }}>{pg.label}</T>
      </Animated.View>
    </Pressable>
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
  side: { backgroundColor: SIDEBAR.bg, borderRightWidth: 1, borderRightColor: SIDEBAR.line, paddingHorizontal: 12, paddingTop: 16, paddingBottom: 12, overflow: 'hidden',
    backgroundImage: 'linear-gradient(180deg, #1B1B1F 0%, #0B0B0D 55%, #000000 100%)' } as object,
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, minHeight: 44, marginBottom: 18, overflow: 'hidden' },
  logo: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 4px 14px rgba(232,89,12,0.45)' } as object,
  group: { fontSize: 10.5, letterSpacing: 1.2, color: SIDEBAR.soft, fontFamily: F.semibold, marginLeft: 12 },
  sub: { paddingLeft: 26, height: 38 },
  groupLine: { height: 1, marginHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.10)' },
  ico: { width: 24, alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 42, paddingHorizontal: 12, borderRadius: 10, overflow: 'hidden' },
  itemOn: { backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 2px rgba(0,0,0,0.5)' } as object,
  itemHover: { backgroundColor: SIDEBAR.hover },
  me: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: SIDEBAR.line, paddingTop: 12, marginTop: 8, paddingLeft: 6, overflow: 'hidden' },
  avatar: { width: 34, height: 34, borderRadius: 9, backgroundColor: '#26262A', alignItems: 'center', justifyContent: 'center' },
  out: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  wrap: { backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 6 },
  dock: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 24, borderWidth: 1, borderColor: C.line, padding: 6,
    shadowColor: '#7C2D12', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  pill: { position: 'absolute', top: 6, bottom: 6, left: 6, borderRadius: 18, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: 52 },
  label: { fontSize: 11, color: '#9C8E83', fontFamily: F.semibold },
});

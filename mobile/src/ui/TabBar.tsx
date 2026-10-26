import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icons';
import { Gradient, T } from './kit';
import { C, F } from './theme';

const ICONS: Record<string, (p: { color: string; size?: number }) => React.ReactElement> = {
  Tables: Icon.tables, Rooms: Icon.bed, Bills: Icon.bills, Analytics: Icon.analytics, Menu: Icon.dish, Settings: Icon.settings,
};
const GAP = 6;   // space between the sliding pill and the sides of its slot

/**
 * Floating bottom dock: a white rounded bar resting above the phone's own buttons. The open tab sits
 * in an orange gradient pill (icon and name in white) that slides to the tapped tab; icons pop slightly.
 */
export default function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
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
  wrap: { backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 6 },
  dock: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 24, borderWidth: 1, borderColor: C.line, padding: 6,
    shadowColor: '#7C2D12', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  pill: { position: 'absolute', top: 6, bottom: 6, left: 6, borderRadius: 18, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: 52 },
  label: { fontSize: 11, color: '#9C8E83', fontFamily: F.semibold },
});

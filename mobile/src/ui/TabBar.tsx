import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icons';
import { Gradient, T } from './kit';
import { C, F } from './theme';

const ICONS: Record<string, (p: { color: string; size?: number }) => React.ReactElement> = {
  Tables: Icon.tables, Bills: Icon.bills, Analytics: Icon.analytics, Menu: Icon.dish, Settings: Icon.settings,
};
const PILL_W = 58;

/**
 * Bottom bar like the web app: the open tab's icon sits in an orange pill with its name in orange underneath.
 * The pill slides to the tapped tab. It sits above the phone's own navigation buttons.
 */
export default function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(state.index)).current;
  const n = state.routes.length;
  useEffect(() => {
    Animated.timing(x, { toValue: state.index, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [state.index]);
  const slot = width / n;

  return (
    <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width ? (
        <Animated.View pointerEvents="none" style={[st.pill, {
          transform: [{ translateX: x.interpolate({ inputRange: [0, Math.max(n - 1, 1)], outputRange: [slot / 2 - PILL_W / 2, slot * (Math.max(n - 1, 1)) + slot / 2 - PILL_W / 2] }) }],
        }]}>
          <Gradient radius={16} />
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
        return (
          <Pressable key={route.key} onPress={press} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
            <View style={st.iconBox}><Ico color={on ? '#FFFFFF' : C.muted} size={22} /></View>
            <T numberOfLines={1} style={[st.label, on && { color: C.accent, fontFamily: F.heavy }]}>{label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 },
  pill: { position: 'absolute', top: 8, left: 0, width: PILL_W, height: 34, borderRadius: 17, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  iconBox: { height: 34, justifyContent: 'center' },
  label: { fontSize: 11.5, color: C.muted, fontFamily: F.semibold },
});

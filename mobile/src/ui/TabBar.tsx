import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icons';
import { Gradient, T } from './kit';
import { C, shadow } from './theme';

const ICONS: Record<string, (p: { color: string; size?: number }) => React.ReactElement> = {
  Tables: Icon.tables, Bills: Icon.bills, Analytics: Icon.analytics, Menu: Icon.menu, Settings: Icon.settings,
};

/**
 * Floating bottom bar: the open tab is a dark pill with its name; the others are icons with a small label.
 * It sits above the phone's own navigation buttons on every phone.
 */
export default function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: C.bg, paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10) }}>
      <View style={[st.bar, shadow]}>
        {state.routes.map((route, i) => {
          const on = state.index === i;
          const label = descriptors[route.key].options.title ?? route.name;
          const Ico = ICONS[route.name] ?? Icon.tables;
          const press = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!on && !e.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable key={route.key} onPress={press} style={[st.tab, on && st.on]} hitSlop={4}
              accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
              {on ? <Gradient radius={20} /> : null}
              <View style={[{ alignItems: 'center', gap: 2, zIndex: 1 }, on && { flexDirection: 'row', gap: 6 }]}>
                <Ico color={on ? '#FFFFFF' : C.muted} size={21} />
                {on ? <T w="bold" numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 13 }}>{label}</T>
                  : <T w="semibold" numberOfLines={1} style={{ color: C.muted, fontSize: 10.5 }}>{label}</T>}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 26, borderWidth: 1, borderColor: C.line, padding: 6, gap: 4 },
  tab: { flex: 1, height: 52, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 2 },
  on: { flex: 1.9, flexDirection: 'row', gap: 6, overflow: 'hidden', backgroundColor: C.brand1 },
});

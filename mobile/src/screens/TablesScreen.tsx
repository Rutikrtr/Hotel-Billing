import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutAnimation, Platform, useWindowDimensions, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { computeBill, rsShort } from '../money';
import { tokenNo } from '../printing/escpos';
import { useAppDispatch, useAppSelector } from '../store';
import { hasPending } from '../store/cart';
import { loadAll } from '../store/data';
import { areaTables, fixtureKind, tableKey, type LayoutArea, type Order, type Table } from '../types';
import { Icon } from '../ui/icons';
import { Button, Chip, Gradient, HotelHeader, PageHeader, T, glass } from '../ui/kit';
import PlanGrid from '../ui/PlanGrid';
import { useWide } from '../ui/wide';
import { DotFloor, FixtureBlock } from '../ui/PlanArt';
import { C, shadow } from '../ui/theme';
import type { Stack } from '../Root';

const since = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default function TablesScreen() {
  const [area, setArea] = useState('all');
  // Computer: as many table columns as fit (about 190 px each); phones keep 3.
  const wide = useWide();
  const { width } = useWindowDimensions();
  const cols = wide ? Math.max(4, Math.min(8, Math.floor((width - 260) / 190))) : 3;
  const y = useRef(new Animated.Value(0)).current;   // scroll position, drives the card shrinking and the slim bar
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const dispatch = useAppDispatch();
  const { tables, orders, settings, loading, error } = useAppSelector((s) => s.data);
  const carts = useAppSelector((s) => s.cart);
  // Switching the floor plan on or off (Settings) slides between the two views instead of jumping.
  const layoutOn = !!settings?.table_layout?.on;
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) { firstLayout.current = false; return; }
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [layoutOn]);
  const account = useAppSelector((s) => s.auth.account);
  const canBill = account?.can_bill === true;
  const rate = settings?.tax_rate_bp ?? 0;
  const totalOf = (o: Order) => computeBill(o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), o.discount, rate).total;

  const all = Object.values(orders);
  const parcels = all.filter((o) => o.is_parcel);
  const onTables = all.filter((o) => !o.is_parcel).reduce((n, o) => n + totalOf(o), 0);
  const tiles = useMemo(() => tables.map((t) => ({ table: t, orders: all.filter((o) => o.table_id === t.id) })), [tables, orders]);
  const running = tiles.filter((x) => x.orders.length).length;


  /** One table: free (white), eating (orange) or billed (purple); compact in dense floor plans. */
  const tile = (table: Table, os: Order[], compact = false, inGrid = false, big: 'wide' | 'tall' | false = false) => {
    const busy = os.length > 0;
    const billed = busy && os.every((o) => o.billed_at);
    const unsaved = hasPending(carts[tableKey(table.id, os[0]?.section ?? 'A')]);
    const total = os.reduce((n, o) => n + totalOf(o), 0);
    const o = os[0];
    const open = () => nav.navigate('Order', { tableId: table.id, section: o?.section ?? 'A' });
    const label = `${table.name}, ${busy ? (billed ? 'billed' : 'eating') : 'free'}`;
    if (big) {
      // A big table on the floor plan. Wide (one row): name on the left, status and amount on the right.
      // Tall or square: everything centred.
      const pill = (
        <View style={[st.pill, { backgroundColor: busy ? (billed ? C.billedSoft : C.accentSoft) : C.freeSoft }]}>
          <T w="heavy" style={{ fontSize: 11, color: busy ? (billed ? C.billed : C.accentStrong) : C.free }}>{busy ? (billed ? 'Billed' : os.length > 1 ? `${os.length} groups` : 'Eating') : 'Free'}</T>
        </View>
      );
      const money = busy ? <T w="heavy" numberOfLines={1} style={{ fontSize: 15, color: billed ? C.billed : C.accentStrong }}>{rsShort(total)}</T> : null;
      return (
        <Pressable onPress={open} key={table.id} accessibilityLabel={label}
          style={({ pressed }) => [st.tile, st.tileInGrid, big === 'wide' ? st.tileWide : st.tileBig, busy && st.tileBusy, billed && st.tileBilled, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
          {big === 'wide' ? (
            <>
              <View style={{ flex: 1 }}>
                <T w="heavy" numberOfLines={1} style={{ fontSize: 18, letterSpacing: -0.3 }}>{table.name}</T>
                {busy ? <T style={{ fontSize: 11.5, color: C.muted }}>{since(o.opened_at)}</T> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>{pill}{money}</View>
            </>
          ) : (
            <>
              <T w="heavy" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 22, letterSpacing: -0.3 }}>{table.name}</T>
              {pill}
              {money}
              {busy ? <T style={{ fontSize: 11.5, color: C.muted }}>{since(o.opened_at)}</T> : null}
            </>
          )}
          {unsaved ? <View style={st.unsavedDot} /> : null}
        </Pressable>
      );
    }
    return (
      <Pressable
        onPress={() => nav.navigate('Order', { tableId: table.id, section: o?.section ?? 'A' })}
        key={table.id}
        style={({ pressed }) => [st.tile, inGrid && st.tileInGrid, compact && st.tileCompact, busy && st.tileBusy, billed && st.tileBilled, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        accessibilityLabel={`${table.name}, ${busy ? (billed ? 'billed' : 'eating') : 'free'}`}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T w="heavy" numberOfLines={1} style={{ fontSize: compact ? 13 : 14.5, flexShrink: 1 }}>{table.name}</T>
          {compact ? <View style={[st.dot, { backgroundColor: busy ? (billed ? C.billed : C.brand1) : C.free }]} /> : (
            <View style={[st.pill, { backgroundColor: busy ? (billed ? C.billedSoft : C.accentSoft) : C.freeSoft }]}>
              <T w="heavy" style={{ fontSize: 10.5, color: busy ? (billed ? C.billed : C.accentStrong) : C.free }}>{busy ? (billed ? 'Billed' : os.length > 1 ? `${os.length} groups` : 'Eating') : 'Free'}</T>
            </View>
          )}
        </View>
        {busy ? (
          <>
            <T w="heavy" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: compact ? 12.5 : 14, color: billed ? C.billed : C.accentStrong, marginTop: compact ? 2 : 4 }}>{rsShort(total)}</T>
            <T style={{ fontSize: compact ? 10.5 : 11.5, color: C.muted }} numberOfLines={1}>{compact ? (billed ? 'Billed' : since(o.opened_at)) : since(o.opened_at)}</T>
          </>
        ) : <T style={{ fontSize: compact ? 10.5 : 11.5, color: compact ? C.free : C.muted, marginTop: compact ? 4 : 10 }}>{compact ? 'Free' : 'Tap to order'}</T>}
        {unsaved ? <View style={st.unsavedDot} /> : null}
      </Pressable>
    );
  };

  const header = (
    <View>
      {wide ? null : <HotelHeader
        name={settings?.hotel_name ?? account?.hotel ?? 'Master Bill'}
        subtitle={`Tables · ${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`}
        right={canBill ? <Button title="Parcel" icon={Icon.bag} small onPress={() => nav.navigate('Order', { parcelId: null })} /> : null}
      />}
      {wide ? (
        // Computer: a shorter bar with the big New Parcel button right beside it.
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'stretch', marginBottom: 14 }}>
          <Animated.View style={[st.hero, shadow, wide && st.heroWide, {
            opacity: y.interpolate({ inputRange: [0, 110], outputRange: [1, 0.35], extrapolate: 'clamp' }),
            transform: [{ scale: y.interpolate({ inputRange: [-60, 0, 110], outputRange: [1, 1, 0.94], extrapolate: 'clamp' }) }],
          }]}>
            <Gradient radius={18} />
            <View style={{ flex: 1 }}>
              <T w="semibold" style={{ color: '#FFFFFF', opacity: 0.88, fontSize: 11.5 }}>On tables now</T>
              <T w="heavy" numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontSize: wide ? 30 : 24, letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}>{rsShort(onTables)}</T>
            </View>
            <View style={st.facts}>
              {[[running, 'Running', C.accentStrong], [tables.length - running, 'Free', C.free], [parcels.length, 'Parcels', C.billed]].map(([v, l, col]) => (
                <View key={l as string} style={st.fact}>
                  <T w="heavy" style={{ fontSize: 15, color: col as string, fontVariant: ['tabular-nums'] }}>{v}</T>
                  <T w="semibold" style={{ fontSize: 10, color: C.muted }}>{l}</T>
                </View>
              ))}
            </View>
          </Animated.View>
          {canBill ? (
            <Pressable onPress={() => nav.navigate('Order', { parcelId: null })} accessibilityRole="button" accessibilityLabel="New parcel"
              style={(x) => [st.parcelBtn, shadow, (x as { hovered?: boolean }).hovered && { transform: [{ translateY: -2 }] }]}>
              <Gradient radius={18} />
              <View><Icon.bag color="#FFFFFF" size={26} /></View>
              <View>
                <T w="heavy" style={{ color: '#FFFFFF', fontSize: 18 }}>New Parcel</T>
                <T w="semibold" style={{ color: '#FFFFFF', opacity: 0.85, fontSize: 12 }}>Takeaway order</T>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : (
      <Animated.View style={[st.hero, shadow, {
        opacity: y.interpolate({ inputRange: [0, 110], outputRange: [1, 0.35], extrapolate: 'clamp' }),
        transform: [{ scale: y.interpolate({ inputRange: [-60, 0, 110], outputRange: [1, 1, 0.94], extrapolate: 'clamp' }) }],
      }]}>
        <Gradient radius={18} />
        <View style={{ flex: 1 }}>
          <T w="semibold" style={{ color: '#FFFFFF', opacity: 0.88, fontSize: 11.5 }}>On tables now</T>
          <T w="heavy" numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontSize: 24, letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}>{rsShort(onTables)}</T>
        </View>
        <View style={st.facts}>
          {[[running, 'Running', C.accentStrong], [tables.length - running, 'Free', C.free], [parcels.length, 'Parcels', C.billed]].map(([v, l, col]) => (
            <View key={l as string} style={st.fact}>
              <T w="heavy" style={{ fontSize: 15, color: col as string, fontVariant: ['tabular-nums'] }}>{v}</T>
              <T w="semibold" style={{ fontSize: 10, color: C.muted }}>{l}</T>
            </View>
          ))}
        </View>
      </Animated.View>
      )}
      {error ? <T style={{ color: C.danger, marginBottom: 8 }}>{error}</T> : null}
      {parcels.length ? (
        <View style={{ marginBottom: 12 }}>
          <T w="heavy" style={st.section}>PARCELS · {parcels.length}</T>
          {parcels.map((o) => (
            <Pressable key={o.id} style={st.parcel} onPress={() => nav.navigate('Order', { parcelId: o.id })}>
              <T w="heavy" style={{ flex: 1, fontSize: 16 }}>Parcel{o.bill_no ? ` #${tokenNo(o.bill_no)}` : ''} <T w="semibold" style={{ fontSize: 13, color: C.muted }}>· {o.items.reduce((n, i) => n + i.quantity, 0)} items</T></T>
              <T w="heavy" style={{ fontSize: 16 }}>{rsShort(totalOf(o))}</T>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  // Slim bar that slides in at the top once the big card has scrolled away.
  const miniBar = (
    <Animated.View pointerEvents="none" style={[st.mini, {
      opacity: y.interpolate({ inputRange: [100, 112], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ translateY: y.interpolate({ inputRange: [96, 112], outputRange: [-56, 0], extrapolate: 'clamp' }) }],
    }]}>
      <View style={st.miniTotal}><Gradient radius={10} /><T w="heavy" style={{ color: '#FFFFFF', fontSize: 13.5, fontVariant: ['tabular-nums'] }}>{rsShort(onTables)}</T></View>
      <T w="bold" numberOfLines={1} style={{ flex: 1, fontSize: 12.5 }}>
        <T w="heavy" style={{ color: C.accentStrong, fontSize: 12.5 }}>{running}</T> running  ·  <T w="heavy" style={{ color: C.free, fontSize: 12.5 }}>{tables.length - running}</T> free{parcels.length ? <T w="bold" style={{ fontSize: 12.5 }}>  ·  <T w="heavy" style={{ color: C.billed, fontSize: 12.5 }}>{parcels.length}</T> parcel{parcels.length > 1 ? 's' : ''}</T> : null}
      </T>
    </Animated.View>
  );
  // Computer: hotel name, date and Parcel stay fixed at the top; the tables scroll below.
  const pageHead = wide ? (
    <PageHeader title={settings?.hotel_name ?? account?.hotel ?? 'Master Bill'}
      sub={`Tables · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`}
      />
  ) : null;
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true });

  // Floor plan (Settings → Table layout): areas with a grid; no extra requests, it comes with the settings.
  const layout = settings?.table_layout?.on && settings.table_layout.areas.length ? settings.table_layout : null;
  if (layout) {
    const byId = new Map(tiles.map((x) => [x.table.id, x]));
    const placed = new Set(layout.areas.flatMap(areaTables));
    const others = tiles.filter((x) => !placed.has(x.table.id));
    const shown = area === 'all' || !layout.areas.some((a) => a.id === area) ? layout.areas : layout.areas.filter((a) => a.id === area);
    const areaStats = (a: LayoutArea) => {
      const ids = areaTables(a).filter((id) => byId.has(id));
      return { tables: ids.length, busy: ids.filter((id) => byId.get(id)!.orders.length).length };
    };
    return (
      <View style={{ flex: 1 }}>
      {pageHead}
      <Animated.ScrollView style={{ backgroundColor: 'transparent' }} contentContainerStyle={{ padding: wide ? 24 : 12, paddingBottom: 30 }}
        onScroll={onScroll} scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => dispatch(loadAll())} colors={[C.brand1]} />}>
        {header}
        {layout.areas.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10, flexGrow: 0 }}>
            <Chip label={`All · ${running}/${tables.length}`} on={area === 'all'} onPress={() => setArea('all')} />
            {layout.areas.map((a) => { const s = areaStats(a); return <Chip key={a.id} label={`${a.name} · ${s.busy}/${s.tables}`} on={area === a.id} onPress={() => setArea(a.id)} />; })}
          </ScrollView>
        ) : null}
        {shown.map((a) => {
          const s = areaStats(a);
          const compact = a.cols >= 4;
          return (
            <View key={a.id} {...glass} style={st.area}>
              <DotFloor />
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <T w="heavy" style={{ fontSize: 15, flex: 1 }}>{a.name}</T>
                <T w="semibold" style={{ fontSize: 11.5, color: C.muted }}>{s.busy} of {s.tables} busy</T>
              </View>
              <PlanGrid area={a} rowH={wide ? 96 : compact ? 64 : 84} render={(x) => {
                const tb = x.kind === 'table' ? byId.get(x.id!) : undefined;
                if (tb) return tile(tb.table, tb.orders, compact, true, x.h > 1 ? 'tall' : x.w > 1 ? 'wide' : false);
                if (x.kind === 'fixture') return <FixtureBlock kind={fixtureKind(x.id!)} compact={compact} />;
                return <View style={[st.empty, { flex: 1, minHeight: 0 }, x.kind === 'blank' && st.blank]} />;
              }} />
            </View>
          );
        })}
        {area === 'all' && others.length ? (
          <View style={st.area}>
            <DotFloor />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <T w="heavy" style={{ fontSize: 15, flex: 1 }}>Other tables</T>
              <T w="semibold" style={{ fontSize: 11.5, color: C.muted }}>not placed in an area</T>
            </View>
            {Array.from({ length: Math.ceil(others.length / 4) }, (_, r) => (
              <View key={r} style={st.gridRow}>
                {Array.from({ length: 4 }, (_, c) => {
                  const x = others[r * 4 + c];
                  return <View key={c} style={st.cell}>{x ? tile(x.table, x.orders, true, true) : null}</View>;
                })}
              </View>
            ))}
          </View>
        ) : null}
      </Animated.ScrollView>
      {wide ? null : miniBar}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    {pageHead}
    <Animated.FlatList
      onScroll={onScroll} scrollEventThrottle={16}
      style={{ backgroundColor: 'transparent' }}
      contentContainerStyle={{ padding: wide ? 24 : 12, paddingBottom: 30 }}
      data={tiles}
      key={`cols${cols}`}
      numColumns={cols}
      keyExtractor={(x) => String(x.table.id)}
      columnWrapperStyle={{ gap: 8 }}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => dispatch(loadAll())} colors={[C.brand1]} />}
      renderItem={({ item }) => (wide ? <View style={{ width: `${100 / cols - 1}%` as `${number}%`, marginBottom: 8 }}>{tile(item.table, item.orders, false, true)}</View> : tile(item.table, item.orders))}
    />
    {wide ? null : miniBar}
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  eyebrow: { fontSize: 11, color: C.accent, letterSpacing: 0.8, textTransform: 'uppercase' },
  h1: { fontSize: 24, letterSpacing: -0.5 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12 },
  heroWide: { flex: 1, maxWidth: 760, marginBottom: 0, paddingVertical: 20, paddingHorizontal: 22 },
  parcelBtn: { width: 250, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, paddingHorizontal: 26 },
  facts: { flexDirection: 'row', gap: 5 },
  fact: { minWidth: 54, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 11, paddingVertical: 5, paddingHorizontal: 6 },
  mini: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: C.line, shadowColor: '#7C2D12', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  miniTotal: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  factN: { color: '#FFFFFF', fontSize: 16 },
  factL: { color: '#FFFFFF', fontSize: 11 },
  section: { fontSize: 11.5, color: C.muted, letterSpacing: 0.8, marginBottom: 6 },
  parcel: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 6 },
  tile: { flex: 1, maxWidth: '32.2%', minHeight: 72, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 9, marginBottom: 8 },
  // Each hall is drawn as a floor plan (dotted paper, see DotFloor); white tables stand out on it.
  area: { borderRadius: 18, borderWidth: 1, borderColor: C.floorLine, padding: 10, marginBottom: 12 },
  gridRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  cell: { flex: 1 },
  blank: { backgroundColor: 'transparent', borderWidth: 0 },
  empty: { flex: 1, minHeight: 84, borderRadius: 11, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.spotLine, borderStyle: 'dashed' },
  tileInGrid: { flex: 1, maxWidth: '100%', minHeight: 0, marginBottom: 0, borderColor: '#FFFFFF', shadowColor: '#7C2D12', shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  tileBig: { alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8 },
  tileWide: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  tileCompact: { minHeight: 0, padding: 7, marginBottom: 0, borderRadius: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tileBusy: { backgroundColor: C.busyTile, borderColor: C.busyLine },
  tileBilled: { backgroundColor: C.billedTile, borderColor: C.billedLine },
  pill: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  unsavedDot: { position: 'absolute', right: 7, bottom: 7, width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand1 },
});

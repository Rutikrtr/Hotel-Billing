import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { computeBill, rsShort } from '../money';
import { tokenNo } from '../printing/escpos';
import { useAppDispatch, useAppSelector } from '../store';
import { hasPending } from '../store/cart';
import { loadAll } from '../store/data';
import { tableKey, type LayoutArea, type Order, type Table } from '../types';
import { Icon } from '../ui/icons';
import { Button, Chip, HotelHeader, SummaryCard, T } from '../ui/kit';
import { C } from '../ui/theme';
import type { Stack } from '../Root';

const since = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default function TablesScreen() {
  const [area, setArea] = useState('all');
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const dispatch = useAppDispatch();
  const { tables, orders, settings, loading, error } = useAppSelector((s) => s.data);
  const carts = useAppSelector((s) => s.cart);
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
  const tile = (table: Table, os: Order[], compact = false, inGrid = false) => {
    const busy = os.length > 0;
    const billed = busy && os.every((o) => o.billed_at);
    const unsaved = hasPending(carts[tableKey(table.id, os[0]?.section ?? 'A')]);
    const total = os.reduce((n, o) => n + totalOf(o), 0);
    const o = os[0];
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
      <HotelHeader
        name={settings?.hotel_name ?? account?.hotel ?? 'Master Bill'}
        subtitle={`Tables · ${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`}
        right={canBill ? <Button title="Parcel" icon={Icon.bag} small onPress={() => nav.navigate('Order', { parcelId: null })} /> : null}
      />
      <SummaryCard
        label="On tables now"
        value={rsShort(onTables)}
        stats={[
          { value: running, label: 'Running', color: C.accentStrong, bg: C.accentSoft },
          { value: tables.length - running, label: 'Free', color: C.free, bg: C.freeSoft },
          { value: parcels.length, label: 'Parcels', color: C.billed, bg: C.billedSoft },
        ]}
      />
      {error ? <T style={{ color: C.danger, marginBottom: 8 }}>{error}</T> : null}
      {parcels.length ? (
        <View style={{ marginBottom: 12 }}>
          <T w="heavy" style={st.section}>PARCELS · {parcels.length}</T>
          {parcels.map((o) => (
            <Pressable key={o.id} style={st.parcel} onPress={() => nav.navigate('Order', { parcelId: o.id })}>
              <T w="bold" style={{ flex: 1 }}>Parcel{o.bill_no ? ` #${tokenNo(o.bill_no)}` : ''} · {o.items.reduce((n, i) => n + i.quantity, 0)} items</T>
              <T w="heavy">{rsShort(totalOf(o))}</T>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  // Floor plan (Settings → Table layout): areas with a grid; no extra requests, it comes with the settings.
  const layout = settings?.table_layout?.on && settings.table_layout.areas.length ? settings.table_layout : null;
  if (layout) {
    const byId = new Map(tiles.map((x) => [x.table.id, x]));
    const placed = new Set(layout.areas.flatMap((a) => a.cells.filter((c): c is number => c != null)));
    const others = tiles.filter((x) => !placed.has(x.table.id));
    const shown = area === 'all' || !layout.areas.some((a) => a.id === area) ? layout.areas : layout.areas.filter((a) => a.id === area);
    const areaStats = (a: LayoutArea) => {
      const ids = a.cells.filter((c): c is number => c != null && byId.has(c));
      return { tables: ids.length, busy: ids.filter((id) => byId.get(id)!.orders.length).length };
    };
    return (
      <ScrollView style={{ backgroundColor: 'transparent' }} contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
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
            <View key={a.id} style={st.area}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <T w="heavy" style={{ fontSize: 15, flex: 1 }}>{a.name}</T>
                <T w="semibold" style={{ fontSize: 11.5, color: C.muted }}>{s.busy} of {s.tables} busy</T>
              </View>
              {Array.from({ length: a.rows }, (_, r) => (
                <View key={r} style={st.gridRow}>
                  {Array.from({ length: a.cols }, (_, c) => {
                    const id = a.cells[r * a.cols + c];
                    const x = id != null ? byId.get(id) : undefined;
                    return <View key={c} style={st.cell}>{x ? tile(x.table, x.orders, compact, true) : <View style={[st.empty, compact && { minHeight: 64 }]} />}</View>;
                  })}
                </View>
              ))}
            </View>
          );
        })}
        {area === 'all' && others.length ? (
          <View style={st.area}>
            <T w="heavy" style={{ fontSize: 15, marginBottom: 8 }}>Other tables</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {others.map((x) => <View key={x.table.id} style={{ width: '31.5%' }}>{tile(x.table, x.orders, true, true)}</View>)}
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: 'transparent' }}
      contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      data={tiles}
      numColumns={3}
      keyExtractor={(x) => String(x.table.id)}
      columnWrapperStyle={{ gap: 8 }}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => dispatch(loadAll())} colors={[C.brand1]} />}
      renderItem={({ item }) => tile(item.table, item.orders)}
    />
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  eyebrow: { fontSize: 11, color: C.accent, letterSpacing: 0.8, textTransform: 'uppercase' },
  h1: { fontSize: 24, letterSpacing: -0.5 },
  hero: { borderRadius: 18, padding: 14, marginBottom: 12, overflow: 'hidden' },
  fact: { flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
  factN: { color: '#FFFFFF', fontSize: 16 },
  factL: { color: '#FFFFFF', fontSize: 11 },
  section: { fontSize: 11.5, color: C.muted, letterSpacing: 0.8, marginBottom: 6 },
  parcel: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 6 },
  tile: { flex: 1, maxWidth: '32.2%', minHeight: 72, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 9, marginBottom: 8 },
  area: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 10, marginBottom: 12 },
  gridRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  cell: { flex: 1 },
  empty: { flex: 1, minHeight: 84, borderRadius: 11, backgroundColor: '#F1ECE7', borderWidth: 1, borderColor: '#E7DFD8', borderStyle: 'dashed' },
  tileInGrid: { flex: 1, maxWidth: '100%', marginBottom: 0 },
  tileCompact: { minHeight: 64, padding: 7, marginBottom: 0, borderRadius: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tileBusy: { backgroundColor: '#FFF6EF', borderColor: '#F0C2A4' },
  tileBilled: { backgroundColor: '#F7F2FF', borderColor: '#D5C2FF' },
  pill: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  unsavedDot: { position: 'absolute', right: 7, bottom: 7, width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand1 },
});

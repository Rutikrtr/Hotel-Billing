import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { computeBill, rsShort } from '../money';
import { tokenNo } from '../printing/escpos';
import { useAppDispatch, useAppSelector } from '../store';
import { hasPending } from '../store/cart';
import { loadAll } from '../store/data';
import { tableKey, type Order } from '../types';
import { Button, Gradient, T } from '../ui/kit';
import { C } from '../ui/theme';
import type { Stack } from '../Root';

const since = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default function TablesScreen() {
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

  const header = (
    <View>
      <View style={st.head}>
        <View style={{ flex: 1 }}>
          <T w="heavy" style={st.eyebrow}>{settings?.hotel_name ?? account?.hotel ?? ''}</T>
          <T w="heavy" style={st.h1}>Tables</T>
        </View>
        {canBill ? <Button title="＋ Parcel" small onPress={() => nav.navigate('Order', { parcelId: null })} /> : null}
      </View>
      <View style={st.hero}>
        <Gradient radius={18} />
        <T w="semibold" style={{ color: '#FFFFFF', opacity: 0.92, fontSize: 12 }}>On tables now</T>
        <T w="heavy" style={{ color: '#FFFFFF', fontSize: 26, marginBottom: 8 }}>{rsShort(onTables)}</T>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[[running, 'Running'], [tables.length - running, 'Free'], [parcels.length, 'Parcels']].map(([n, l]) => (
            <View key={String(l)} style={st.fact}><T w="heavy" style={st.factN}>{n}</T><T w="semibold" style={st.factL}>{l}</T></View>
          ))}
        </View>
      </View>
      {error ? <T style={{ color: C.danger, marginBottom: 8 }}>{error}</T> : null}
      {parcels.length ? (
        <View style={{ marginBottom: 12 }}>
          <T w="heavy" style={st.section}>PARCELS · {parcels.length}</T>
          {parcels.map((o) => (
            <Pressable key={o.id} style={st.parcel} onPress={() => nav.navigate('Order', { parcelId: o.id })}>
              <T w="bold" style={{ flex: 1 }}>🛍 Parcel{o.bill_no ? ` #${tokenNo(o.bill_no)}` : ''} · {o.items.reduce((n, i) => n + i.quantity, 0)} items</T>
              <T w="heavy">{rsShort(totalOf(o))}</T>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      data={tiles}
      numColumns={3}
      keyExtractor={(x) => String(x.table.id)}
      columnWrapperStyle={{ gap: 8 }}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => dispatch(loadAll())} colors={[C.brand1]} />}
      renderItem={({ item: { table, orders: os } }) => {
        const busy = os.length > 0;
        const billed = busy && os.every((o) => o.billed_at);
        const unsaved = hasPending(carts[tableKey(table.id, os[0]?.section ?? 'A')]);
        const total = os.reduce((n, o) => n + totalOf(o), 0);
        const o = os[0];
        return (
          <Pressable
            onPress={() => nav.navigate('Order', { tableId: table.id, section: o?.section ?? 'A' })}
            style={({ pressed }) => [st.tile, busy && st.tileBusy, billed && st.tileBilled, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}
            accessibilityLabel={`${table.name}, ${busy ? (billed ? 'billed' : 'eating') : 'free'}`}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T w="heavy" style={{ fontSize: 16 }}>{table.name}</T>
              <View style={[st.pill, { backgroundColor: busy ? (billed ? C.billedSoft : C.accentSoft) : C.freeSoft }]}>
                <T w="heavy" style={{ fontSize: 10.5, color: busy ? (billed ? C.billed : C.accentStrong) : C.free }}>{busy ? (billed ? 'Billed' : os.length > 1 ? `${os.length} groups` : 'Eating') : 'Free'}</T>
              </View>
            </View>
            {busy ? (
              <>
                <T w="heavy" style={{ fontSize: 15.5, color: billed ? C.billed : C.accentStrong, marginTop: 6 }}>{rsShort(total)}</T>
                <T style={{ fontSize: 11.5, color: C.muted }} numberOfLines={1}>{since(o.opened_at)}</T>
              </>
            ) : <T style={{ fontSize: 12, color: C.muted, marginTop: 14 }}>Tap to order</T>}
            {unsaved ? <View style={st.unsavedDot} /> : null}
          </Pressable>
        );
      }}
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
  tile: { flex: 1, maxWidth: '32.2%', minHeight: 84, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 9, marginBottom: 8 },
  tileBusy: { backgroundColor: '#FFF6EF', borderColor: '#F0C2A4' },
  tileBilled: { backgroundColor: '#F7F2FF', borderColor: '#D5C2FF' },
  pill: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  unsavedDot: { position: 'absolute', right: 7, bottom: 7, width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand1 },
});

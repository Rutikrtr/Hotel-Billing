import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { addDays, localDay, longDate, startOf } from '../dates';
import { computeBill, rs, rsShort } from '../money';
import { tokenNo } from '../printing/escpos';
import { useAppSelector } from '../store';
import { q, sb } from '../supabase';
import { Icon } from '../ui/icons';
import { Empty, Header, SectionTitle, SummaryCard, T } from '../ui/kit';
import { C } from '../ui/theme';
import type { Stack } from '../Root';

interface Row { id: number; kind: string; bill_no: string; label: string; method: string; total: number; closed_at: string; edit_count?: number }
const METHODS = ['Cash', 'UPI', 'Card'];
const METHOD_COLOR: Record<string, string> = { Cash: '#15803D', UPI: '#6D28D9', Card: '#0E7490' };

/** Paid bills for one day (one small request), plus bills printed but not paid yet. */
export default function BillsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const [day, setDay] = useState(localDay());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { orders, tables, settings } = useAppSelector((s) => s.data);
  const today = localDay();
  const isToday = day === today;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await q<Row[]>(sb.rpc('bill_list', { p_from: startOf(day), p_to: startOf(addDays(day, 1)) })));
      setError(null);
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }, [day]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const waiting = Object.values(orders).filter((o) => o.billed_at);
  const tableName = (id: number | null) => tables.find((t) => t.id === id)?.name ?? '';
  const total = rows.reduce((n, r) => n + Number(r.total), 0);
  const by = (m: string) => rows.filter((r) => r.method === m).reduce((n, r) => n + Number(r.total), 0);

  return (
    <FlatList
      style={{ backgroundColor: 'transparent' }} contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      data={rows} keyExtractor={(r) => `${r.kind}${r.id}`}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.brand1]} />}
      ListHeaderComponent={
        <View>
          <Header eyebrow={isToday ? 'Today' : longDate(day)} title="Bills" />
          <View style={st.dayNav}>
            <Pressable hitSlop={8} style={st.navBtn} onPress={() => setDay(addDays(day, -1))} accessibilityLabel="Day before"><Icon.chevL color={C.text} size={20} /></Pressable>
            <Pressable style={{ flex: 1, alignItems: 'center' }} onPress={() => setDay(today)}>
              <T w="bold">{longDate(day)}</T>
              {!isToday ? <T style={{ color: C.accent, fontSize: 11.5 }}>Tap for today</T> : null}
            </Pressable>
            <Pressable hitSlop={8} style={[st.navBtn, isToday && { opacity: 0.3 }]} disabled={isToday} onPress={() => setDay(addDays(day, 1))} accessibilityLabel="Next day"><Icon.chevR color={C.text} size={20} /></Pressable>
          </View>
          <SummaryCard
            label={`${isToday ? 'Today’s sales' : 'Sales'} · ${rows.length} bill${rows.length === 1 ? '' : 's'}`}
            value={rsShort(total)}
            stats={METHODS.map((m) => ({ value: rsShort(by(m)), label: m, color: METHOD_COLOR[m], bg: `${METHOD_COLOR[m]}14` }))}
          />
          {error ? <T style={{ color: C.danger, marginBottom: 8 }}>{error}</T> : null}
          {isToday && waiting.length ? (
            <>
              <SectionTitle>Waiting for payment · {waiting.length}</SectionTitle>
              {waiting.map((o) => (
                <Pressable key={o.id} style={st.row} onPress={() => nav.navigate('Order', o.is_parcel ? { parcelId: o.id } : { tableId: o.table_id ?? undefined, section: o.section })}>
                  <View style={[st.badge, { backgroundColor: '#FEF3C7' }]}><T w="heavy" style={{ color: '#B45309' }}>!</T></View>
                  <View style={{ flex: 1 }}>
                    <T w="bold">{o.is_parcel ? `Parcel #${tokenNo(o.bill_no)}` : `${tableName(o.table_id)}${o.section !== 'A' ? `-${o.section}` : ''}`} · {o.bill_no}</T>
                    <T style={{ color: C.muted, fontSize: 12 }}>Printed {new Date(o.billed_at!).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · not paid yet</T>
                  </View>
                  <T w="heavy">{rs(computeBill(o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), o.discount, settings?.tax_rate_bp ?? 0).total)}</T>
                </Pressable>
              ))}
            </>
          ) : null}
          <SectionTitle>Paid bills</SectionTitle>
        </View>
      }
      ListEmptyComponent={loading ? null : <Empty icon="🧾" text={`No bills ${isToday ? 'yet today' : 'on this day'}. Paid bills appear here.`} />}
      renderItem={({ item: r }) => (
        <Pressable style={st.row} disabled={r.kind === 'stay'} onPress={() => nav.navigate('Bill', { orderId: r.id })}>
          <View style={[st.badge, { backgroundColor: `${METHOD_COLOR[r.method] ?? C.muted}1A` }]}>
            <T w="heavy" style={{ color: METHOD_COLOR[r.method] ?? C.muted, fontSize: r.method === 'Cash' ? 15 : 10 }}>{r.method === 'Cash' ? '₹' : r.method}</T>
          </View>
          <View style={{ flex: 1 }}>
            <T w="bold" numberOfLines={1}>{r.label} · {r.bill_no}</T>
            <T style={{ color: C.muted, fontSize: 12 }}>{new Date(r.closed_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {r.method}{r.edit_count ? ' · Edited' : ''}</T>
          </View>
          <T w="heavy">{rs(Number(r.total))}</T>
          {r.kind !== 'stay' ? <Icon.chevR color={C.muted} size={18} /> : null}
        </Pressable>
      )}
    />
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 18, padding: 14, marginBottom: 4, overflow: 'hidden' },
  fact: { flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 10, padding: 8 },
  dayNav: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 6, marginBottom: 12 },
  navBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, marginBottom: 6 },
  badge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});

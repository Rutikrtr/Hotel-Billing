import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { addDays, localDay, startOf } from '../dates';
import { computeBill, rs, rsShort } from '../money';
import { tokenNo } from '../printing/escpos';
import { useAppSelector } from '../store';
import { q, sb } from '../supabase';
import { Icon } from '../ui/icons';
import { Empty, SectionTitle, SummaryCard, T } from '../ui/kit';
import { C } from '../ui/theme';
import type { Stack } from '../Root';

interface Row { id: number; kind: string; bill_no: string; label: string; method: string; total: number; closed_at: string; edit_count?: number; split?: Record<string, number> }
const METHODS = ['Cash', 'UPI', 'Card'];
const METHOD_COLOR: Record<string, string> = { Cash: '#15803D', UPI: '#6D28D9', Card: '#0E7490', Split: '#B45309' };

/** Set when a bill is edited or deleted, so the list reads again when you come back. */
export const billsChanged = { current: false };

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
      const list = await q<Row[]>(sb.rpc('bill_list', { p_from: startOf(day), p_to: startOf(addDays(day, 1)) }));
      // Split bills: one more small request for their parts, only on days that have any.
      const ids = list.filter((r) => r.kind === 'order' && r.method === 'Split').map((r) => r.id);
      if (ids.length) {
        const parts = await q<{ id: number; payment_split: Record<string, number> | null }[]>(sb.from('orders').select('id, payment_split').in('id', ids));
        const byId = new Map(parts.map((x) => [x.id, x.payment_split]));
        for (const r of list) if (byId.has(r.id)) r.split = byId.get(r.id) ?? undefined;
      }
      setRows(list);
      setError(null);
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }, [day]);
  const loadedAt = useRef(0);
  useEffect(() => { load().then(() => { loadedAt.current = Date.now(); }); }, [load]);
  // Back from a bill (it may have been edited): read again, but not more than once a minute.
  useFocusEffect(useCallback(() => {
    if (loadedAt.current && (billsChanged.current || Date.now() - loadedAt.current > 60000)) { billsChanged.current = false; } else return;
    load().then(() => { loadedAt.current = Date.now(); });
  }, [load]));

  const waiting = Object.values(orders).filter((o) => o.billed_at);
  const tableName = (id: number | null) => tables.find((t) => t.id === id)?.name ?? '';
  const total = rows.reduce((n, r) => n + Number(r.total), 0);
  const by = (m: string) => rows.reduce((n, r) => n + (r.split ? Number(r.split[m] ?? 0) : r.method === m ? Number(r.total) : 0), 0);

  const [picking, setPicking] = useState(false);
  const dateChip = (
    <Pressable onPress={() => setPicking(true)} hitSlop={8} style={st.dateChip} accessibilityRole="button" accessibilityLabel="Choose date">
      <Icon.calendar color="#FFFFFF" size={14} />
      <T w="bold" style={{ color: '#FFFFFF', fontSize: 12 }}>{isToday ? 'Today' : shortDay(day)}</T>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Title and sales card stay in place; only the list below scrolls. */}
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        <SummaryCard
          label={`${isToday ? 'Today’s sales' : `Sales on ${shortDay(day)}`} · ${rows.length} bill${rows.length === 1 ? '' : 's'}`}
          value={rsShort(total)}
          right={dateChip}
          stats={METHODS.map((m) => ({ value: rsShort(by(m)), label: m, color: METHOD_COLOR[m], bg: `${METHOD_COLOR[m]}14` }))}
        />
        {picking && Platform.OS !== 'web' ? (
          <DateTimePicker value={new Date(`${day}T12:00:00`)} mode="date" maximumDate={new Date()}
            onChange={(e, d) => { setPicking(false); if (e.type === 'set' && d) setDay(localDay(d)); }} />
        ) : null}
      </View>
      <FlatList
        style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        data={rows} keyExtractor={(r) => `${r.kind}${r.id}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.brand1]} />}
        ListHeaderComponent={
          <View>
            {error ? <T style={{ color: C.danger, marginBottom: 8 }}>{error}</T> : null}
            {isToday && waiting.length ? (
              <>
                <SectionTitle>Waiting for payment · {waiting.length}</SectionTitle>
                {waiting.map((o) => (
                  <Pressable key={o.id} style={st.row} onPress={() => nav.navigate('Order', o.is_parcel ? { parcelId: o.id } : { tableId: o.table_id ?? undefined, section: o.section })}>
                    <View style={[st.badge, { backgroundColor: '#FEF3C7' }]}><T w="heavy" style={{ color: '#B45309' }}>!</T></View>
                    <View style={{ flex: 1 }}>
                      <T w="bold" numberOfLines={1}>{o.is_parcel ? `Parcel #${tokenNo(o.bill_no)}` : `${tableName(o.table_id)}${o.section !== 'A' ? `-${o.section}` : ''}`} · {o.bill_no}</T>
                      <T style={{ color: C.muted, fontSize: 11.5 }}>Printed {new Date(o.billed_at!).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · not paid yet</T>
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
          <Pressable style={st.row} onPress={() => (r.kind === 'stay' ? nav.navigate('Stay', { stayId: r.id }) : nav.navigate('Bill', { orderId: r.id }))}>
            <View style={[st.badge, { backgroundColor: `${METHOD_COLOR[r.method] ?? C.muted}1A` }]}>
              <T w="heavy" style={{ color: METHOD_COLOR[r.method] ?? C.muted, fontSize: r.method === 'Cash' ? 14 : 9.5 }}>{r.method === 'Cash' ? '₹' : r.method === 'Split' ? '½' : r.method}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T w="bold" numberOfLines={1}>{r.label} · {r.bill_no}</T>
              <T style={{ color: C.muted, fontSize: 11.5 }}>{new Date(r.closed_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {r.split ? Object.entries(r.split).map(([m, a]) => `${m} ${rsShort(a)}`).join(' + ') : r.method}{r.edit_count ? ' · Edited' : ''}</T>
            </View>
            <T w="heavy">{rs(Number(r.total))}</T>
            <Icon.chevR color={C.muted} size={16} />
          </Pressable>
        )}
      />
    </View>
  );
}

const shortDay = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const st = StyleSheet.create({
  hero: { borderRadius: 18, padding: 14, marginBottom: 4, overflow: 'hidden' },
  fact: { flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 10, padding: 8 },
  dayNav: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 6, marginBottom: 12 },
  navBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, paddingVertical: 9, paddingHorizontal: 11, marginBottom: 6 },
  dateChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badge: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});

import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { rs, rsShort } from '../money';
import { q, sb } from '../supabase';
import { Gradient, T } from '../ui/kit';
import { C } from '../ui/theme';

interface Row { id: number; kind: string; bill_no: string; label: string; method: string; total: number; closed_at: string }

/** Today's paid bills (one small request when the tab opens or is pulled down). */
export default function BillsScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 1);
      setRows(await q<Row[]>(sb.rpc('bill_list', { p_from: from.toISOString(), p_to: to.toISOString() })));
      setError(null);
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = rows.reduce((n, r) => n + Number(r.total), 0);
  const by = (m: string) => rows.filter((r) => r.method === m).reduce((n, r) => n + Number(r.total), 0);
  return (
    <FlatList
      style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      data={rows} keyExtractor={(r) => `${r.kind}${r.id}`}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.brand1]} />}
      ListHeaderComponent={
        <View>
          <T w="heavy" style={{ fontSize: 24, marginVertical: 6 }}>Bills</T>
          <View style={st.hero}>
            <Gradient radius={18} />
            <T w="semibold" style={{ color: '#FFFFFF', fontSize: 12, opacity: 0.92 }}>Today’s sales · {rows.length} bills</T>
            <T w="heavy" style={{ color: '#FFFFFF', fontSize: 26, marginBottom: 8 }}>{rs(total)}</T>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {['Cash', 'UPI', 'Card'].map((m) => (
                <View key={m} style={st.fact}><T w="heavy" style={{ color: '#FFFFFF' }}>{rsShort(by(m))}</T><T style={{ color: '#FFFFFF', fontSize: 11 }}>{m}</T></View>
              ))}
            </View>
          </View>
          {error ? <T style={{ color: C.danger, marginBottom: 8 }}>{error}</T> : null}
        </View>
      }
      ListEmptyComponent={loading ? null : <T style={{ textAlign: 'center', color: C.muted, marginTop: 30 }}>No bills yet today.</T>}
      renderItem={({ item: r }) => (
        <View style={st.row}>
          <View style={{ flex: 1 }}>
            <T w="bold">{r.label} · {r.bill_no}</T>
            <T style={{ color: C.muted, fontSize: 12 }}>{new Date(r.closed_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {r.method}</T>
          </View>
          <T w="heavy">{rs(Number(r.total))}</T>
        </View>
      )}
    />
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 18, padding: 14, marginBottom: 12, overflow: 'hidden' },
  fact: { flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 10, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 6 },
});

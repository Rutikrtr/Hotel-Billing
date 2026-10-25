import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { computeBill, fmt, rs } from '../money';
import { paperOf, printSlips } from '../printing';
import { billSlip, tokenNo } from '../printing/escpos';
import { useAppSelector } from '../store';
import { q, sb } from '../supabase';
import type { Order } from '../types';
import { Button, T } from '../ui/kit';
import { C } from '../ui/theme';
import { toast } from '../ui/toast';
import type { Stack } from '../Root';

type Paid = Order & { payment_method: string | null; closed_at: string | null; tax_rate_bp: number | null; edit_count: number | null; dining_tables: { name: string } | null };
const MONO = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const pct = (bp: number) => `${+(bp / 100).toFixed(2)}%`;

/** A paid bill as the customer got it (same layout as the web app), with Print. */
export default function BillScreen() {
  const { params } = useRoute<RouteProp<Stack, 'Bill'>>();
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const settings = useAppSelector((s) => s.data.settings);
  const printer = useAppSelector((s) => s.printer);
  const [order, setOrder] = useState<Paid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    q<Paid>(sb.from('orders')
      .select('id, table_id, section, is_parcel, status, discount, bill_no, billed_at, opened_at, closed_at, payment_method, tax_rate_bp, edit_count, dining_tables(name), items:order_items(id, menu_item_id, name, unit_price, quantity, kot_qty)')
      .eq('id', params.orderId).order('id', { referencedTable: 'order_items' }).single())
      .then(setOrder, (err: Error) => setError(err.message));
  }, [params.orderId]);

  if (error) return <View style={st.center}><T style={{ color: C.danger, textAlign: 'center' }}>{error}</T></View>;
  if (!order || !settings) return <View style={st.center}><ActivityIndicator color={C.brand1} size="large" /></View>;

  const rate = order.tax_rate_bp ?? settings.tax_rate_bp;
  const b = computeBill(order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), order.discount, rate);
  const label = order.dining_tables?.name ? `${order.dining_tables.name}${order.section !== 'A' ? `-${order.section}` : ''}` : 'Table';
  const at = order.closed_at ?? order.billed_at ?? new Date().toISOString();

  const print = async () => {
    setPrinting(true);
    try {
      await printSlips(printer, [billSlip(paperOf(printer), order, settings, label, order.bill_no ?? 'Bill', order.payment_method, { rate, at })]);
      toast('Bill printed');
    } catch (err) { toast((err as Error).message, true); } finally { setPrinting(false); }
  };
  const M = ({ children, style, b: bold }: { children: React.ReactNode; style?: object; b?: boolean }) => (
    <T style={[{ fontFamily: MONO, fontSize: 13.5, color: C.text, fontWeight: bold ? '700' : '400' }, style]}>{children}</T>
  );
  const KV = ({ k, v, big }: { k: string; v: string; big?: boolean }) => (
    <View style={st.kv}><M b={big} style={big ? { fontSize: 19 } : undefined}>{k}</M><M b={big} style={big ? { fontSize: 19 } : undefined}>{v}</M></View>
  );

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <Button kind="secondary" title="All Bills" style={{ flex: 1 }} onPress={() => nav.goBack()} />
        <Button title={printer.bill ? 'Print' : 'Set up Printer'} style={{ flex: 1.3 }} busy={printing} onPress={printer.bill ? print : () => nav.navigate('Printer')} />
      </View>
      <T w="semibold" style={{ color: C.muted, textAlign: 'center', marginBottom: 12 }}>
        {order.status === 'paid' ? `Paid by ${order.payment_method ?? '—'} · ${dateTime(at)}` : 'Not paid yet'}{order.edit_count ? ` · Edited ${order.edit_count}×` : ''}
      </T>
      <View style={st.paper}>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <M b style={{ fontSize: 20 }}>{settings.hotel_name}</M>
          {settings.hotel_address ? <M style={{ textAlign: 'center' }}>{settings.hotel_address}</M> : null}
          {settings.hotel_phone ? <M>Ph: {settings.hotel_phone}</M> : null}
          {settings.hotel_gstin && rate > 0 ? <M>GSTIN: {settings.hotel_gstin}</M> : null}
        </View>
        <View style={st.rule} />
        {order.is_parcel && order.bill_no ? (<><View style={{ alignItems: 'center' }}><M>PARCEL · Bill No.</M><M b style={{ fontSize: 30 }}>{tokenNo(order.bill_no)}</M></View><View style={st.rule} /></>) : null}
        <KV k={`Bill: ${order.bill_no ?? '—'}`} v={order.is_parcel ? 'Parcel' : `Table: ${label}`} />
        <KV k={dateTime(at)} v={order.payment_method ?? ''} />
        <View style={st.rule} />
        <View style={st.kv}><M style={{ flex: 1 }}>Item</M><M style={{ width: 40, textAlign: 'right' }}>Qty</M><M style={{ width: 86, textAlign: 'right' }}>Amt</M></View>
        <View style={st.thin} />
        {order.items.map((i) => (
          <View key={i.id} style={[st.kv, { marginBottom: 8 }]}>
            <View style={{ flex: 1 }}><M>{i.name}</M><M style={{ fontSize: 11.5, color: C.muted }}>@ {fmt(i.unit_price)}</M></View>
            <M style={{ width: 40, textAlign: 'right' }}>{i.quantity}</M>
            <M style={{ width: 86, textAlign: 'right' }}>{fmt(i.unit_price * i.quantity)}</M>
          </View>
        ))}
        <View style={st.rule} />
        <KV k={`Subtotal (${b.itemCount} items)`} v={fmt(b.subtotal)} />
        {b.discount ? <KV k="Discount" v={`-${fmt(b.discount)}`} /> : null}
        {b.tax ? (<><KV k={`CGST @ ${pct(rate / 2)}`} v={fmt(b.cgst)} /><KV k={`SGST @ ${pct(rate / 2)}`} v={fmt(b.sgst)} /></>) : null}
        {b.roundOff ? <KV k="Round off" v={fmt(b.roundOff)} /> : null}
        <View style={st.rule} />
        <KV k="TOTAL" v={rs(b.total)} big />
        <View style={st.rule} />
        <M style={{ textAlign: 'center' }}>Thank you! Visit again.</M>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.bg },
  paper: { backgroundColor: '#FFFFFF', borderRadius: 6, padding: 18, borderWidth: 1, borderColor: C.line },
  rule: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#8A7F78', marginVertical: 10 },
  thin: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#C9BFB8', marginTop: 4, marginBottom: 8 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
});

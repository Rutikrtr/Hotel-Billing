import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { shortDate } from '../dates';
import { computeBill, fmt, nightsBetween, rs, toPaise } from '../money';
import { paperOf, printSlips } from '../printing';
import { staySlip } from '../printing/escpos';
import { useAppSelector } from '../store';
import { q, sb } from '../supabase';
import type { Stay } from '../types';
import DateField from '../ui/DateField';
import { Button, Card, Chip, Field, Sheet, T } from '../ui/kit';
import { C } from '../ui/theme';
import { toast } from '../ui/toast';
import type { Stack } from '../Root';

const MONO = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });
const METHODS = ['Cash', 'UPI', 'Card'];
const plain = (p: number) => (p ? fmt(p).replace(/,/g, '').replace(/\.00$/, '') : '');
const pct = (bp: number) => `${+(bp / 100).toFixed(2)}%`;

/** One room stay: change dates, rate and discount, add extra charges, print, check out (same steps as the web app). */
export default function StayScreen() {
  const { params } = useRoute<RouteProp<Stack, 'Stay'>>();
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const settings = useAppSelector((s) => s.data.settings);
  const printer = useAppSelector((s) => s.printer);
  const [stay, setStay] = useState<Stay | null>(null);
  const [form, setForm] = useState({ check_in: '', check_out: '', rate: '', discount: '' });
  const [charge, setCharge] = useState({ description: '', quantity: '1', price: '' });
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState('Cash');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const st = await q<Stay>(sb.from('stays').select('*, lodging_rooms(number, room_type), stay_charges(*)').eq('id', params.stayId).order('id', { referencedTable: 'stay_charges' }).single());
      setStay(st);
      setForm({ check_in: st.check_in, check_out: st.check_out, rate: plain(st.rate), discount: plain(st.discount) });
    } catch (err) { toast((err as Error).message, true); }
  };
  useEffect(() => { load(); }, [params.stayId]);
  useEffect(() => { if (stay) nav.setOptions({ title: `Room ${stay.lodging_rooms?.number ?? ''}` }); }, [stay?.id]);

  if (!stay || !settings) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.brand1} size="large" /></View>;
  const paid = stay.status === 'paid';
  const rate = paid ? stay.tax_rate_bp ?? 0 : settings.tax_rate_bp;
  const nights = nightsBetween(stay.check_in, stay.check_out);
  const lines = [
    { name: `Room ${stay.lodging_rooms?.number ?? ''} · ${nights} night${nights === 1 ? '' : 's'}`, quantity: nights, unitPrice: stay.rate },
    ...stay.stay_charges.map((c) => ({ name: c.description, quantity: c.quantity, unitPrice: c.unit_price })),
  ];
  const b = computeBill(lines, stay.discount, rate);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); if (done) toast(done); await load(); } catch (err) { toast((err as Error).message, true); } finally { setBusy(null); }
  };
  const saveStay = () => run('stay', async () => {
    if (form.check_out < form.check_in) throw new Error('Check-out can’t be before check-in.');
    await q(sb.from('stays').update({ check_in: form.check_in, check_out: form.check_out, rate: toPaise(form.rate), discount: toPaise(form.discount) }).eq('id', stay.id));
  }, 'Stay saved');
  const addCharge = () => run('charge', async () => {
    const quantity = Number(charge.quantity || 1);
    if (!charge.description.trim()) throw new Error('Write what the charge is for, like Breakfast.');
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be 1 or more.');
    if (!charge.price.trim()) throw new Error('Enter the price.');
    await q(sb.from('stay_charges').insert({ stay_id: stay.id, description: charge.description.trim(), quantity, unit_price: toPaise(charge.price) }));
    setCharge({ description: '', quantity: '1', price: '' });
  });
  const print = () => run('print', async () => {
    if (!printer.bill) throw new Error('No printer set up on this phone. Open Settings → Printer Setup.');
    await printSlips(printer, [staySlip(paperOf(printer), stay, settings, rate)]);
  }, 'Printed');
  const cancel = () => Alert.alert('Cancel check-in', `Cancel ${stay.guest_name}’s check-in? The room becomes free and nothing is billed.`, [
    { text: 'Keep' },
    { text: 'Cancel Check-in', style: 'destructive', onPress: async () => {
      try { await q(sb.from('stays').delete().eq('id', stay.id)); toast('Check-in cancelled'); nav.goBack(); } catch (err) { toast((err as Error).message, true); }
    } },
  ]);
  const checkout = () => run('pay', async () => {
    await q(sb.rpc('checkout_stay', { p_stay_id: stay.id, p_method: method }));
    setPaying(false);
  }, `Room ${stay.lodging_rooms?.number} checked out · ${method} · ${rs(b.total)}`);

  const M = ({ children, style }: { children: React.ReactNode; style?: object }) => <T style={[{ fontFamily: MONO, fontSize: 13 }, style]}>{children}</T>;
  const KV = ({ k, v, big }: { k: string; v: string; big?: boolean }) => (
    <View style={st.kv}><M style={big ? { fontSize: 17, fontWeight: '700' } : undefined}>{k}</M><M style={big ? { fontSize: 17, fontWeight: '700' } : undefined}>{v}</M></View>
  );

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <T w="semibold" style={{ color: C.muted }}>{stay.guest_name}{stay.guest_phone ? ` · ${stay.guest_phone}` : ''} · {stay.guests} guest{stay.guests === 1 ? '' : 's'}{paid ? ` · Paid by ${stay.payment_method}` : ''}</T>
      {!paid ? (<>
        <Card style={{ gap: 10 }}>
          <T w="heavy" style={{ fontSize: 14.5 }}>Stay</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <DateField label="Check-in" value={form.check_in} onChange={(v) => setForm({ ...form, check_in: v })} />
            <DateField label="Check-out" value={form.check_out} min={form.check_in} onChange={(v) => setForm({ ...form, check_out: v })} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Field label="Rate per night (₹)" value={form.rate} onChangeText={(v) => setForm({ ...form, rate: v })} keyboardType="decimal-pad" style={{ flex: 1 }} />
            <Field label="Discount (₹)" value={form.discount} onChangeText={(v) => setForm({ ...form, discount: v })} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
          </View>
          <Button kind="secondary" small title="Save Stay" onPress={saveStay} busy={busy === 'stay'} />
        </Card>
        <Card style={{ gap: 8 }}>
          <T w="heavy" style={{ fontSize: 14.5 }}>Extra Charges</T>
          <T style={{ color: C.muted, fontSize: 11.5 }}>Food, laundry, extra bed: anything to add to this room’s bill.</T>
          {stay.stay_charges.map((c) => (
            <View key={c.id} style={st.charge}>
              <View style={{ flex: 1 }}><T w="bold">{c.description}</T><T style={{ color: C.muted, fontSize: 11.5 }}>{c.quantity} × {rs(c.unit_price)}</T></View>
              <T w="heavy">{rs(c.quantity * c.unit_price)}</T>
              <Pressable hitSlop={10} onPress={() => run('del', () => q(sb.from('stay_charges').delete().eq('id', c.id)))} accessibilityLabel={`Remove ${c.description}`}>
                <T w="heavy" style={{ color: C.danger, fontSize: 16 }}>✕</T>
              </Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Field label="Item" value={charge.description} onChangeText={(v) => setCharge({ ...charge, description: v })} placeholder="Breakfast" style={{ flex: 2.2 }} />
            <Field label="Qty" value={charge.quantity} onChangeText={(v) => setCharge({ ...charge, quantity: v })} keyboardType="number-pad" style={{ flex: 0.8 }} />
            <Field label="₹ each" value={charge.price} onChangeText={(v) => setCharge({ ...charge, price: v })} keyboardType="decimal-pad" style={{ flex: 1.2 }} />
          </View>
          <Button kind="secondary" small title="Add Charge" onPress={addCharge} busy={busy === 'charge'} />
        </Card>
      </>) : null}

      <View style={st.paper}>
        <View style={{ alignItems: 'center' }}>
          <M style={{ fontSize: 17, fontWeight: '700' }}>{settings.hotel_name}</M>
          {settings.hotel_address ? <M style={{ textAlign: 'center' }}>{settings.hotel_address}</M> : null}
          {settings.hotel_phone ? <M>Ph {settings.hotel_phone}</M> : null}
        </View>
        <View style={st.rule} />
        <KV k={stay.bill_no ? `Bill: ${stay.bill_no}` : 'Room bill'} v={`Room: ${stay.lodging_rooms?.number ?? ''}`} />
        <KV k={`${shortDate(stay.check_in)} → ${shortDate(stay.check_out)}`} v={`${nights} night${nights === 1 ? '' : 's'}`} />
        <View style={st.rule} />
        {b.lines.map((l, i) => <KV key={i} k={`${l.quantity} ${l.name}`} v={fmt(l.quantity * l.unitPrice)} />)}
        <View style={st.rule} />
        {b.discount || b.tax || b.roundOff ? (<>
          <KV k="Subtotal" v={fmt(b.subtotal)} />
          {b.discount ? <KV k="Discount" v={`-${fmt(b.discount)}`} /> : null}
          {b.tax ? (<><KV k={`CGST ${pct(rate / 2)}`} v={fmt(b.cgst)} /><KV k={`SGST ${pct(rate / 2)}`} v={fmt(b.sgst)} /></>) : null}
          {b.roundOff ? <KV k="Round off" v={fmt(b.roundOff)} /> : null}
        </>) : null}
        <KV k="TOTAL" v={rs(b.total)} big />
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button kind="secondary" title="Print" style={{ flex: 1 }} onPress={print} busy={busy === 'print'} />
        {!paid ? <Button title={`Check Out · ${rs(b.total)}`} style={{ flex: 2 }} onPress={() => setPaying(true)} /> : null}
      </View>
      {!paid ? <Button kind="danger" small title="Cancel Check-in" onPress={cancel} /> : null}

      <Sheet open={paying} onClose={() => setPaying(false)} title={`Check Out · Room ${stay.lodging_rooms?.number ?? ''}`}>
        <View style={st.charge}><T style={{ color: C.muted, flex: 1 }}>Amount to collect</T><T w="heavy" style={{ fontSize: 18 }}>{rs(b.total)}</T></View>
        <View style={{ flexDirection: 'row' }}>{METHODS.map((m) => <Chip key={m} label={m} on={method === m} onPress={() => setMethod(m)} />)}</View>
        <Button title="Mark as Paid" onPress={checkout} busy={busy === 'pay'} />
      </Sheet>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  paper: { backgroundColor: '#FFFFFF', borderRadius: 6, padding: 14, borderWidth: 1, borderColor: C.line },
  rule: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#8A7F78', marginVertical: 8 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  charge: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface2, borderRadius: 10, padding: 10 },
});

import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { computeBill, fmt, rs, toPaise } from '../money';
import { useAppSelector } from '../store';
import { q, sb } from '../supabase';
import type { OrderItem } from '../types';
import { Button, Chip, Field, Sheet, T } from '../ui/kit';
import { C, F } from '../ui/theme';
import { toast } from '../ui/toast';
import { billsChanged } from './BillsScreen';

type Line = { menu_item_id: number | null; name: string; unit_price: number; quantity: number };
const METHODS = ['Cash', 'UPI', 'Card'];

/** Owner changes a paid bill: quantities, dishes, discount, payment. Saved with a reason in the change log (edit_paid_bill). */
export function EditBillSheet({ open, onClose, onSaved, order, rate }: {
  open: boolean; onClose: () => void; onSaved: () => void;
  order: { id: number; bill_no: string | null; discount: number; payment_method: string | null; items: OrderItem[] }; rate: number;
}) {
  const menu = useAppSelector((s) => s.data.menu);
  const [items, setItems] = useState<Line[]>(() => order.items.map((i) => ({ menu_item_id: i.menu_item_id, name: i.name, unit_price: i.unit_price, quantity: i.quantity })));
  const [discount, setDiscount] = useState(order.discount ? fmt(order.discount).replace(/,/g, '') : '');
  const [method, setMethod] = useState(order.payment_method ?? 'Cash');
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  let disc = 0;
  try { disc = toPaise(discount); } catch { /* shown on save */ }
  const lines = (list: Line[]) => list.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price }));
  const now = computeBill(lines(items), disc, rate).total;
  const was = computeBill(order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), order.discount, rate).total;

  const step = (n: number, d: number) => setItems((list) => list.flatMap((i, k) => (k !== n ? [i] : i.quantity + d < 1 ? [] : [{ ...i, quantity: i.quantity + d }])));
  const add = (id: number) => {
    const m = menu.find((x) => x.id === id)!;
    setItems((list) => (list.some((i) => i.menu_item_id === id)
      ? list.map((i) => (i.menu_item_id === id ? { ...i, quantity: i.quantity + 1 } : i))
      : [...list, { menu_item_id: m.id, name: m.name, unit_price: m.price, quantity: 1 }]));
    setAdding(false);
  };
  const save = async () => {
    if (!items.length) return toast('A bill needs at least one item. To remove the whole bill, use Delete.', true);
    let d: number;
    try { d = toPaise(discount); } catch (err) { return toast((err as Error).message, true); }
    setBusy(true);
    try {
      await q(sb.rpc('edit_paid_bill', { p_order_id: order.id, p_items: items, p_discount: d, p_method: method, p_reason: reason.trim() }));
      billsChanged.current = true;
      toast(`Bill ${order.bill_no} updated · saved in the change log`);
      onSaved();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Edit Bill ${order.bill_no ?? ''}`}>
      {items.map((i, n) => (
        <View key={`${i.menu_item_id}-${i.name}`} style={st.line}>
          <View style={{ flex: 1 }}><T w="bold">{i.name}</T><T style={{ color: C.muted, fontSize: 11.5 }}>{rs(i.unit_price)} each</T></View>
          <View style={st.stepper}>
            <Pressable hitSlop={8} onPress={() => step(n, -1)} style={st.stepBtn}><T w="heavy" style={st.stepTxt}>−</T></Pressable>
            <T w="heavy" style={{ minWidth: 22, textAlign: 'center' }}>{i.quantity}</T>
            <Pressable hitSlop={8} onPress={() => step(n, 1)} style={st.stepBtn}><T w="heavy" style={st.stepTxt}>+</T></Pressable>
          </View>
        </View>
      ))}
      {adding ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {menu.map((m) => <Chip key={m.id} label={`${m.name} · ${rs(m.price).replace('.00', '')}`} onPress={() => add(m.id)} />)}
        </View>
      ) : <Button kind="secondary" small title="＋ Add a dish" onPress={() => setAdding(true)} />}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <Field label="Discount (₹)" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <T style={{ color: C.muted, fontSize: 11.5 }}>New total</T>
          <T w="heavy" style={{ fontSize: 19 }}>{rs(now)}</T>
          <T style={{ color: C.muted, fontSize: 11.5 }}>was {rs(was)}</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>{METHODS.map((m) => <Chip key={m} label={m} on={method === m} onPress={() => setMethod(m)} />)}</View>
      <Field label="Reason for the change" value={reason} onChangeText={setReason} placeholder="e.g. Customer returned Lassi" maxLength={200} />
      <Button title="Save Changes" onPress={save} busy={busy} />
    </Sheet>
  );
}

/** Delete a paid bill: the owner types the word "delete" to confirm (a full copy stays in the change log). */
export function DeleteBillSheet({ open, onClose, onDeleted, orderId, billNo, total }: {
  open: boolean; onClose: () => void; onDeleted: () => void; orderId: number; billNo: string | null; total: number;
}) {
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = word.trim().toLowerCase() === 'delete';
  const del = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await q(sb.rpc('delete_paid_bill', { p_order_id: orderId, p_reason: 'Deleted by owner' }));
      billsChanged.current = true;
      toast(`Bill ${billNo} deleted`);
      onDeleted();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Delete Bill ${billNo ?? ''}?`}>
      <View style={st.line}><T style={{ color: C.muted, flex: 1 }}>Bill total</T><T w="heavy">{rs(total)}</T></View>
      <TextInput value={word} onChangeText={setWord} autoCapitalize="none" autoCorrect={false} secureTextEntry autoFocus
        placeholder="Confirmation word" placeholderTextColor="#A89A90" style={st.word} accessibilityLabel="Confirmation word" onSubmitEditing={del} />
      <Button kind="danger" title="Delete Bill" onPress={del} busy={busy} disabled={!ok} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  word: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 12, fontFamily: F.semibold, fontSize: 15, color: C.text },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { color: C.accent, fontSize: 17 },
});

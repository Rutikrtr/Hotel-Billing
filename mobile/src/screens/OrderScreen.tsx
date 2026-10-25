import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeBill, fmt, rs, rsShort, toPaise } from '../money';
import { billSlip, kotSlip, parcelKitchenSlip, tokenNo } from '../printing/escpos';
import { paperOf, printSlips } from '../printing';
import { generateBill, markKot, saveOrder, settle, store, useAppDispatch, useAppSelector, type Payment, type Where } from '../store';
import { loginName } from '../store/auth';
import { change, hasPending, mergeLines, setDiscount, type Line } from '../store/cart';
import { parcelKey, tableKey, type Order } from '../types';
import { Button, Chip, Diet, T } from '../ui/kit';
import { C, F } from '../ui/theme';
import { MicButton } from '../ui/Mic';
import { findDishes } from '../match';
import { toast } from '../ui/toast';
import type { Stack } from '../Root';

type Method = 'Cash' | 'UPI' | 'Card';
const METHODS: Method[] = ['Cash', 'UPI', 'Card'];
type PayState = { method: Method | 'Split'; parts: Record<Method, string> };

export default function OrderScreen() {
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const { params } = useRoute<RouteProp<Stack, 'Order'>>();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const parcel = params.parcelId !== undefined;
  const [parcelId, setParcelId] = useState<number | null>(params.parcelId ?? null);
  const section = params.section ?? 'A';
  const key = parcel ? parcelKey(parcelId) : tableKey(params.tableId as number, section);
  const where: Where = { key, tableId: parcel ? null : (params.tableId as number), section, parcel };

  const { menu, tables, settings } = useAppSelector((s) => s.data);
  const order = useAppSelector((s) => s.data.orders[key]) as Order | undefined;
  const cart = useAppSelector((s) => s.cart[key]);
  const account = useAppSelector((s) => s.auth.account);
  const email = useAppSelector((s) => s.auth.email);
  const printer = useAppSelector((s) => s.printer);
  const canBill = account?.can_bill === true;
  const rate = settings?.tax_rate_bp ?? 0;
  const table = tables.find((t) => t.id === params.tableId);
  // Sections: different groups sharing one table each get their own order and bill (A, B, C…), like the web app.
  const allOrders = useAppSelector((s) => s.data.orders);
  const carts = useAppSelector((s) => s.cart);
  const sections = useMemo(() => {
    if (parcel) return ['A'];
    const prefix = `t:${params.tableId}:`;
    const fromOrders = Object.values(allOrders).filter((o) => !o.is_parcel && o.table_id === params.tableId).map((o) => o.section);
    const fromCarts = Object.keys(carts).filter((k) => k.startsWith(prefix) && hasPending(carts[k])).map((k) => k.slice(prefix.length));
    return [...new Set([...fromOrders, ...fromCarts, section])].sort();
  }, [allOrders, carts, section, parcel, params.tableId]);
  const multi = sections.length > 1;
  const label = parcel ? (order?.bill_no ? `Parcel #${tokenNo(order.bill_no)}` : 'Parcel') : `${table?.name ?? 'Table'}${multi || order?.is_split || section !== 'A' ? `-${section}` : ''}`;
  const sectionTotal = (x: string) => {
    const o = allOrders[tableKey(params.tableId as number, x)];
    return o ? computeBill(o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), o.discount, settings?.tax_rate_bp ?? 0).total : null;
  };
  // Switching section: unsaved taps of this section are saved first (in the background).
  const goSection = (x: string) => {
    if (hasPending(store.getState().cart[key])) dispatch(saveOrder(where)).unwrap().catch(() => toast(`${label}: not saved yet (no internet). It will stay on this phone.`, true));
    setSheet(false);
    nav.setParams({ section: x });
  };
  const addSection = () => {
    const next = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((x) => !sections.includes(x));
    if (!next) { toast('This table already has the most sections it can.', true); return; }
    goSection(next);
    toast(`Section ${next} added · take the second group’s order`);
  };

  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Order | null>(null);
  const [payment, setPayment] = useState<PayState>({ method: 'Cash', parts: { Cash: '', UPI: '', Card: '' } });

  const lines = useMemo(() => mergeLines(order, cart, menu), [order, cart, menu]);
  const qtyOf = (menuId: number) => lines.find((l) => l.menuId === menuId)?.quantity ?? 0;
  const discount = cart?.discount ?? order?.discount ?? 0;
  const bill = computeBill(lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice })), discount, rate);
  const pending = hasPending(cart);
  const kotOn = !parcel && settings?.kot_tables === true;
  const toKitchen = lines.filter((l) => l.quantity !== l.kotQty);

  const hasItems = lines.length > 0;
  useEffect(() => {
    nav.setOptions({
      title: parcel ? `Parcel${order?.bill_no ? ` #${tokenNo(order.bill_no)}` : ''}` : label,
      headerRight: parcel || !hasItems ? undefined : () => (
        <Pressable onPress={addSection} hitSlop={8} style={st.addSection} accessibilityRole="button" accessibilityLabel="Add a section for another group">
          <T w="bold" style={{ color: C.accent, fontSize: 13 }}>＋ Section</T>
        </Pressable>
      ),
    });
  }, [label, hasItems, sections.join('')]);

  // Leaving with unsaved taps: save them in the background (they stay on the phone if there is no internet).
  useEffect(() => nav.addListener('beforeRemove', () => {
    if (hasPending(store.getState().cart[key])) {
      dispatch(saveOrder(where)).unwrap().then(() => toast(`${label} saved`), () => toast(`${label}: not saved yet (no internet). It will stay on this phone.`, true));
    }
  }), [nav, key]);

  const categories = useMemo(() => ['All', ...new Set(menu.map((m) => m.category))], [menu]);
  const shown = useMemo(() => {
    // Search finds dishes by sound too ("chin biryani" → Chicken Biryani), best match first.
    if (search.trim()) return findDishes(search, menu);
    const list = menu.filter((m) => filter === 'All' || m.category === filter);
    return [...list].sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));
  }, [menu, filter, search]);

  const tap = useCallback((menuId: number, delta: number) => {
    dispatch(change({ key, menuId, delta, current: qtyOf(menuId) }));
  }, [key, lines]);

  /** Run a step with a busy button; errors become a clear alert. */
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (err) { Alert.alert('Couldn’t finish', (err as Error).message); } finally { setBusy(null); }
  };
  const save = async () => {
    const saved = await dispatch(saveOrder(where)).unwrap();
    if (parcel && saved && !parcelId) setParcelId(saved.id);
    return saved;
  };
  const paper = paperOf(printer);

  const onSave = () => run('save', async () => { await save(); toast(`${label} saved`); setSheet(false); nav.goBack(); });

  const onKitchen = () => run('kot', async () => {
    const saved = await save();
    if (!saved) return;
    const changes = saved.items.filter((i) => i.quantity !== i.kot_qty).map((i) => ({ name: i.name, quantity: i.quantity - i.kot_qty }));
    if (!changes.length) { toast('Kitchen already has the full order'); return; }
    if (printer.bill) await printSlips(printer, [kotSlip(paper, label, changes, saved.items.some((i) => i.kot_qty > 0), loginName(email))]);
    await dispatch(markKot(saved.id)).unwrap();
    toast(printer.bill ? `Sent to kitchen · ${label}` : `Marked as sent · no printer set up on this phone`);
    setSheet(false);
  });

  /** The chosen payment as the server wants it, or an error message when a split doesn't add up. */
  const paymentFor = (total: number): Payment | string => {
    if (payment.method !== 'Split') return { method: payment.method };
    const split: Partial<Record<Method, number>> = {};
    try { for (const m of METHODS) { const v = toPaise(payment.parts[m]); if (v) split[m] = v; } } catch (err) { return (err as Error).message; }
    const sum = Object.values(split).reduce((n, v) => n + (v ?? 0), 0);
    if (Object.keys(split).length < 2) return 'For a split, enter the amount for at least two ways of paying.';
    if (sum !== total) return `The parts add up to ${rs(sum)}, but the bill is ${rs(total)}.`;
    return { method: 'Split', split };
  };

  /** Print the customer's bill on this phone's printer; for a parcel, the kitchen copy too (see printParcel). */
  const printBill = async (o: Order, billNo: string, pay: Payment | null) => {
    if (!settings) return;
    const meta = { method: pay?.method ?? null, split: pay?.method === 'Split' ? pay.split : null };
    const billSlips = [billSlip(paper, o, settings, label, billNo, pay?.method ?? null, meta)];
    if (!printer.bill) { toast(`Bill ${billNo} saved · no printer set up on this phone`, true); return; }
    const kitchenPrinter = printer.separateKitchen && printer.kitchen;
    // Parcel with a kitchen printer: the kitchen copy goes straight there with the bill.
    if (o.is_parcel && kitchenPrinter) billSlips.push(parcelKitchenSlip(paper, o, billNo));
    try {
      const failed = await printSlips(printer, billSlips);
      if (failed.length) toast(failed[0], true);
    } catch (err) { toast(`Bill ${billNo} saved, but printing failed: ${(err as Error).message}`, true); return; }
    // Parcel without a kitchen printer: customer's bill first, then offer the kitchen copy on the same printer.
    if (o.is_parcel && !kitchenPrinter) {
      await new Promise<void>((done) => Alert.alert('Kitchen copy', `Print the kitchen copy for Parcel #${tokenNo(billNo)} now? Tear off the customer's bill first.`, [
        { text: 'Skip', style: 'cancel', onPress: () => done() },
        { text: 'Print', onPress: () => { printSlips(printer, [parcelKitchenSlip(paper, o, billNo)]).catch((err) => toast((err as Error).message, true)).finally(done); } },
      ], { cancelable: false }));
    }
  };

  const onPrintBill = () => run('bill', async () => {
    const saved = await save();
    if (!saved || !settings) return;
    const quick = settings.quick_close !== false;
    if (quick) {
      const total = computeBill(saved.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), saved.discount, rate).total;
      const pay = paymentFor(total);
      if (typeof pay === 'string') { toast(pay, true); return; }
      const billNo = await dispatch(settle({ order: saved, ...pay })).unwrap();
      setSheet(false);
      await printBill(saved, billNo, pay);
      toast(saved.is_parcel ? `Parcel #${tokenNo(billNo)} done` : `Bill ${billNo} done · ${label} is free`);
      nav.goBack();
    } else {
      const billNo = await dispatch(generateBill(saved)).unwrap();
      await printBill(saved, billNo, null);
      setPayFor({ ...saved, bill_no: billNo });
    }
  });

  const pay = () => run('pay', async () => {
    const o = payFor ?? order;
    if (!o) return;
    const total = computeBill(o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), o.discount, rate).total;
    const p = paymentFor(total);
    if (typeof p === 'string') { toast(p, true); return; }
    const billNo = await dispatch(settle({ order: o, ...p })).unwrap();
    toast(`Paid by ${p.method === 'Split' ? Object.keys(p.split).join(' + ') : p.method} · bill ${billNo}`);
    setPayFor(null);
    setSheet(false);
    nav.goBack();
  });

  const renderDish = ({ item: m }: { item: (typeof menu)[number] }) => {
    const n = qtyOf(m.id);
    return (
      <View style={[st.dish, n > 0 && st.dishOn, !m.available && { opacity: 0.5 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Diet veg={m.is_veg} />
            <T w="bold" style={{ flex: 1, fontSize: 14.5 }} numberOfLines={2}>{m.name}{m.is_favorite ? '  ★' : ''}</T>
          </View>
          <T w="bold" style={{ color: C.muted, fontSize: 13 }}>{rsShort(m.price)}{!m.available ? ' · sold out' : ''}</T>
        </View>
        {!m.available ? null : n === 0 ? (
          <Pressable onPress={() => tap(m.id, 1)} style={st.add} hitSlop={6} accessibilityLabel={`Add ${m.name}`}>
            <T w="heavy" style={{ color: C.accent, fontSize: 13.5, letterSpacing: 0.6 }}>ADD</T>
          </Pressable>
        ) : <Stepper n={n} onMinus={() => tap(m.id, -1)} onPlus={() => tap(m.id, 1)} name={m.name} />}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={st.tools}>
        {multi ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 6 }}>
            {sections.map((x) => {
              const total = sectionTotal(x);
              return (
                <Pressable key={x} onPress={() => x !== section && goSection(x)} style={[st.secTab, x === section && st.secOn]} accessibilityRole="tab" accessibilityState={{ selected: x === section }}>
                  <T w="heavy" style={{ fontSize: 13, color: x === section ? '#FFFFFF' : C.text }}>Section {x}</T>
                  <T w="semibold" style={{ fontSize: 11.5, color: x === section ? '#FFFFFF' : C.muted }}>{total != null ? rsShort(total) : 'New'}</T>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search or tap the mic and say a dish" placeholderTextColor="#A39589" style={[st.search, { flex: 1 }]} accessibilityLabel="Search dishes" />
          <MicButton onText={setSearch} hints={menu.map((m) => m.name)} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} keyboardShouldPersistTaps="handled">
          {categories.map((c) => <Chip key={c} label={c} on={!search && filter === c} onPress={() => { setSearch(''); setFilter(c); }} />)}
        </ScrollView>
      </View>
      <FlatList
        data={shown} keyExtractor={(m) => String(m.id)} renderItem={renderDish}
        contentContainerStyle={{ padding: 12, paddingBottom: 110 }} keyboardShouldPersistTaps="handled"
        initialNumToRender={14} windowSize={7} removeClippedSubviews
      />
      {lines.length ? (
        <Pressable onPress={() => setSheet(true)} style={[st.bar, { bottom: 10 + insets.bottom }]} accessibilityRole="button">
          <View style={{ flex: 1 }}>
            <T w="semibold" style={{ color: '#FFFFFF', opacity: 0.8, fontSize: 12 }}>{bill.itemCount} items · {label}{pending ? ' · not saved' : ''}</T>
            <T w="heavy" style={{ color: '#FFFFFF', fontSize: 17 }}>{rs(bill.total)}</T>
          </View>
          <View style={st.barBtn}><T w="bold" style={{ color: '#FFFFFF' }}>View Order ›</T></View>
        </Pressable>
      ) : null}

      <Modal visible={sheet || !!payFor} transparent animationType="slide" onRequestClose={() => { setSheet(false); setPayFor(null); }}>
        <Pressable style={st.backdrop} onPress={() => { if (!busy) { setSheet(false); setPayFor(null); } }} />
        <View style={[st.sheet, { paddingBottom: 14 + insets.bottom }]}>
          <View style={st.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <T w="heavy" style={{ fontSize: 19 }}>{payFor ? 'Receive payment' : 'Order'}</T>
              <T style={{ color: C.muted, fontSize: 12.5 }}>{label} · {bill.itemCount} items</T>
            </View>
            <Pressable onPress={() => { setSheet(false); setPayFor(null); }} hitSlop={10}><T w="bold" style={{ color: C.accent }}>Done</T></Pressable>
          </View>
          {payFor ? (
            <View style={{ padding: 16, gap: 10 }}>
              <T w="heavy" style={{ fontSize: 30, textAlign: 'center' }}>{rs(computeBill(payFor.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), payFor.discount, rate).total)}</T>
              <PayPicker value={payment} onChange={setPayment} total={computeBill(payFor.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), payFor.discount, rate).total} />
              <Button title="Mark as Paid" onPress={pay} busy={busy === 'pay'} />
            </View>
          ) : (
            <>
              <ScrollView style={{ maxHeight: 330 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
                {lines.map((l) => <OrderLine key={`${l.menuId}-${l.name}`} l={l} kotOn={kotOn} onTap={(d) => l.menuId && tap(l.menuId, d)} />)}
              </ScrollView>
              <View style={st.totals}>
                <Row k="Subtotal" v={fmt(bill.subtotal)} />
                {canBill ? <DiscountRow value={discount} onChange={(p) => dispatch(setDiscount({ key, discount: p }))} /> : null}
                {bill.tax ? <><Row k={`CGST ${rate / 200}%`} v={fmt(bill.cgst)} /><Row k={`SGST ${rate / 200}%`} v={fmt(bill.sgst)} /></> : null}
                {bill.roundOff ? <Row k="Round off" v={fmt(bill.roundOff)} /> : null}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <T w="heavy" style={{ fontSize: 20 }}>Total</T><T w="heavy" style={{ fontSize: 20, color: C.accent }}>{rs(bill.total)}</T>
                </View>
                {canBill && settings?.quick_close !== false && !order?.billed_at ? <PayPicker value={payment} onChange={setPayment} total={bill.total} /> : null}
              </View>
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                {kotOn && toKitchen.length ? <Button kind="dark" title={`Send to Kitchen · ${toKitchen.reduce((n, l) => n + Math.abs(l.quantity - l.kotQty), 0)} items`} onPress={onKitchen} busy={busy === 'kot'} disabled={!!busy && busy !== 'kot'} /> : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {canBill ? (order?.billed_at && settings?.quick_close === false
                    ? <Button kind="secondary" title="Receive Payment" onPress={() => setPayFor(order)} style={{ flex: 1 }} disabled={!!busy || pending} />
                    : <Button kind="secondary" title="Print Bill" onPress={onPrintBill} busy={busy === 'bill'} disabled={!!busy && busy !== 'bill'} style={{ flex: 1 }} />) : null}
                  <Button title={pending ? 'Save Order' : 'Saved ✓'} onPress={onSave} busy={busy === 'save'} disabled={!pending || (!!busy && busy !== 'save')} style={{ flex: 1.4 }} />
                </View>
                {!canBill ? <T style={{ color: C.muted, fontSize: 12.5, textAlign: 'center' }}>The manager prints the bill and takes payment.</T> : null}
              </View>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

function Stepper({ n, onMinus, onPlus, name }: { n: number; onMinus: () => void; onPlus: () => void; name: string }) {
  return (
    <View style={st.stepper}>
      <Pressable onPress={onMinus} hitSlop={8} style={st.stepBtn} accessibilityLabel={`Remove one ${name}`}><T w="heavy" style={st.stepTxt}>−</T></Pressable>
      <T w="heavy" style={{ color: '#FFFFFF', minWidth: 22, textAlign: 'center' }}>{n}</T>
      <Pressable onPress={onPlus} hitSlop={8} style={st.stepBtn} accessibilityLabel={`Add one ${name}`}><T w="heavy" style={st.stepTxt}>+</T></Pressable>
    </View>
  );
}

function OrderLine({ l, kotOn, onTap }: { l: Line; kotOn: boolean; onTap: (d: number) => void }) {
  const note = l.pending ? `${l.pending > 0 ? '+' : ''}${l.pending} not saved` : kotOn && l.quantity > l.kotQty ? `+${l.quantity - l.kotQty} for kitchen` : kotOn && l.kotQty ? '✓ sent' : '';
  return (
    <View style={st.line}>
      <View style={{ flex: 1 }}>
        <T w="bold">{l.name}</T>
        <T style={{ color: C.muted, fontSize: 12 }}>{rs(l.unitPrice)} each{note ? ` · ${note}` : ''}</T>
      </View>
      <T w="heavy" style={{ marginRight: 10 }}>{rsShort(l.unitPrice * l.quantity)}</T>
      {l.menuId ? <Stepper n={l.quantity} onMinus={() => onTap(-1)} onPlus={() => onTap(1)} name={l.name} /> : <T w="heavy">×{l.quantity}</T>}
    </View>
  );
}

/** How the customer pays: one tap for Cash / UPI / Card, or Split with an amount for each. */
function PayPicker({ value, onChange, total }: { value: PayState; onChange: (v: PayState) => void; total: number }) {
  let sum = 0;
  for (const m of METHODS) { try { sum += toPaise(value.parts[m]); } catch { /* shown on pay */ } }
  const left = total - sum;
  const setPart = (m: Method, text: string) => onChange({ ...value, parts: { ...value.parts, [m]: text } });
  return (
    <View style={{ marginTop: 8, gap: 8 }}>
      <View style={st.payRow}>
        {([...METHODS, 'Split'] as const).map((m) => (
          <Pressable key={m} onPress={() => onChange({ ...value, method: m })} style={[st.payOpt, value.method === m && st.payOn]} accessibilityRole="radio" accessibilityState={{ checked: value.method === m }}>
            <T w="bold" style={{ fontSize: 13.5, color: value.method === m ? '#FFFFFF' : C.text }}>{m}</T>
          </Pressable>
        ))}
      </View>
      {value.method === 'Split' ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {METHODS.map((m) => (
              <View key={m} style={{ flex: 1, gap: 3 }}>
                <T w="semibold" style={{ fontSize: 11.5, color: C.muted }}>{m} (₹)</T>
                <TextInput value={value.parts[m]} onChangeText={(v) => setPart(m, v)} keyboardType="decimal-pad" placeholder="0" style={st.part} accessibilityLabel={`${m} amount`}
                  onFocus={() => { if (!value.parts[m] && left > 0 && METHODS.some((x) => x !== m && value.parts[x])) setPart(m, String(left / 100)); }} />
              </View>
            ))}
          </View>
          <T w="semibold" style={{ fontSize: 12, color: left === 0 ? C.free : C.danger }}>{left === 0 ? '✓ Adds up to the total' : left > 0 ? `${rs(left)} still to split` : `${rs(-left)} more than the total`}</T>
        </View>
      ) : null}
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T style={{ color: C.muted }}>{k}</T><T w="semibold">{v}</T></View>;
}

function DiscountRow({ value, onChange }: { value: number; onChange: (p: number | null) => void }) {
  const [text, setText] = useState(value ? String(value / 100) : '');
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <T style={{ color: C.muted }}>Discount (₹)</T>
      <TextInput
        value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="0" style={st.discount} accessibilityLabel="Discount in rupees"
        onEndEditing={() => { try { onChange(toPaise(text)); } catch { Alert.alert('Discount', 'Enter an amount like 50 or 20.50'); } }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  tools: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.line },
  search: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 14, fontSize: 15, fontFamily: F.regular, color: C.text },
  dish: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 10, paddingLeft: 12, marginBottom: 7, minHeight: 56 },
  dishOn: { borderColor: '#EFB08A', backgroundColor: '#FFF7F1' },
  add: { minWidth: 72, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: C.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 10, backgroundColor: C.brand1 },
  stepBtn: { width: 34, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { color: '#FFFFFF', fontSize: 19 },
  bar: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: C.ink, borderRadius: 16, padding: 8, paddingLeft: 16, elevation: 10 },
  barBtn: { backgroundColor: C.brand1, borderRadius: 12, paddingHorizontal: 14, height: 42, justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(31,22,17,0.45)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 10 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  totals: { padding: 16, paddingTop: 10, gap: 3 },
  addSection: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: C.accentSoft },
  secTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, minWidth: 92 },
  secOn: { backgroundColor: C.ink, borderColor: C.ink },
  payRow: { flexDirection: 'row', gap: 6 },
  payOpt: { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  payOn: { backgroundColor: C.accent, borderColor: C.accent },
  part: { minHeight: 38, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 10, fontFamily: F.semibold, color: C.text, textAlign: 'right' },
  discount: { width: 96, minHeight: 36, borderWidth: 1, borderColor: C.line, borderRadius: 10, textAlign: 'right', paddingHorizontal: 10, fontFamily: F.semibold, color: C.text },
});

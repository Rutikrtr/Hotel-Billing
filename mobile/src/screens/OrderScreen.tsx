import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeBill, fmt, rs, rsShort, toPaise } from '../money';
import { billSlip, kotSlip, parcelKitchenSlip, tokenNo } from '../printing/escpos';
import { paperOf, printSlips } from '../printing';
import { generateBill, markKot, saveOrder, settle, store, useAppDispatch, useAppSelector, type Where } from '../store';
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
  const label = parcel ? (order?.bill_no ? `Parcel #${tokenNo(order.bill_no)}` : 'Parcel') : `${table?.name ?? 'Table'}${section !== 'A' ? `-${section}` : ''}`;

  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Order | null>(null);

  const lines = useMemo(() => mergeLines(order, cart, menu), [order, cart, menu]);
  const qtyOf = (menuId: number) => lines.find((l) => l.menuId === menuId)?.quantity ?? 0;
  const discount = cart?.discount ?? order?.discount ?? 0;
  const bill = computeBill(lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice })), discount, rate);
  const pending = hasPending(cart);
  const kotOn = !parcel && settings?.kot_tables === true;
  const toKitchen = lines.filter((l) => l.quantity !== l.kotQty);

  useEffect(() => { nav.setOptions({ title: parcel ? `🛍 ${label}` : label }); }, [label]);

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

  const onPrintBill = () => run('bill', async () => {
    const saved = await save();
    if (!saved || !settings) return;
    const quick = settings.quick_close !== false;
    const billNo = quick ? await dispatch(settle({ order: saved, method: 'Cash' })).unwrap() : await dispatch(generateBill(saved)).unwrap();
    const slips = [billSlip(paper, saved, settings, label, billNo, quick ? 'Cash' : null)];
    if (saved.is_parcel) slips.push(parcelKitchenSlip(paper, saved, billNo));
    if (printer.bill) {
      try {
        const failed = await printSlips(printer, slips);
        if (failed.length) toast(failed[0], true);
      } catch (err) { toast(`Bill ${billNo} saved, but printing failed: ${(err as Error).message}`, true); }
    } else toast(`Bill ${billNo} saved · no printer set up on this phone`, true);
    setSheet(false);
    if (quick) { toast(saved.is_parcel ? `Parcel #${tokenNo(billNo)} done` : `Bill ${billNo} done · ${label} is free`); nav.goBack(); }
    else setPayFor({ ...saved, bill_no: billNo });
  });

  const pay = (method: Method) => run('pay', async () => {
    const o = payFor ?? order;
    if (!o) return;
    const billNo = await dispatch(settle({ order: o, method })).unwrap();
    toast(`Paid by ${method} · bill ${billNo}`);
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
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['Cash', 'UPI', 'Card'] as Method[]).map((m) => <Button key={m} title={m} onPress={() => pay(m)} busy={busy === 'pay'} style={{ flex: 1 }} />)}
              </View>
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
  discount: { width: 96, minHeight: 36, borderWidth: 1, borderColor: C.line, borderRadius: 10, textAlign: 'right', paddingHorizontal: 10, fontFamily: F.semibold, color: C.text },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore, createAsyncThunk } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import { q, sb } from '../supabase';
import { keyOf, type Order, type OrderKey } from '../types';
import auth from './auth';
import cart, { restoreCart, saved, type Cart } from './cart';
import data, { orderClosed, orderSaved } from './data';
import printer, { restorePrinter } from './printer';

export const store = configureStore({ reducer: { auth, data, cart, printer } });
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// Unsaved orders and printer choices survive the app being closed.
const KEYS = { cart: 'mb-cart-v1', printer: 'mb-printer-v1' };
export async function restoreFromPhone() {
  try {
    const [c, p] = await Promise.all([AsyncStorage.getItem(KEYS.cart), AsyncStorage.getItem(KEYS.printer)]);
    if (c) store.dispatch(restoreCart(JSON.parse(c)));
    if (p) store.dispatch(restorePrinter(JSON.parse(p)));
  } catch { /* first run or storage cleared */ }
}
let lastCart: unknown; let lastPrinter: unknown;
store.subscribe(() => {
  const s = store.getState();
  if (s.cart !== lastCart) { lastCart = s.cart; AsyncStorage.setItem(KEYS.cart, JSON.stringify(s.cart)).catch(() => {}); }
  if (s.printer !== lastPrinter) { lastPrinter = s.printer; AsyncStorage.setItem(KEYS.printer, JSON.stringify(s.printer)).catch(() => {}); }
});

export interface Where { key: OrderKey; tableId: number | null; section: string; parcel: boolean }

/** Save the order: every unsaved tap in one request. Returns the server's copy of the order (or null if empty). */
export const saveOrder = createAsyncThunk<Order | null, Where, { state: RootState }>('orders/save', async (w, api) => {
  const { cart: carts, data: d } = api.getState();
  const existing = d.orders[w.key];
  const c: Cart | undefined = carts[w.key];
  if (!c || (!Object.keys(c.changes).length && c.discount === null)) return existing ?? null;
  const sent: Cart = { changes: { ...c.changes }, discount: c.discount };
  const order = await q<Order | null>(sb.rpc('order_save', {
    p_order_id: existing?.id ?? null, p_table_id: w.tableId, p_section: w.section, p_parcel: w.parcel,
    p_changes: Object.entries(sent.changes).map(([menu_item_id, delta]) => ({ menu_item_id: Number(menu_item_id), delta })),
    p_discount: sent.discount,
  }));
  if (order) api.dispatch(orderSaved(order));
  api.dispatch(saved({ key: w.key, newKey: order ? keyOf(order) : w.key, sent }));
  return order;
});

/** After the kitchen ticket printed: mark everything as sent (1 request). */
export const markKot = createAsyncThunk('orders/markKot', async (orderId: number, api) => {
  const order = await q<Order>(sb.rpc('order_mark_kot', { p_order_id: orderId }));
  api.dispatch(orderSaved(order));
  return order;
});

/** Finish the bill: the table is freed. Returns the bill number. */
export const settle = createAsyncThunk('orders/settle', async (p: { order: Order; method: 'Cash' | 'UPI' | 'Card' }, api) => {
  const billNo = await q<string>(sb.rpc('settle_order', { p_order_id: p.order.id, p_method: p.method }));
  api.dispatch(orderClosed(keyOf(p.order)));
  return billNo;
});

/** Print the bill but keep the table open until payment (when "Print Bill clears the table" is off). */
export const generateBill = createAsyncThunk('orders/generateBill', async (order: Order, api) => {
  const billNo = await q<string>(sb.rpc('generate_bill', { p_order_id: order.id }));
  api.dispatch(orderSaved({ ...order, bill_no: billNo, billed_at: new Date().toISOString() }));
  return billNo;
});

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MenuItem, Order, OrderKey } from '../types';

/**
 * Unsaved changes per order, kept on the phone: taps cost no internet at all.
 * changes: menu item id -> +/- amount since the last save. Saved to phone storage, so nothing is lost if the app closes.
 */
export interface Cart { changes: Record<string, number>; discount: number | null }
type CartState = Record<OrderKey, Cart>;

const empty = (): Cart => ({ changes: {}, discount: null });

const cart = createSlice({
  name: 'cart',
  initialState: {} as CartState,
  reducers: {
    change(state, a: PayloadAction<{ key: OrderKey; menuId: number; delta: number; current: number }>) {
      const { key, menuId, delta, current } = a.payload;
      if (current + delta < 0) return;
      const c = (state[key] ??= empty());
      const next = (c.changes[menuId] ?? 0) + delta;
      if (next === 0) delete c.changes[menuId];
      else c.changes[menuId] = next;
      if (!Object.keys(c.changes).length && c.discount === null) delete state[key];
    },
    setDiscount(state, a: PayloadAction<{ key: OrderKey; discount: number | null }>) {
      (state[a.payload.key] ??= empty()).discount = a.payload.discount;
    },
    /** After a save: what was sent is no longer pending (taps made while saving stay). */
    saved(state, a: PayloadAction<{ key: OrderKey; newKey: OrderKey; sent: Cart }>) {
      const { key, newKey, sent } = a.payload;
      const c = state[key];
      if (!c) return;
      for (const [id, d] of Object.entries(sent.changes)) {
        const left = (c.changes[id] ?? 0) - d;
        if (left === 0) delete c.changes[id];
        else c.changes[id] = left;
      }
      if (sent.discount !== null && c.discount === sent.discount) c.discount = null;
      delete state[key];
      if (Object.keys(c.changes).length || c.discount !== null) state[newKey] = c;
    },
    clear(state, a: PayloadAction<OrderKey>) { delete state[a.payload]; },
    restore: (_s, a: PayloadAction<CartState>) => a.payload,
  },
});

export const { change, setDiscount, saved, clear: clearCart, restore: restoreCart } = cart.actions;
export default cart.reducer;

export interface Line { menuId: number | null; name: string; unitPrice: number; quantity: number; kotQty: number; pending: number }

/** What the waiter sees: the saved order plus unsaved taps. */
export function mergeLines(order: Order | undefined, c: Cart | undefined, menu: MenuItem[]): Line[] {
  const lines: Line[] = (order?.items ?? []).map((i) => ({
    menuId: i.menu_item_id, name: i.name, unitPrice: i.unit_price, quantity: i.quantity, kotQty: i.kot_qty, pending: 0,
  }));
  for (const [id, d] of Object.entries(c?.changes ?? {})) {
    const menuId = Number(id);
    const line = lines.find((l) => l.menuId === menuId);
    if (line) { line.quantity += d; line.pending = d; continue; }
    const m = menu.find((x) => x.id === menuId);
    if (m && d > 0) lines.push({ menuId, name: m.name, unitPrice: m.price, quantity: d, kotQty: 0, pending: d });
  }
  return lines.filter((l) => l.quantity > 0);
}

export const hasPending = (c: Cart | undefined) => Boolean(c && (Object.keys(c.changes).length || c.discount !== null));

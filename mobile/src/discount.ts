import { computeBill, type Bill } from './money';
import type { MenuItem, Order, Settings } from './types';

/**
 * Optional percent discount on every bill (Settings → Bill Details), with categories left out. Open orders use
 * the hotel's current rule; a paid bill keeps the rule and amount it was paid with. Same maths as the server
 * (refresh_auto_discount): floor(eligible subtotal × percent / 100), in paise.
 */
export interface DiscountRule { pct: number; exclude: string[] }

// The hotel's settings and menu, handed over by the store (kept out of here so printing works without the app).
let source: () => { settings: Settings | null; menu: MenuItem[] } = () => ({ settings: null, menu: [] });
export const setDiscountSource = (get: typeof source) => { source = get; };

export const hotelRule = (s: Settings | null | undefined): DiscountRule => ({ pct: s?.disc_pct ?? 0, exclude: s?.disc_exclude ?? [] });
export const orderRule = (o: Pick<Order, 'status' | 'disc_pct' | 'disc_exclude'>): DiscountRule =>
  o.status === 'paid' ? { pct: o.disc_pct ?? 0, exclude: o.disc_exclude ?? [] } : hotelRule(source().settings);

/** The percent discount on these dishes (dishes in a left-out category don't count). */
export function autoDiscount(items: { menuId: number | null; quantity: number; unitPrice: number }[], rule: DiscountRule): number {
  if (!rule.pct) return 0;
  const category = new Map(source().menu.map((m) => [m.id, m.category]));
  const base = items
    .filter((i) => !rule.exclude.includes(i.menuId != null ? category.get(i.menuId) ?? '' : ''))
    .reduce((n, i) => n + i.quantity * i.unitPrice, 0);
  return Math.floor((base * rule.pct) / 100);
}

/** A saved order's bill, with its percent discount (a paid bill uses the amount stored with it). */
export function orderBill(o: Order, rate: number): Bill {
  const lines = o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price }));
  const auto = o.status === 'paid'
    ? o.auto_discount ?? 0
    : autoDiscount(o.items.map((i) => ({ menuId: i.menu_item_id, quantity: i.quantity, unitPrice: i.unit_price })), orderRule(o));
  return computeBill(lines, o.discount, rate, auto);
}

/** "50% off" for the bill, and the left-out categories, if any. */
export const ruleLabel = (r: DiscountRule) => `${r.pct}% off`;
export const ruleNote = (r: DiscountRule) => (r.exclude.length ? `Not on ${r.exclude.join(', ')}` : '');

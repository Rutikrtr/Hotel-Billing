import assert from 'node:assert/strict';
import { test } from 'node:test';
import cart, { change, mergeLines, saved, setDiscount, hasPending } from '../src/store/cart';
import { computeBill } from '../src/money';
// The web app's own maths, to prove both apps give the same totals.
// @ts-ignore plain JS module
import { computeBill as webBill } from '../../public/billing.js';

const menu = [
  { id: 1, name: 'Misal', category: 'A', price: 9000, is_veg: true, available: true, is_favorite: false },
  { id: 2, name: 'Tea', category: 'B', price: 1000, is_veg: true, available: true, is_favorite: false },
];
const order = { id: 7, table_id: 3, section: 'A', is_parcel: false, status: 'open' as const, discount: 0, bill_no: null, billed_at: null,
  opened_at: '2026-10-24T10:00:00Z', items: [{ id: 70, menu_item_id: 1, name: 'Misal', unit_price: 9000, quantity: 2, kot_qty: 2 }] };

test('taps change only the phone (no request) and show on top of the saved order', () => {
  let s = cart(undefined, { type: 'init' });
  s = cart(s, change({ key: 't:3:A', menuId: 1, delta: 1, current: 2 }));
  s = cart(s, change({ key: 't:3:A', menuId: 2, delta: 1, current: 0 }));
  s = cart(s, change({ key: 't:3:A', menuId: 2, delta: 1, current: 1 }));
  const lines = mergeLines(order, s['t:3:A'], menu);
  assert.deepEqual(lines.map((l) => [l.name, l.quantity, l.pending]), [['Misal', 3, 1], ['Tea', 2, 2]]);
  assert.equal(hasPending(s['t:3:A']), true);
});

test('cannot go below zero; back to zero clears the pending change', () => {
  let s = cart(undefined, { type: 'init' });
  s = cart(s, change({ key: 'k', menuId: 2, delta: -1, current: 0 }));
  assert.equal(s.k, undefined);
  s = cart(s, change({ key: 'k', menuId: 2, delta: 1, current: 0 }));
  s = cart(s, change({ key: 'k', menuId: 2, delta: -1, current: 1 }));
  assert.equal(s.k, undefined);
});

test('after a save, taps made while saving are kept; a new parcel moves to its saved number', () => {
  let s = cart(undefined, { type: 'init' });
  s = cart(s, change({ key: 'p:new', menuId: 1, delta: 2, current: 0 }));
  const sent = { changes: { ...s['p:new'].changes }, discount: null };
  s = cart(s, change({ key: 'p:new', menuId: 2, delta: 1, current: 0 }));   // tapped while the save was on its way
  s = cart(s, saved({ key: 'p:new', newKey: 'p:55', sent }));
  assert.equal(s['p:new'], undefined);
  assert.deepEqual(s['p:55'].changes, { 2: 1 });
});

test('discount is saved once', () => {
  let s = cart(undefined, { type: 'init' });
  s = cart(s, setDiscount({ key: 'k', discount: 2000 }));
  s = cart(s, saved({ key: 'k', newKey: 'k', sent: { changes: {}, discount: 2000 } }));
  assert.equal(s.k, undefined);
});

test('bill totals match the web app exactly (GST, discount, round off)', () => {
  for (const [lines, discount, rate] of [
    [[{ name: 'a', quantity: 3, unitPrice: 9050 }], 0, 0],
    [[{ name: 'a', quantity: 2, unitPrice: 12345 }, { name: 'b', quantity: 1, unitPrice: 999 }], 1500, 500],
    [[{ name: 'a', quantity: 7, unitPrice: 4399 }], 99999, 1800],
  ] as const) {
    assert.deepEqual(computeBill([...lines], discount, rate), webBill({ lines: [...lines], discount, taxRateBp: rate }));
  }
});

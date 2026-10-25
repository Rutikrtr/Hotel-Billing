import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billSlip } from '../src/printing/escpos';
import type { Order, Settings } from '../src/types';

// Printed text without the printer's control codes, one entry per line.
const lines = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
  .replace(/\x1b@/g, '').replace(/\x1b[aEd][\s\S]|\x1d![\s\S]|\x1dVB\x00/g, '').split('\n').slice(0, -1);

const settings = { id: 1, hotel_name: 'Morya Misal', hotel_address: 'Katai Gaon, Dombivali (East)', hotel_phone: '9881181890', hotel_gstin: '', tax_rate_bp: 500, quick_close: true, kot_tables: false } as Settings;
const order = { id: 1, table_id: 1, section: 'A', is_parcel: false, status: 'open', discount: 0, bill_no: null, billed_at: null, opened_at: '', items: [
  { id: 1, menu_item_id: 1, name: 'Puneri Misal', unit_price: 9000, quantity: 1, kot_qty: 0 },
  { id: 2, menu_item_id: 2, name: 'Special Misal with extra farsan and pav', unit_price: 13000, quantity: 12, kot_qty: 0 },
] } as Order;

for (const width of [32, 48]) {
  test(`bill fits ${width}-character paper and keeps every item and total`, () => {
    const out = lines(billSlip({ width, feed: 2 }, order, settings, 'A4', 'B00119', 'Cash', { at: '2026-10-25T06:51:00Z' }).bytes());
    for (const l of out) assert.ok(l.length <= width, `too wide (${l.length}): "${l}"`);
    const text = out.join('\n');
    for (const s of ['Morya Misal', 'Bill: B00119', 'Table: A4', 'Item', 'Puneri Misal', '@ 90.00', '1,560.00', 'CGST @ 2.5%', 'TOTAL', 'Thank you! Visit again.']) {
      assert.ok(text.includes(s), `missing "${s}"`);
    }
    assert.match(text, /TOTAL\s+Rs\.1,733\.00/);
  });
}

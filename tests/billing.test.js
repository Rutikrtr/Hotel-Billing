import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaise, fmt, plain, nightsBetween, percentOf, computeBill } from '../public/billing.js';

test('toPaise parses amounts', () => {
  assert.equal(toPaise('1500'), 150000);
  assert.equal(toPaise('1499.5'), 149950);
  assert.equal(toPaise('0.05'), 5);
  assert.equal(toPaise(''), 0);
  assert.equal(toPaise('.5'), 50);
  for (const bad of ['-1', 'abc', '1.234', '1.2.3']) assert.throws(() => toPaise(bad));
});

test('formatting', () => {
  assert.equal(fmt(12345678), '1,23,456.78');
  assert.equal(fmt(5), '0.05');
  assert.equal(plain(150050), '1500.50');
});

test('nights', () => {
  assert.equal(nightsBetween('2026-01-01', '2026-01-04'), 3);
  assert.equal(nightsBetween('2026-01-01', '2026-01-01'), 1);
  assert.equal(nightsBetween('2026-03-28', '2026-03-30'), 2);
  assert.throws(() => nightsBetween('2026-01-02', '2026-01-01'));
});

test('percent rounds half up', () => {
  assert.equal(percentOf(1000, 1250), 125);
  assert.equal(percentOf(5, 1000), 1);
});

test('bill totals', () => {
  const bill = computeBill({
    lines: [{ quantity: 2, unitPrice: 200000 }, { quantity: 1, unitPrice: 30000 }],
    discount: 30000, taxRateBp: 1200, paid: 100000,
  });
  assert.equal(bill.subtotal, 430000);
  assert.equal(bill.taxable, 400000);
  assert.equal(bill.tax, 48000);
  assert.equal(bill.cgst + bill.sgst, bill.tax);
  assert.equal(bill.total, 448000);
  assert.equal(bill.balance, 348000);
});

test('discount cannot make taxable negative', () => {
  const bill = computeBill({ lines: [{ quantity: 1, unitPrice: 1000 }], discount: 5000, taxRateBp: 1800 });
  assert.equal(bill.taxable, 0);
  assert.equal(bill.total, 0);
});

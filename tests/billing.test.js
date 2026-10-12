import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaise, fmt, plain, percentOf, computeBill, orderBill } from '../public/billing.js';

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
  assert.equal(fmt(-25), '-0.25');
  assert.equal(plain(150050), '1500.50');
  assert.equal(plain(15000), '150');
});

test('percent rounds half up', () => {
  assert.equal(percentOf(1000, 1250), 125);
  assert.equal(percentOf(5, 1000), 1);
});

test('restaurant bill with 5% GST and round off', () => {
  // 2 x 220 + 1 x 45 = 485; 5% = 24.25; 509.25 -> 509
  const bill = computeBill({
    lines: [{ quantity: 2, unitPrice: 22000 }, { quantity: 1, unitPrice: 4500 }],
    taxRateBp: 500,
  });
  assert.equal(bill.subtotal, 48500);
  assert.equal(bill.tax, 2425);
  assert.equal(bill.cgst + bill.sgst, bill.tax);
  assert.equal(bill.roundOff, -25);
  assert.equal(bill.total, 50900);
  assert.equal(bill.itemCount, 3);
});

test('round off goes up from 50 paise', () => {
  const bill = computeBill({ lines: [{ quantity: 1, unitPrice: 10050 }] });
  assert.equal(bill.total, 10100);
  assert.equal(bill.roundOff, 50);
});

test('discount is capped at the subtotal', () => {
  const bill = computeBill({ lines: [{ quantity: 1, unitPrice: 1000 }], discount: 5000, taxRateBp: 500 });
  assert.equal(bill.discount, 1000);
  assert.equal(bill.total, 0);
});

test('orderBill maps rows', () => {
  const bill = orderBill({ discount: 1000 }, [{ name: 'Tea', quantity: 2, unit_price: 2000 }], 0);
  assert.equal(bill.total, 3000);
  assert.equal(bill.lines[0].name, 'Tea');
});

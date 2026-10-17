// Pure billing calculations. All money is handled in integer paise (1/100 of a rupee).

export function toPaise(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (!/^\d*(\.\d{0,2})?$/.test(text)) throw new Error(`“${text}” isn’t a valid amount`);
  const [whole, frac = ''] = text.split('.');
  return Number(whole || 0) * 100 + Number(frac.padEnd(2, '0') || 0);
}

export function fmt(paise) {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN');
  return `${sign}${rupees}.${String(abs % 100).padStart(2, '0')}`;
}

/** Plain number for pre-filling inputs, e.g. 150050 -> "1500.50", 15000 -> "150". */
export function plain(paise) {
  const frac = paise % 100;
  return frac ? `${Math.floor(paise / 100)}.${String(frac).padStart(2, '0')}` : String(paise / 100);
}

/** rateBp is the rate in basis points (500 = 5%). Rounds half up. */
export function percentOf(amount, rateBp) {
  return Math.floor((amount * rateBp + 5000) / 10000);
}

/** Lines are { quantity, unitPrice }. The payable amount is rounded to the nearest rupee. */
export function computeBill({ lines, discount = 0, taxRateBp = 0 }) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const appliedDiscount = Math.min(discount, subtotal);
  const taxable = subtotal - appliedDiscount;
  const tax = percentOf(taxable, taxRateBp);
  const cgst = Math.floor(tax / 2);
  const exact = taxable + tax;
  const total = Math.floor((exact + 50) / 100) * 100;
  return {
    lines, subtotal, discount: appliedDiscount, taxable, tax, cgst, sgst: tax - cgst,
    roundOff: total - exact, total,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  };
}

export function orderBill(order, items, taxRateBp) {
  return computeBill({
    lines: items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })),
    discount: order?.discount ?? 0,
    taxRateBp,
  });
}

/** Nights between two YYYY-MM-DD dates; a same-day stay counts as one night. */
export function nightsBetween(checkIn, checkOut) {
  const days = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
  return Math.max(days, 1);
}

// Pure billing calculations. All money is handled in integer paise (1/100 of a rupee).

export function toPaise(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (!/^\d*(\.\d{0,2})?$/.test(text)) throw new Error(`Invalid amount: ${text}`);
  const [whole, frac = ''] = text.split('.');
  return Number(whole || 0) * 100 + Number(frac.padEnd(2, '0') || 0);
}

export function fmt(paise) {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN');
  return `${sign}${rupees}.${String(abs % 100).padStart(2, '0')}`;
}

/** Plain number for pre-filling inputs, e.g. 150050 -> "1500.50". */
export function plain(paise) {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

export function nightsBetween(checkIn, checkOut) {
  const ms = Date.parse(checkOut) - Date.parse(checkIn);
  if (ms < 0) throw new Error('Check-out cannot be before check-in');
  return Math.max(1, Math.round(ms / 86400000));
}

/** rateBp is the rate in basis points (1800 = 18%). Rounds half up. */
export function percentOf(amount, rateBp) {
  return Math.floor((amount * rateBp + 5000) / 10000);
}

export function computeBill({ lines, discount = 0, taxRateBp = 0, paid = 0 }) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const taxable = Math.max(0, subtotal - discount);
  const tax = percentOf(taxable, taxRateBp);
  const cgst = Math.floor(tax / 2);
  const total = taxable + tax;
  return { lines, subtotal, discount, taxable, tax, cgst, sgst: tax - cgst, total, paid, balance: total - paid };
}

export function buildBill(booking, room, extras, payments, taxRateBp) {
  const nights = nightsBetween(booking.check_in, booking.check_out);
  const lines = [
    { description: `Room ${room.number} (${room.room_type}) - ${nights} night(s)`, quantity: nights, unitPrice: booking.rate },
    ...extras.map((e) => ({ id: e.id, description: e.description, quantity: e.quantity, unitPrice: e.unit_price })),
  ];
  return computeBill({
    lines, discount: booking.discount, taxRateBp,
    paid: payments.reduce((s, p) => s + p.amount, 0),
  });
}

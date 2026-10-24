// Bill maths, identical to the web app (public/billing.js). All money is in integer paise.

export function fmt(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN');
  return `${sign}${rupees}.${String(abs % 100).padStart(2, '0')}`;
}
export const rs = (paise: number) => `₹${fmt(paise)}`;
export const rsShort = (paise: number) => rs(paise).replace('.00', '');

export function toPaise(value: string): number {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (!/^\d*(\.\d{0,2})?$/.test(text)) throw new Error(`“${text}” isn’t a valid amount`);
  const [whole, frac = ''] = text.split('.');
  return Number(whole || 0) * 100 + Number(frac.padEnd(2, '0') || 0);
}

export const percentOf = (amount: number, rateBp: number) => Math.floor((amount * rateBp + 5000) / 10000);

export interface BillLine { name: string; quantity: number; unitPrice: number }
export interface Bill {
  lines: BillLine[]; subtotal: number; discount: number; taxable: number; tax: number; cgst: number; sgst: number;
  roundOff: number; total: number; itemCount: number;
}

export function computeBill(lines: BillLine[], discount = 0, taxRateBp = 0): Bill {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const applied = Math.min(discount, subtotal);
  const taxable = subtotal - applied;
  const tax = percentOf(taxable, taxRateBp);
  const cgst = Math.floor(tax / 2);
  const exact = taxable + tax;
  const total = Math.floor((exact + 50) / 100) * 100;
  return {
    lines, subtotal, discount: applied, taxable, tax, cgst, sgst: tax - cgst, roundOff: total - exact, total,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  };
}

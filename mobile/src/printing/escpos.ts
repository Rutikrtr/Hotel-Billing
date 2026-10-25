// Receipts as ESC/POS printer bytes. Same layout as the web app's slips (public/printer.js and app.js).
import { computeBill, fmt, nightsBetween } from '../money';
import type { Order, Settings, Stay } from '../types';

const ESC = 0x1b;
const GS = 0x1d;

/** Printers only know plain ASCII: swap the rupee sign and strip accents. */
export function ascii(text: unknown): string {
  return String(text ?? '')
    .replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
}

export type Target = 'bill' | 'kitchen';

export class Slip {
  out: number[] = [ESC, 0x40];
  constructor(public width = 32, public target: Target = 'bill', private feedLines = 2) {}
  raw(...bytes: number[]) { this.out.push(...bytes); return this; }
  align(where: 'left' | 'center' | 'right') { return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[where]); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(w = 1, h = 1) { return this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1)); }
  /** Extra space between letters (ESC SP n), for headings. */
  spacing(n = 0) { return this.raw(ESC, 0x20, n); }
  text(s: string) { for (const ch of ascii(s)) this.out.push(ch.charCodeAt(0)); return this; }
  line(s = '') { return this.text(s).raw(0x0a); }
  wrap(s: string, width = this.width) {
    let rest = ascii(s);
    if (!rest) return this.line('');
    while (rest.length > width) {
      let cut = rest.lastIndexOf(' ', width);
      if (cut <= 0) cut = width;
      this.line(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    return this.line(rest);
  }
  cols(left: string, right: string, width = this.width) {
    const r = ascii(right);
    let l = ascii(left);
    const room = width - r.length - 1;
    if (l.length > room) l = l.slice(0, Math.max(room, 0));
    return this.line(l + ' '.repeat(Math.max(width - l.length - r.length, 1)) + r);
  }
  rule(ch = '-') { return this.line(ch.repeat(this.width)); }
  cut() { return this.raw(ESC, 0x64, this.feedLines).raw(GS, 0x56, 0x42, 0x00); }
  bytes() { return Uint8Array.from(this.out); }
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' });
const pct = (bp: number) => `${+(bp / 100).toFixed(2)}%`;
export const tokenNo = (billNo: string | null) => String(Number(String(billNo ?? '').replace(/\D/g, '')) || '');
export const ticketLabel = (label: string) => (/^table/i.test(label) ? label : `Table ${label}`);

export interface Paper { width: number; feed: number }

/** Kitchen ticket: only what changed since the last ticket, with the table in big letters. */
export function kotSlip(p: Paper, label: string, changes: { name: string; quantity: number }[], addOn: boolean, by: string): Slip {
  const s = new Slip(p.width, 'kitchen', p.feed);
  s.align('center').bold(true).size(2, 2).wrap(ticketLabel(label).toUpperCase(), Math.floor(s.width / 2)).size(1, 1)
    .line(addOn ? 'KOT - ADD-ON' : 'KOT').bold(false)
    .line(`${time(new Date().toISOString())}${by ? `  ${by}` : ''}`).align('left').rule();
  for (const c of changes) {
    s.bold(true).size(1, 2).wrap(c.quantity > 0 ? `${c.quantity} x ${c.name}` : `CANCEL ${-c.quantity} x ${c.name}`).size(1, 1).bold(false);
  }
  return s.cut();
}

/** Bill heading: the hotel name large and spaced out, then address and phone on their own lines. */
function header(s: Slip, settings: Settings, rate: number) {
  const name = ascii(settings.hotel_name).toUpperCase();
  s.align('center').bold(true);
  if (name.length * 2 <= s.width) s.size(2, 2).spacing(0).wrap(name, Math.floor(s.width / 2)).size(1, 1);
  else s.size(1, 2).spacing(1).wrap(name, Math.floor(s.width / 2)).spacing(0).size(1, 1);
  s.bold(false);
  if (settings.hotel_address) s.wrap(settings.hotel_address);
  if (settings.hotel_phone) s.line(`Ph: ${settings.hotel_phone}`);
  if (settings.hotel_gstin && rate > 0) s.line(`GSTIN: ${settings.hotel_gstin}`);
  return s.align('left').rule();
}

/** Extra details for reprinting a paid bill: its own GST rate, time and payment. */
export interface BillMeta { rate?: number; at?: string; method?: string | null; split?: Partial<Record<string, number>> | null }

/** The customer's bill, short: one "qty name amount" line per dish, then the total. */
export function billSlip(p: Paper, order: Order, settings: Settings, label: string, billNo: string, method: string | null, meta: BillMeta = {}): Slip {
  const rate = meta.rate ?? settings.tax_rate_bp;
  const b = computeBill(order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price })), order.discount, rate);
  const s = new Slip(p.width, 'bill', p.feed);
  const W = s.width;
  header(s, settings, rate);
  if (order.is_parcel) s.align('center').bold(true).size(2, 2).line(`PARCEL #${tokenNo(billNo)}`).size(1, 1).bold(false).align('left');
  s.bold(true).cols(`Bill: ${billNo}`, order.is_parcel ? 'Parcel' : `Table: ${label}`).bold(false);
  s.cols(stamp(meta.at ?? new Date().toISOString()), meta.method ?? method ?? '').rule();
  // One line per dish: "2 Puneri Misal          180.00" (long names wrap, the amount stays on the last line).
  const amtW = 10;
  const nameW = W - amtW;
  for (const l of b.lines) {
    const left = ascii(`${l.quantity} ${l.name}`);
    const amt = fmt(l.quantity * l.unitPrice);
    if (left.length <= nameW - 1) s.cols(left, amt);
    else {
      let rest = left;
      while (rest.length > nameW - 1) {
        let cut = rest.lastIndexOf(' ', nameW - 1);
        if (cut <= 0) cut = nameW - 1;
        s.line(rest.slice(0, cut));
        rest = '  ' + rest.slice(cut).trimStart();
      }
      s.cols(rest, amt);
    }
  }
  s.rule();
  // Subtotal only when something is added or taken off; otherwise straight to the total.
  if (b.discount || b.tax || b.roundOff) {
    s.cols(`Subtotal (${b.itemCount})`, fmt(b.subtotal));
    if (b.discount) s.cols('Discount', `-${fmt(b.discount)}`);
    if (b.tax) s.cols(`CGST ${pct(rate / 2)}`, fmt(b.cgst)).cols(`SGST ${pct(rate / 2)}`, fmt(b.sgst));
    if (b.roundOff) s.cols('Round off', fmt(b.roundOff));
  }
  s.bold(true).size(1, 2).cols(`TOTAL (${b.itemCount})`, `Rs.${fmt(b.total)}`).size(1, 1).bold(false);
  // A split payment lists each part under the total.
  for (const [m, amt] of Object.entries(meta.split ?? {})) if (amt) s.cols(`  Paid by ${m}`, fmt(amt));
  s.rule();
  return s.align('center').line('Thank you! Visit again.').cut();
}

/** A parcel's kitchen copy with its number to call out. */
export function parcelKitchenSlip(p: Paper, order: Order, billNo: string): Slip {
  const s = new Slip(p.width, 'kitchen', p.feed);
  s.align('center').bold(true).size(2, 2).line(`PARCEL #${tokenNo(billNo)}`).size(1, 1).bold(false)
    .line(`Kitchen copy  ${time(new Date().toISOString())}`).align('left').rule();
  for (const i of order.items) s.bold(true).size(1, 2).wrap(`${i.quantity} x ${i.name}`).size(1, 1).bold(false);
  return s.cut();
}

export function testSlip(p: Paper, title: string): Slip {
  return new Slip(p.width, 'bill', p.feed).align('center').bold(true).size(2, 2).line(title).size(1, 1).bold(false)
    .line('Printer is working').line('Master Bill by Techyverve').cut();
}

/** A room bill: guest, dates and nights, then one line per charge, like the food bill. */
export function staySlip(p: Paper, stay: Stay, settings: Settings, rate: number): Slip {
  const nights = nightsBetween(stay.check_in, stay.check_out);
  const lines = [
    { name: `Room ${stay.lodging_rooms?.number ?? ''} x ${nights} night${nights === 1 ? '' : 's'}`, quantity: nights, unitPrice: stay.rate },
    ...stay.stay_charges.map((c) => ({ name: c.description, quantity: c.quantity, unitPrice: c.unit_price })),
  ];
  const b = computeBill(lines, stay.discount, rate);
  const s = new Slip(p.width, 'bill', p.feed);
  header(s, settings, rate);
  s.bold(true).cols(`Bill: ${stay.bill_no ?? '-'}`, `Room: ${stay.lodging_rooms?.number ?? ''}`).bold(false);
  s.cols(stay.guest_name, stay.guest_phone || '');
  s.cols(`${stay.check_in} to ${stay.check_out}`, stay.payment_method ?? '').rule();
  for (const l of b.lines) s.cols(`${l.quantity} ${l.name}`, fmt(l.quantity * l.unitPrice));
  s.rule();
  if (b.discount || b.tax || b.roundOff) {
    s.cols('Subtotal', fmt(b.subtotal));
    if (b.discount) s.cols('Discount', `-${fmt(b.discount)}`);
    if (b.tax) s.cols(`CGST ${pct(rate / 2)}`, fmt(b.cgst)).cols(`SGST ${pct(rate / 2)}`, fmt(b.sgst));
    if (b.roundOff) s.cols('Round off', fmt(b.roundOff));
  }
  s.bold(true).size(1, 2).cols('TOTAL', `Rs.${fmt(b.total)}`).size(1, 1).bold(false).rule();
  return s.align('center').line('Thank you for staying with us!').cut();
}

// Direct printing to thermal receipt printers (ESC/POS), without the phone's print dialog.
// Two ways to reach the printer:
//  - "bluetooth": Chrome on Android talks to the printer over Bluetooth Low Energy (Web Bluetooth).
//  - "rawbt": hands the bytes to the free RawBT app, which works with classic Bluetooth printers too.

const ESC = 0x1b;
const GS = 0x1d;

/** Printers only know plain ASCII: swap the rupee sign and strip accents, anything else becomes "?". */
function ascii(text) {
  return String(text ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, '-')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Builds one receipt as ESC/POS bytes. width is characters per line: 32 for 58 mm paper, 48 for 80 mm. */
export class Slip {
  constructor(width = 32) {
    this.width = width;
    this.out = [ESC, 0x40]; // initialise
  }
  raw(...bytes) { this.out.push(...bytes); return this; }
  align(where) { return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[where]); }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  /** Character size multiplier, 1 to 4 in each direction. */
  size(w = 1, h = 1) { return this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1)); }
  text(s) { for (const ch of ascii(s)) this.out.push(ch.charCodeAt(0)); return this; }
  line(s = '') { return this.text(s).raw(0x0a); }
  /** Wrapped text, broken at spaces where possible. */
  wrap(s, width = this.width) {
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
  /** Left text and right text on one line, padded apart. */
  cols(left, right, width = this.width) {
    const r = ascii(right);
    let l = ascii(left);
    const room = width - r.length - 1;
    if (l.length > room) l = l.slice(0, Math.max(room, 0));
    return this.line(l + ' '.repeat(Math.max(width - l.length - r.length, 1)) + r);
  }
  rule(ch = '-') { return this.line(ch.repeat(this.width)); }
  feed(n = 1) { return this.raw(ESC, 0x64, n); }
  /** Feed past the tear bar and cut (printers without a cutter ignore the cut). */
  cut() { return this.feed(4).raw(GS, 0x56, 0x42, 0x00); }
  bytes() { return Uint8Array.from(this.out); }
}

const join = (slips) => {
  const parts = slips.map((s) => s.bytes());
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
};

// ---------- settings (kept on this phone only) ----------

const KEY = 'hb-printer';
export function getPrinter() {
  try { return { method: 'dialog', paper: 58, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { method: 'dialog', paper: 58 }; }
}
export function setPrinter(p) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getPrinter(), ...p })); } catch { /* private mode */ }
}
export const paperWidth = () => (getPrinter().paper === 80 ? 48 : 32);
export const directPrinting = () => getPrinter().method !== 'dialog';
export const bluetoothSupported = () => Boolean(navigator.bluetooth);

// ---------- Bluetooth (BLE) ----------

// Services used by common thermal printers (Goojprt, Xprinter, MTP, Rongta, PeriPage, "BlueTooth Printer", …).
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4a0e-a96b-c6ef1a0e4d7f',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];
const bt = { device: null, char: null };

async function findWritable(server) {
  for (const service of await server.getPrimaryServices()) {
    let chars = [];
    try { chars = await service.getCharacteristics(); } catch { continue; }
    const c = chars.find((x) => x.properties.writeWithoutResponse) ?? chars.find((x) => x.properties.write);
    if (c) return c;
  }
  throw new Error('Connected, but this printer has no print channel the browser can use. Choose “RawBT app” instead.');
}

let connecting = null; // one connection attempt at a time

/** Connect to the saved printer, or (pick = true, during a tap) let the person choose one. */
export function connectBluetooth(pick = false) {
  connecting ??= connect(pick).finally(() => { connecting = null; });
  return connecting;
}

async function connect(pick) {
  if (!navigator.bluetooth) throw new Error('This browser can’t use Bluetooth. Open the app in Chrome on Android, or choose “RawBT app”.');
  if (bt.device && bt.char && bt.device.gatt.connected) return bt.device.name;
  if (!bt.device && navigator.bluetooth.getDevices) {
    const saved = getPrinter().btId;
    const known = await navigator.bluetooth.getDevices().catch(() => []);
    bt.device = known.find((d) => d.id === saved) ?? null;
  }
  if (!bt.device) {
    if (!pick) throw new Error('Printer not connected. Tap Print to connect it.');
    bt.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
    setPrinter({ btId: bt.device.id, btName: bt.device.name || 'Printer' });
  }
  bt.device.addEventListener('gattserverdisconnected', () => { bt.char = null; }, { once: true });
  const server = await bt.device.gatt.connect();
  bt.char = await findWritable(server);
  return bt.device.name || 'Printer';
}

export function forgetBluetooth() {
  try { bt.device?.gatt?.disconnect(); } catch { /* already gone */ }
  bt.device = null; bt.char = null;
  setPrinter({ btId: null, btName: null });
}

const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function sendBluetooth(data, pick) {
  await connectBluetooth(pick);
  const c = bt.char;
  // Small pieces with short pauses: cheap printers have tiny buffers.
  for (let i = 0; i < data.length; i += 100) {
    const piece = data.slice(i, i + 100);
    if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(piece);
    else await c.writeValue(piece);
    await pause(25);
  }
}

// ---------- RawBT ----------

function sendRawBT(data) {
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  location.href = /Android/i.test(navigator.userAgent)
    ? `intent:base64,${b64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`
    : `rawbt:base64,${b64}`;
}

/** Send one or more slips to the printer chosen on this phone. pick: allow the Bluetooth chooser (call during a tap). */
export async function printSlips(slips, { pick = false } = {}) {
  const data = join(slips);
  const { method } = getPrinter();
  if (method === 'bluetooth') return sendBluetooth(data, pick);
  if (method === 'rawbt') return sendRawBT(data);
  throw new Error('No direct printer is set up on this phone.');
}

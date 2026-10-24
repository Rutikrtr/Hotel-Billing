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
  /** target: 'bill' or 'kitchen' — which printer the slip goes to when there are two. */
  constructor(width = 32, target = 'bill') {
    this.width = width;
    this.target = target;
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
  /** Feed a little blank paper (set per phone, 2 lines by default) and cut; printers without a cutter ignore the cut. */
  cut() { return this.feed(feedLines()).raw(GS, 0x56, 0x42, 0x00); }
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

// { method: 'dialog' | 'bluetooth' | 'rawbt', paper: 58 | 80, bill: { id, name }, kitchen: { separate, id, name } }
const KEY = 'hb-printer';
export function getPrinter() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
  // Older setups kept the one printer as btId / btName.
  const bill = p.bill ?? (p.btId ? { id: p.btId, name: p.btName } : {});
  return { method: 'dialog', paper: 58, ...p, bill, kitchen: p.kitchen ?? { separate: false } };
}
export function setPrinter(p) {
  const { btId, btName, ...rest } = { ...getPrinter(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* private mode */ }
}
export const paperWidth = () => (getPrinter().paper === 80 ? 48 : 32);
/** Blank lines after each slip before tearing: 1 to 4 (default 2). */
export const feedLines = () => Math.min(4, Math.max(1, Number(getPrinter().feed) || 2));
export const directPrinting = () => getPrinter().method !== 'dialog';
export const bluetoothSupported = () => Boolean(navigator.bluetooth);
/** iPhone / iPad (iPadOS also reports itself as a Mac with touch). */
export const isApple = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Chrome can only reconnect to a printer after the app is reopened when it can list remembered devices. */
export const bluetoothRemembers = () => Boolean(navigator.bluetooth?.getDevices);
/** Which printer a slip goes to: the kitchen copy uses the kitchen printer when one is set up. */
const slotFor = (target) => (target === 'kitchen' && getPrinter().kitchen.separate ? 'kitchen' : 'bill');

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
const conn = { bill: { device: null, char: null }, kitchen: { device: null, char: null } };
const connecting = {};
const LABEL = { bill: 'Bill printer', kitchen: 'Kitchen printer' };

async function findWritable(server) {
  for (const service of await server.getPrimaryServices()) {
    let chars = [];
    try { chars = await service.getCharacteristics(); } catch { continue; }
    const c = chars.find((x) => x.properties.writeWithoutResponse) ?? chars.find((x) => x.properties.write);
    if (c) return c;
  }
  throw new Error('Connected, but this printer has no print channel the browser can use. Choose “RawBT app” instead.');
}

const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
/** Bluetooth calls can stall when a printer is switched off or out of range: give up instead of freezing the button. */
const within = (promise, ms, message) => Promise.race([promise, new Promise((_, reject) => { setTimeout(() => reject(new Error(message)), ms); })]);

/** A remembered printer may need to be seen advertising before Chrome can connect to it again. */
async function gattConnect(device) {
  try {
    return await device.gatt.connect();
  } catch (err) {
    if (!device.watchAdvertisements) throw err;
    await Promise.race([
      new Promise((resolve) => { device.addEventListener('advertisementreceived', resolve, { once: true }); device.watchAdvertisements().catch(resolve); }),
      pause(6000),
    ]);
    return device.gatt.connect();
  }
}

async function connect(slot, pick) {
  if (!navigator.bluetooth) {
    throw new Error(isApple()
      ? 'iPhone browsers (Safari, Chrome) can’t use Bluetooth. Open this app in the free “Bluefy” browser to print.'
      : 'This browser can’t use Bluetooth. Open the app in Chrome on Android, or choose “RawBT app”.');
  }
  const c = conn[slot];
  if (c.device && c.char && c.device.gatt.connected) return c.device.name || 'Printer';
  const saved = getPrinter()[slot];
  if (!c.device && saved.id && navigator.bluetooth.getDevices) {
    const known = await navigator.bluetooth.getDevices().catch(() => []);
    c.device = known.find((d) => d.id === saved.id) ?? null;
  }
  if (!c.device) {
    if (!pick) throw new Error(`${LABEL[slot]} not connected. Tap 🖨️ and Connect it.`);
    // Reconnecting after the app was reopened: list only this slot's saved printer, so the right one is one tap.
    c.device = await navigator.bluetooth.requestDevice(saved.name
      ? { filters: [{ name: saved.name }], optionalServices: SERVICES }
      : { acceptAllDevices: true, optionalServices: SERVICES });
    setPrinter({ [slot]: { ...saved, id: c.device.id, name: c.device.name || 'Printer' } });
  }
  c.device.addEventListener('gattserverdisconnected', () => { c.char = null; }, { once: true });
  c.char = await within(gattConnect(c.device).then(findWritable), 15000, `${LABEL[slot]} didn’t answer. Check it is on and nearby, then try again.`);
  return c.device.name || 'Printer';
}

/** Connect a printer slot ('bill' or 'kitchen'). pick: allow the chooser (only during a tap). One attempt at a time. */
export function connectBluetooth(slot = 'bill', pick = false) {
  connecting[slot] ??= connect(slot, pick).finally(() => { connecting[slot] = null; });
  return connecting[slot];
}

/** Choose a different printer for a slot (during a tap). */
export function chooseBluetooth(slot) {
  forgetBluetooth(slot);
  return connectBluetooth(slot, true);
}

export function forgetBluetooth(slot = 'bill') {
  const c = conn[slot];
  try { c.device?.gatt?.disconnect(); } catch { /* already gone */ }
  c.device = null; c.char = null;
  const { id, name, ...rest } = getPrinter()[slot];
  setPrinter({ [slot]: rest });
}

export const isConnected = (slot) => Boolean(conn[slot].char && conn[slot].device?.gatt.connected);

/** When the app opens: quietly reconnect to remembered printers so the first print is instant. */
export async function reconnectSaved() {
  const p = getPrinter();
  if (p.method !== 'bluetooth' || !bluetoothRemembers()) return;
  const slots = ['bill', ...(p.kitchen.separate ? ['kitchen'] : [])].filter((s) => p[s].id);
  await Promise.allSettled(slots.map((s) => connectBluetooth(s, false)));
}

async function sendBluetooth(slot, data, pick) {
  await connectBluetooth(slot, pick);
  const c = conn[slot].char;
  // Small pieces with short pauses: cheap printers have tiny buffers.
  for (let i = 0; i < data.length; i += 100) {
    const piece = data.slice(i, i + 100);
    const write = c.properties.writeWithoutResponse && c.writeValueWithoutResponse ? c.writeValueWithoutResponse(piece) : c.writeValue(piece);
    await within(write, 8000, `${LABEL[slot]} stopped answering while printing. Check it is on, then try again.`);
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

/**
 * Send slips to this phone's printers. Each slip has a target: 'bill' (default) or 'kitchen'.
 * Kitchen slips go to the kitchen printer when one is set up. pick: allow the Bluetooth chooser (during a tap).
 * Resolves with the list of printers that failed (empty when everything printed).
 */
export async function printSlips(slips, { pick = false } = {}) {
  const { method } = getPrinter();
  if (method === 'rawbt') { sendRawBT(join(slips)); return []; }
  if (method !== 'bluetooth') throw new Error('No direct printer is set up on this phone.');
  const groups = {};
  for (const s of slips) (groups[slotFor(s.target)] ??= []).push(s);
  const failed = [];
  // Chrome shows at most one printer chooser per tap, so only the first printer that needs one may ask.
  let mayPick = pick;
  for (const slot of ['bill', 'kitchen'].filter((x) => groups[x])) {
    const wasConnected = isConnected(slot);
    try { await sendBluetooth(slot, join(groups[slot]), mayPick); } catch (err) { conn[slot].char = null; failed.push({ slot, error: err }); }
    if (!wasConnected) mayPick = false;
  }
  if (failed.length === Object.keys(groups).length) throw failed[0].error;
  return failed;
}

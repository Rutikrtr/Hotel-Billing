// Direct printing to thermal receipt printers (ESC/POS), without the phone's print dialog.
// Two ways to reach the printer:
//  - "bluetooth": Chrome on Android talks to the printer over Bluetooth Low Energy (Web Bluetooth).
//  - "rawbt": hands the bytes to the free RawBT app, which works with classic Bluetooth printers too.

const ESC = 0x1b;
const GS = 0x1d;

// Marathi/Hindi names are printed in English letters (मिसळ पाव → Misal Pav): these printers have no Devanagari
// font. Same rules as the phone app (mobile/src/match.ts): a consonant carries "a" unless a vowel sign or virama
// follows, and a word's last "a" is not said.
const DEVA_CONS = { क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'f', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', ळ: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h' };
const DEVA_VOWELS = { अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ॲ: 'e' };
const DEVA_SIGNS = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };
const DEVA_DIGITS = '०१२३४५६७८९';
// Load the Marathi font early so the first bill drawn as a picture already uses it.
document.fonts?.load?.('700 34px "Noto Sans Devanagari"', 'क').catch(() => {});

/**
 * Techyverve visiting card for the test print: one paper-wide picture with a rounded frame, the logo,
 * name, app, and contact lines with small drawn icons. Pure black on white so it prints crisply.
 */
export async function businessCard(paperWidth) {
  const W = paperWidth >= 48 ? 576 : 384;
  const k = W / 384;   // scale for 80 mm paper
  const logo = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'icons/techyverve.svg'; });
  const H = Math.round(432 * k);
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  const font = (w, px) => `${w} ${Math.round(px * k)}px "Plus Jakarta Sans", "Inter", "Segoe UI", Roboto, Arial, sans-serif`;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#000'; g.fillStyle = '#000'; g.lineJoin = 'round'; g.lineCap = 'round';
  // Frame: a thick outer line and a thin inner line, rounded like a card.
  const frame = (inset, r, lw) => { g.lineWidth = lw; g.beginPath(); g.roundRect(inset, inset, W - 2 * inset, H - 2 * inset, r); g.stroke(); };
  frame(3 * k, 22 * k, 4 * k);
  frame(11 * k, 15 * k, 1.5 * k);
  const cx = W / 2;
  let y = 30 * k;
  if (logo) { const lh = 78 * k, lw = (logo.naturalWidth / logo.naturalHeight) * lh || lh; g.drawImage(logo, cx - lw / 2, y, lw, lh); y += lh + 14 * k; }
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  // TECHYVERVE with letter spacing.
  g.font = font('800', 38);
  const name = 'TECHYVERVE'; const sp = 3 * k;
  const nw = [...name].reduce((n, ch) => n + g.measureText(ch).width, 0) + sp * (name.length - 1);
  let x = cx - nw / 2; g.textAlign = 'left';
  y += 34 * k;
  for (const ch of name) { g.fillText(ch, x, y); x += g.measureText(ch).width + sp; }
  g.textAlign = 'center';
  y += 32 * k; g.font = font('700', 24); g.fillText('Master Bill', cx, y);
  y += 24 * k; g.font = font('500', 17); g.fillText('Smart billing app for hotels', cx, y);
  // Divider with a small diamond in the middle.
  y += 22 * k; g.lineWidth = 2 * k;
  g.beginPath(); g.moveTo(cx - 120 * k, y); g.lineTo(cx - 12 * k, y); g.moveTo(cx + 12 * k, y); g.lineTo(cx + 120 * k, y); g.stroke();
  g.beginPath(); g.moveTo(cx, y - 6 * k); g.lineTo(cx + 6 * k, y); g.lineTo(cx, y + 6 * k); g.lineTo(cx - 6 * k, y); g.closePath(); g.fill();
  // Contact lines: icon + text, the block centred, icons in one column.
  const lines = [['phone', '9172523881'], ['phone', '9130690366'], ['web', 'www.techyverve.in'], ['pin', 'Kharadi, Pune']];
  g.font = font('600', 20);
  const iw = 22 * k, gap = 12 * k;
  const bw = iw + gap + Math.max(...lines.map(([, s]) => g.measureText(s).width));
  const bx = cx - bw / 2;
  const icon = (kind, ix, iy) => {   // iy = centre line
    const s = iw / 24; g.save(); g.translate(ix, iy - 12 * s); g.scale(s, s); g.lineWidth = 2.2; g.beginPath();
    if (kind === 'phone') g.fill(new Path2D('M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z'));
    else if (kind === 'web') { g.arc(12, 12, 9, 0, Math.PI * 2); g.moveTo(3, 12); g.lineTo(21, 12); g.moveTo(12, 3); g.bezierCurveTo(7, 8, 7, 16, 12, 21); g.moveTo(12, 3); g.bezierCurveTo(17, 8, 17, 16, 12, 21); g.stroke(); }
    else { g.fill(new Path2D('M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z')); }
    g.restore();
  };
  y += 22 * k;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  for (const [kind, text] of lines) { y += 30 * k; icon(kind, bx, y); g.fillText(text, bx + iw + gap, y + 1 * k); }
  return c;
}

/** True when the text has Marathi/Hindi letters (needs printing as a picture to keep them). */
export const hasDevanagari = (text) => /[\u0900-\u097F]/.test(String(text ?? ''));
function toLatin(text) {
  if (!/[\u0900-\u097F]/.test(text)) return text;
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (DEVA_CONS[ch]) {
      out += DEVA_CONS[ch];
      let j = i + 1;
      while (chars[j] === '़') j++;
      const next = chars[j];
      if (next === '्') { i = j; continue; }
      if (next && DEVA_SIGNS[next]) { out += DEVA_SIGNS[next]; i = j; continue; }
      if (next && /[\u0900-\u097F]/.test(next) && next !== '।') out += 'a';
      i = j - 1;
    } else if (DEVA_VOWELS[ch]) out += DEVA_VOWELS[ch];
    else if (DEVA_SIGNS[ch]) out += DEVA_SIGNS[ch];
    else if (ch === 'ं' || ch === 'ँ') out += /[पफबभम]/.test(chars[i + 1] ?? '') ? 'm' : 'n';
    else if (ch === 'ः') out += 'h';
    else if (DEVA_DIGITS.includes(ch)) out += String(DEVA_DIGITS.indexOf(ch));
    else if (ch === '्' || ch === '़') continue;
    else out += ch;
  }
  return out.replace(/(^|[\s(])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/** Printers only know plain ASCII: swap the rupee sign and strip accents, anything else becomes "?". */
function ascii(text) {
  return toLatin(String(text ?? ''))
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
  /**
   * Text the printer has no font for (Marathi/Hindi) printed as a picture: the browser draws it with its own
   * fonts, centred and wrapped to the paper, and the dots are sent as an ESC/POS raster image (GS v 0).
   * px is the text height in printer dots (8 dots per mm).
   */
  picture(text, { px = 26, bold = false } = {}) {
    const dots = this.width >= 48 ? 576 : 384;
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = `${bold ? '700' : '500'} ${px}px "Noto Sans Devanagari", "Mangal", "Nirmala UI", sans-serif`;
    g.font = font;
    // Wrap at spaces to the paper width.
    const lines = [];
    let cur = '';
    for (const word of String(text).split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && g.measureText(next).width > dots - 8) { lines.push(cur); cur = word; } else cur = next;
    }
    if (cur) lines.push(cur);
    const lineH = Math.round(px * 1.45);
    c.width = dots;
    c.height = lines.length * lineH + 4;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, dots / 2, i * lineH + lineH / 2 + 2));
    return this.raster(c);
  }
  /** A drawn canvas (full paper width) as an ESC/POS raster image (GS v 0): dark pixels print. */
  raster(c) {
    const dots = c.width;
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const wBytes = dots / 8;
    const out = [GS, 0x76, 0x30, 0, wBytes & 0xff, wBytes >> 8, c.height & 0xff, c.height >> 8];
    for (let y = 0; y < c.height; y++) {
      for (let xb = 0; xb < wBytes; xb++) {
        let b = 0;
        for (let bit = 0; bit < 8; bit++) {
          const i = (y * dots + xb * 8 + bit) * 4;
          if (data[i + 3] > 0 && (data[i] + data[i + 1] + data[i + 2]) / 3 < 140) b |= 0x80 >> bit;
        }
        out.push(b);
      }
    }
    this.out.push(...out);
    return this;
  }
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

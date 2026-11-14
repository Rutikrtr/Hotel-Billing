// Bluetooth thermal printers from the web app (iPhone in the Bluefy browser, Chrome on Android) through Web
// Bluetooth. Same proven steps as web app 1.0: pick once, small chunks, time limits on every call.
/* eslint-disable @typescript-eslint/no-explicit-any */

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

const bt = (): any => (typeof navigator !== 'undefined' ? (navigator as any).bluetooth : undefined);
export const webBluetoothSupported = () => Boolean(bt());
export const isApple = () => typeof navigator !== 'undefined'
  && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const within = <T,>(p: Promise<T>, ms: number, message: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

const conns = new Map<string, { device: any; char: any }>();   // by saved device id
const busy = new Map<string, Promise<any>>();

function noBluetooth() {
  return new Error(isApple()
    ? 'iPhone Safari/Chrome can’t use Bluetooth. Open Master Bill in the free “Bluefy” browser to print.'
    : 'This browser can’t use Bluetooth. Open Master Bill in Chrome.');
}

async function findWritable(server: any) {
  for (const service of await server.getPrimaryServices()) {
    let chars: any[] = [];
    try { chars = await service.getCharacteristics(); } catch { continue; }
    const c = chars.find((x) => x.properties.writeWithoutResponse) ?? chars.find((x) => x.properties.write);
    if (c) return c;
  }
  throw new Error('Connected, but this printer has no print channel the browser can use.');
}

async function gattConnect(device: any) {
  try { return await device.gatt.connect(); } catch (err) {
    if (!device.watchAdvertisements) throw err;
    await Promise.race([
      new Promise((resolve) => { device.addEventListener('advertisementreceived', resolve, { once: true }); device.watchAdvertisements().catch(resolve); }),
      pause(6000),
    ]);
    return device.gatt.connect();
  }
}

async function attach(key: string, device: any) {
  const c = { device, char: null as any };
  conns.set(key, c);
  device.addEventListener('gattserverdisconnected', () => { c.char = null; }, { once: true });
  c.char = await within(gattConnect(device).then(findWritable), 15000, 'Printer didn’t answer. Check it is on and nearby, then try again.');
  return c;
}

/** Show the browser's printer chooser (must run straight from a tap). Returns the chosen printer. */
export async function pickPrinter(): Promise<{ id: string; name: string }> {
  if (!bt()) throw noBluetooth();
  const device = await bt().requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  const id = device.id as string;
  await attach(id, device);
  return { id, name: device.name || 'Bluetooth printer' };
}

async function connect(id: string, name: string) {
  const have = conns.get(id);
  if (have?.char && have.device.gatt.connected) return have;
  if (!bt()) throw noBluetooth();
  let device = have?.device;
  if (!device && bt().getDevices) {
    const known: any[] = await bt().getDevices().catch(() => []);
    device = known.find((d) => d.id === id);
  }
  // After the app was reopened the browser may need the printer picked again: list only this printer by name.
  if (!device) device = await bt().requestDevice({ filters: [{ name }], optionalServices: SERVICES });
  return attach(id, device);
}

/** Send ESC/POS bytes to a saved printer, in small pieces (cheap printers have tiny buffers). */
export async function printWebBluetooth(id: string, name: string, data: Uint8Array): Promise<void> {
  const prev = busy.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    try {
      const { char } = await connect(id, name);
      for (let i = 0; i < data.length; i += 100) {
        const piece = data.slice(i, i + 100);
        const write = char.properties.writeWithoutResponse && char.writeValueWithoutResponse ? char.writeValueWithoutResponse(piece) : char.writeValue(piece);
        await within(write, 8000, 'Printer stopped answering while printing. Check it is on, then try again.');
        await pause(25);
      }
    } catch (err) {
      const c = conns.get(id); if (c) c.char = null;
      throw err;
    }
  });
  busy.set(id, run);
  return run;
}

/** When the app opens: quietly reconnect remembered printers so the first print is instant (Chrome only). */
export function warmUpWeb(devs: ({ id: string; name: string; webbt?: boolean } | null)[]) {
  if (!bt()?.getDevices) return;
  for (const d of devs) if (d?.webbt) connect(d.id, d.name).catch(() => {});
}

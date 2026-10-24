// Bluetooth (BLE) thermal printers through the phone's own Bluetooth. Every step has a time limit, so a printer that
// is off or out of range gives a clear message instead of freezing the app.
import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Characteristic, type Device } from 'react-native-ble-plx';
import type { Slip } from './escpos';

let manager: BleManager | null = null;
const ble = () => (manager ??= new BleManager());

const within = <T,>(p: Promise<T>, ms: number, message: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

export async function askPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) >= 31) {
    const r = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(r).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

/** Look for printers for a few seconds; calls back with each one found. */
export async function scan(onFound: (d: { id: string; name: string }) => void, seconds = 8): Promise<void> {
  if (!(await askPermission())) throw new Error('Allow Bluetooth (Nearby devices) for Master Bill in phone Settings, then try again.');
  const state = await ble().state();
  if (state !== 'PoweredOn') throw new Error('Turn on Bluetooth on this phone, then try again.');
  const seen = new Set<string>();
  ble().startDeviceScan(null, null, (err, d) => {
    if (err || !d) return;
    const name = d.name || d.localName;
    if (!name || seen.has(d.id)) return;
    seen.add(d.id);
    onFound({ id: d.id, name });
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  ble().stopDeviceScan();
}
export const stopScan = () => { try { ble().stopDeviceScan(); } catch { /* not scanning */ } };

const conns = new Map<string, { device: Device; char: Characteristic }>();

async function connect(id: string): Promise<{ device: Device; char: Characteristic }> {
  const have = conns.get(id);
  if (have && (await have.device.isConnected().catch(() => false))) return have;
  if (!(await askPermission())) throw new Error('Allow Bluetooth (Nearby devices) for Master Bill in phone Settings.');
  const device = await within(ble().connectToDevice(id, { timeout: 12000 }), 15000, 'Printer didn’t answer. Check it is on and nearby.');
  await within(device.discoverAllServicesAndCharacteristics(), 10000, 'Printer didn’t answer. Turn it off and on, then try again.');
  for (const service of await device.services()) {
    const chars = await service.characteristics();
    const char = chars.find((c) => c.isWritableWithoutResponse) ?? chars.find((c) => c.isWritableWithResponse);
    if (char) {
      const conn = { device, char };
      conns.set(id, conn);
      device.onDisconnected(() => conns.delete(id));
      return conn;
    }
  }
  throw new Error('Connected, but this printer has no print channel. It may not be a Bluetooth LE printer.');
}

/** Send bytes in small pieces (cheap printers have tiny buffers). */
export async function printBytes(id: string, data: Uint8Array): Promise<void> {
  const { char } = await connect(id);
  for (let i = 0; i < data.length; i += 100) {
    const piece = Buffer.from(data.slice(i, i + 100)).toString('base64');
    const write = char.isWritableWithoutResponse ? char.writeWithoutResponse(piece) : char.writeWithResponse(piece);
    try {
      await within(write, 8000, 'Printer stopped answering while printing. Check it is on, then try again.');
    } catch (err) {
      conns.delete(id);
      throw err;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const joinSlips = (slips: Slip[]) => {
  const parts = slips.map((s) => s.bytes());
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
};

/** Reconnect in the background when the app opens, so the first print is quick. */
export function warmUp(ids: (string | undefined)[]) {
  for (const id of ids) if (id) connect(id).catch(() => {});
}

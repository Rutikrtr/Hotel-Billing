import type { Device, PrinterState } from '../store/printer';
import { joinSlips, printBytes } from './ble';
import type { Slip } from './escpos';
import { printTcp } from './wifi';

export const paperOf = (p: PrinterState) => ({ width: p.paper === 80 ? 48 : 32, feed: Math.min(4, Math.max(1, p.feed || 2)) });

/** Send slips to this phone's printers: kitchen tickets to the kitchen printer when one is set. Returns failures. */
export async function printSlips(p: PrinterState, slips: Slip[]): Promise<string[]> {
  if (!p.bill) throw new Error('No printer set up on this phone. Open Settings → Printer.');
  // Each slip goes to its printer (kitchen tickets to the kitchen printer when one is set), Bluetooth or Wi-Fi.
  const groups = new Map<string, { dev: Device; slips: Slip[] }>();
  for (const s of slips) {
    const dev = s.target === 'kitchen' && p.separateKitchen && p.kitchen ? p.kitchen : p.bill;
    const g = groups.get(dev.id) ?? { dev, slips: [] };
    g.slips.push(s);
    groups.set(dev.id, g);
  }
  const failed: string[] = [];
  for (const { dev, slips: group } of groups.values()) {
    try { await (dev.wifi ? printTcp(dev.id, joinSlips(group)) : printBytes(dev.id, joinSlips(group))); }
    catch (err) { failed.push((err as Error).message); }
  }
  if (failed.length === groups.size) throw new Error(failed[0]);
  return failed;
}

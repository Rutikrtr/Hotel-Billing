import type { PrinterState } from '../store/printer';
import { joinSlips, printBytes } from './ble';
import type { Slip } from './escpos';

export const paperOf = (p: PrinterState) => ({ width: p.paper === 80 ? 48 : 32, feed: Math.min(4, Math.max(1, p.feed || 2)) });

/** Send slips to this phone's printers: kitchen tickets to the kitchen printer when one is set. Returns failures. */
export async function printSlips(p: PrinterState, slips: Slip[]): Promise<string[]> {
  if (!p.bill) throw new Error('No printer set up on this phone. Open Settings → Printer.');
  const groups = new Map<string, Slip[]>();
  for (const s of slips) {
    const id = s.target === 'kitchen' && p.separateKitchen && p.kitchen ? p.kitchen.id : p.bill.id;
    groups.set(id, [...(groups.get(id) ?? []), s]);
  }
  const failed: string[] = [];
  for (const [id, group] of groups) {
    try { await printBytes(id, joinSlips(group)); }
    catch (err) { failed.push((err as Error).message); }
  }
  if (failed.length === groups.size) throw new Error(failed[0]);
  return failed;
}

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { paperOf, printSlips } from '../printing';
import { scan, stopScan } from '../printing/ble';
import { testSlip } from '../printing/escpos';
import { useAppDispatch, useAppSelector } from '../store';
import { setPrinter, type Device } from '../store/printer';
import { Button, Card, Chip, T } from '../ui/kit';
import { C } from '../ui/theme';
import { toast } from '../ui/toast';

/** Choose this phone's Bluetooth printers: one for bills, and optionally a separate one for the kitchen. */
export default function PrinterScreen() {
  const dispatch = useAppDispatch();
  const p = useAppSelector((s) => s.printer);
  const [found, setFound] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [pickFor, setPickFor] = useState<'bill' | 'kitchen'>('bill');
  const [testing, setTesting] = useState(false);
  useEffect(() => () => stopScan(), []);

  const find = async (slot: 'bill' | 'kitchen') => {
    setPickFor(slot); setFound([]); setScanning(true);
    try { await scan((d) => setFound((list) => (list.some((x) => x.id === d.id) ? list : [...list, d]))); }
    catch (err) { toast((err as Error).message, true); }
    finally { setScanning(false); }
  };
  const choose = (d: Device) => {
    stopScan(); setScanning(false); setFound([]);
    dispatch(setPrinter(pickFor === 'bill' ? { bill: d } : { kitchen: d }));
    toast(`${pickFor === 'bill' ? 'Bill' : 'Kitchen'} printer: ${d.name}`);
  };
  const test = async () => {
    setTesting(true);
    try {
      const paper = paperOf(p);
      const slips = [testSlip(paper, 'BILL PRINTER')];
      if (p.separateKitchen && p.kitchen) { const k = testSlip(paper, 'KITCHEN'); k.target = 'kitchen'; slips.push(k); }
      const failed = await printSlips(p, slips);
      toast(failed.length ? failed[0] : 'Test printed', failed.length > 0);
    } catch (err) { toast((err as Error).message, true); } finally { setTesting(false); }
  };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 30 }}>
      <Card style={{ gap: 8 }}>
        <T w="heavy" style={{ fontSize: 16 }}>Bill printer</T>
        <T style={{ color: C.muted }}>{p.bill ? p.bill.name : 'Not chosen'}</T>
        <Button kind="secondary" title={scanning && pickFor === 'bill' ? 'Looking for printers…' : 'Find Printer'} onPress={() => find('bill')} disabled={scanning} />
      </Card>
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T w="heavy" style={{ fontSize: 16, flex: 1 }}>Separate kitchen printer</T>
          <Switch value={p.separateKitchen} onValueChange={(v) => { dispatch(setPrinter({ separateKitchen: v })); }} trackColor={{ true: C.free }} />
        </View>
        <T style={{ color: C.muted }}>{p.separateKitchen ? (p.kitchen ? p.kitchen.name : 'Not chosen') : 'Off: kitchen tickets print on the bill printer.'}</T>
        {p.separateKitchen ? <Button kind="secondary" title={scanning && pickFor === 'kitchen' ? 'Looking for printers…' : 'Find Kitchen Printer'} onPress={() => find('kitchen')} disabled={scanning} /> : null}
      </Card>
      {found.length || scanning ? (
        <Card style={{ gap: 6 }}>
          <T w="bold">Tap your printer {scanning ? '(searching…)' : ''}</T>
          {found.map((d) => (
            <Pressable key={d.id} onPress={() => choose(d)} style={{ padding: 12, borderRadius: 10, backgroundColor: C.surface2 }} accessibilityRole="button">
              <T w="bold">{d.name}</T><T style={{ color: C.muted, fontSize: 11.5 }}>{d.id}</T>
            </Pressable>
          ))}
        </Card>
      ) : null}
      <Card style={{ gap: 10 }}>
        <T w="heavy" style={{ fontSize: 16 }}>Paper</T>
        <View style={{ flexDirection: 'row' }}>
          <Chip label="58 mm" on={p.paper === 58} onPress={() => dispatch(setPrinter({ paper: 58 }))} />
          <Chip label="80 mm" on={p.paper === 80} onPress={() => dispatch(setPrinter({ paper: 80 }))} />
        </View>
        <T w="heavy" style={{ fontSize: 16 }}>Blank space after each slip</T>
        <View style={{ flexDirection: 'row' }}>
          {[1, 2, 3, 4].map((n) => <Chip key={n} label={`${n} line${n > 1 ? 's' : ''}`} on={p.feed === n} onPress={() => dispatch(setPrinter({ feed: n }))} />)}
        </View>
      </Card>
      <Button title="Print Test" onPress={test} busy={testing} disabled={!p.bill} />
    </ScrollView>
  );
}

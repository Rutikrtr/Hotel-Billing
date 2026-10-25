import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { paperOf, printSlips } from '../printing';
import { scan, stopScan } from '../printing/ble';
import { testSlip } from '../printing/escpos';
import { parseAddress, printTcp } from '../printing/wifi';
import { useAppDispatch, useAppSelector } from '../store';
import { setPrinter, type Device } from '../store/printer';
import { Button, Card, Chip, Field, Sheet, T, ToggleRow } from '../ui/kit';
import { C } from '../ui/theme';
import { toast } from '../ui/toast';

type Slot = 'bill' | 'kitchen';
const SLOT_NAME = { bill: 'Bill printer', kitchen: 'Kitchen printer' };

/** This phone's printers: one for bills, optionally another for kitchen tickets. Each can be Bluetooth or Wi-Fi. */
export default function PrinterScreen() {
  const dispatch = useAppDispatch();
  const p = useAppSelector((s) => s.printer);
  const [found, setFound] = useState<Device[]>([]);
  const [scanning, setScanning] = useState<Slot | null>(null);
  const [wifi, setWifi] = useState<{ slot: Slot; ip: string; name: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  useEffect(() => () => stopScan(), []);

  const save = (slot: Slot, d: Device) => {
    dispatch(setPrinter(slot === 'bill' ? { bill: d } : { kitchen: d }));
    toast(`${SLOT_NAME[slot]}: ${d.name}`);
  };
  const find = async (slot: Slot) => {
    setFound([]); setScanning(slot);
    try { await scan((d) => setFound((list) => (list.some((x) => x.id === d.id) ? list : [...list, d]))); }
    catch (err) { toast((err as Error).message, true); }
    finally { setScanning(null); }
  };
  const choose = (d: Device) => { const slot = scanning ?? 'bill'; stopScan(); setScanning(null); setFound([]); save(slot, d); };
  const saveWifi = async (test: boolean) => {
    if (!wifi) return;
    try {
      const { host, port } = parseAddress(wifi.ip);
      const id = `${host}:${port}`;
      if (test) {
        setTesting('wifi');
        await printTcp(id, testSlip(paperOf(p), wifi.slot === 'bill' ? 'BILL PRINTER' : 'KITCHEN').bytes());
        toast('Test printed');
      }
      save(wifi.slot, { id, name: wifi.name.trim() || `Wi-Fi ${host}`, wifi: true });
      setWifi(null);
    } catch (err) { toast((err as Error).message, true); } finally { setTesting(null); }
  };
  const test = async () => {
    setTesting('all');
    try {
      const paper = paperOf(p);
      const slips = [testSlip(paper, 'BILL PRINTER')];
      if (p.separateKitchen && p.kitchen) { const k = testSlip(paper, 'KITCHEN'); k.target = 'kitchen'; slips.push(k); }
      const failed = await printSlips(p, slips);
      toast(failed.length ? failed[0] : 'Test printed', failed.length > 0);
    } catch (err) { toast((err as Error).message, true); } finally { setTesting(null); }
  };

  const slotCard = (slot: Slot) => {
    const d = slot === 'bill' ? p.bill : p.kitchen;
    return (
      <View style={{ gap: 8 }}>
        <View style={st.current}>
          <View style={[st.badge, { backgroundColor: d ? (d.wifi ? '#E0F2FE' : C.billedSoft) : C.surface2 }]}>
            <T w="heavy" style={{ fontSize: 10, color: d ? (d.wifi ? '#0369A1' : C.billed) : C.muted }}>{d ? (d.wifi ? 'WI-FI' : 'BT') : '—'}</T>
          </View>
          <View style={{ flex: 1 }}>
            <T w="bold">{d ? d.name : 'Not chosen'}</T>
            <T style={{ color: C.muted, fontSize: 11.5 }}>{d ? (d.wifi ? `Wi-Fi · ${d.id}` : 'Bluetooth') : 'Choose Bluetooth or Wi-Fi below'}</T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button kind="secondary" small style={{ flex: 1 }} title={scanning === slot ? 'Searching…' : 'Bluetooth'} disabled={!!scanning} onPress={() => find(slot)} />
          <Button kind="secondary" small style={{ flex: 1 }} title="Wi-Fi" onPress={() => setWifi({ slot, ip: d?.wifi ? d.id : '', name: d?.wifi ? d.name : '' })} />
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 10 }}>
        <T w="heavy" style={{ fontSize: 15 }}>Bill printer</T>
        {slotCard('bill')}
      </Card>
      <Card style={{ gap: 10 }}>
        <ToggleRow label="Separate kitchen printer" hint={p.separateKitchen ? 'Kitchen tickets and parcel kitchen copies print here' : 'Off: kitchen tickets print on the bill printer'}
          value={p.separateKitchen} onChange={(v) => dispatch(setPrinter({ separateKitchen: v }))} />
        {p.separateKitchen ? slotCard('kitchen') : null}
      </Card>
      {found.length || scanning ? (
        <Card style={{ gap: 6 }}>
          <T w="bold">Tap your printer {scanning ? '(searching…)' : ''}</T>
          {found.map((d) => (
            <Pressable key={d.id} onPress={() => choose(d)} style={st.found} accessibilityRole="button">
              <T w="bold">{d.name}</T><T style={{ color: C.muted, fontSize: 11 }}>{d.id}</T>
            </Pressable>
          ))}
        </Card>
      ) : null}
      <Card style={{ gap: 10 }}>
        <T w="heavy" style={{ fontSize: 15 }}>Paper</T>
        <View style={{ flexDirection: 'row' }}>
          <Chip label="58 mm" on={p.paper === 58} onPress={() => dispatch(setPrinter({ paper: 58 }))} />
          <Chip label="80 mm" on={p.paper === 80} onPress={() => dispatch(setPrinter({ paper: 80 }))} />
        </View>
        <T w="heavy" style={{ fontSize: 15 }}>Blank space after each slip</T>
        <View style={{ flexDirection: 'row' }}>
          {[1, 2, 3, 4].map((n) => <Chip key={n} label={`${n} line${n > 1 ? 's' : ''}`} on={p.feed === n} onPress={() => dispatch(setPrinter({ feed: n }))} />)}
        </View>
      </Card>
      <Button title="Print Test" onPress={test} busy={testing === 'all'} disabled={!p.bill} />

      <Sheet open={!!wifi} onClose={() => setWifi(null)} title={`Wi-Fi ${wifi ? SLOT_NAME[wifi.slot].toLowerCase() : ''}`}>
        {wifi ? (<>
          <T style={{ color: C.muted, fontSize: 12 }}>The printer and this phone must be on the same Wi-Fi. Its IP address is on the printer’s self-test slip (hold the feed button while switching it on).</T>
          <Field label="IP address" value={wifi.ip} onChangeText={(v) => setWifi({ ...wifi, ip: v })} placeholder="192.168.1.50" keyboardType="numbers-and-punctuation" autoCapitalize="none" autoFocus />
          <Field label="Name (optional)" value={wifi.name} onChangeText={(v) => setWifi({ ...wifi, name: v })} placeholder="Kitchen printer" />
          <Button title="Test & Save" onPress={() => saveWifi(true)} busy={testing === 'wifi'} />
          <Button kind="secondary" title="Save without test" onPress={() => saveWifi(false)} />
        </>) : null}
      </Sheet>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  current: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface2, borderRadius: 12, padding: 10 },
  badge: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  found: { padding: 12, borderRadius: 10, backgroundColor: C.surface2 },
});

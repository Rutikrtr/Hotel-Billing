import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { addDays, localDay, shortDate } from '../dates';
import { computeBill, fmt, nightsBetween, rs, rsShort, toPaise } from '../money';
import { q, sb } from '../supabase';
import type { Room, Stay } from '../types';
import DateField from '../ui/DateField';
import { Button, Empty, Field, Header, Sheet, SummaryCard, T } from '../ui/kit';
import { C } from '../ui/theme';
import { toast } from '../ui/toast';
import type { Stack } from '../Root';

/** Set by the stay and check-in screens when something changed, so Rooms reads again when you come back. */
export const roomsChanged = { current: false };

export const stayTotal = (st: Stay, rate: number) => {
  const nights = nightsBetween(st.check_in, st.check_out);
  return computeBill([{ name: 'Room', quantity: nights, unitPrice: st.rate },
    ...(st.stay_charges ?? []).map((c) => ({ name: c.description, quantity: c.quantity, unitPrice: c.unit_price }))], st.discount, rate).total;
};

/** Lodge rooms: who is in which room, check-in, and today's room sales (same as the web app's Rooms). */
export default function RoomsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [open, setOpen] = useState<Stay[]>([]);
  const [paid, setPaid] = useState<Stay[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkIn, setCheckIn] = useState<Room | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const [r, o, p] = await Promise.all([
        q<Room[]>(sb.from('lodging_rooms').select('*').order('sort').order('number')),
        q<Stay[]>(sb.from('stays').select('*, stay_charges(id, description, quantity, unit_price)').eq('status', 'open')),
        q<Stay[]>(sb.from('stays').select('*, stay_charges(id, description, quantity, unit_price)').eq('status', 'paid').gte('closed_at', start.toISOString())),
      ]);
      setRooms(r); setOpen(o); setPaid(p);
    } catch (err) { toast((err as Error).message, true); } finally { setLoading(false); }
  }, []);
  // Read again when the screen comes back (after a check-in or check-out), but not on quick repeated tab taps.
  const last = useRef(0);
  useFocusEffect(useCallback(() => {
    if (!roomsChanged.current && Date.now() - last.current < 8000) return;
    roomsChanged.current = false;
    last.current = Date.now();
    load();
  }, [load]));

  const today = localDay();
  const byRoom = new Map(open.map((st) => [st.room_id, st]));
  const leaving = open.filter((st) => st.check_out <= today).length;
  return (
    <>
      <FlatList
        style={{ backgroundColor: 'transparent' }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
        data={rooms} numColumns={3} columnWrapperStyle={{ gap: 8 }} keyExtractor={(r) => String(r.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.brand1]} />}
        ListHeaderComponent={
          <View>
            <Header eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} title="Rooms" />
            <SummaryCard label="Room sales today" value={rsShort(paid.reduce((n, st) => n + stayTotal(st, st.tax_rate_bp ?? 0), 0))} stats={[
              { value: open.length, label: 'Occupied', color: C.accentStrong, bg: C.accentSoft },
              { value: rooms.length - open.length, label: 'Free', color: C.free, bg: C.freeSoft },
              { value: leaving, label: 'Checking out', color: C.billed, bg: C.billedSoft },
            ]} />
          </View>
        }
        ListEmptyComponent={loading ? null : <Empty icon="🛏️" text="No rooms yet. The owner adds rooms in Settings." />}
        renderItem={({ item: r }) => {
          const st = byRoom.get(r.id);
          const due = st && st.check_out <= today;
          return (
            <Pressable style={[s.tile, st && s.busy, due && s.due]} onPress={() => (st ? nav.navigate('Stay', { stayId: st.id }) : setCheckIn(r))}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T w="heavy" style={{ fontSize: 14.5 }}>{r.number}</T>
                <T w="heavy" style={{ fontSize: 10, color: st ? (due ? C.billed : C.accentStrong) : C.free }}>{st ? (due ? 'Check-out' : 'Occupied') : 'Free'}</T>
              </View>
              {st ? (<>
                <T w="heavy" style={{ fontSize: 13.5, color: due ? C.billed : C.accentStrong, marginTop: 4 }}>{rsShort(stayTotal(st, 0))}</T>
                <T numberOfLines={1} style={{ fontSize: 11, color: C.muted }}>{st.guest_name} · till {shortDate(st.check_out)}</T>
              </>) : (<>
                <T numberOfLines={1} style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{r.room_type} · {rsShort(r.rate)}</T>
                <T style={{ fontSize: 11, color: C.muted }}>Tap to check in</T>
              </>)}
            </Pressable>
          );
        }}
      />
      {checkIn ? <CheckInSheet room={checkIn} onClose={() => setCheckIn(null)} onDone={(id) => { setCheckIn(null); nav.navigate('Stay', { stayId: id }); }} /> : null}
    </>
  );
}

function CheckInSheet({ room, onClose, onDone }: { room: Room; onClose: () => void; onDone: (stayId: number) => void }) {
  const today = localDay();
  const [f, setF] = useState({ guest_name: '', guest_phone: '', guests: '1', check_in: today, check_out: addDays(today, 1), rate: fmt(room.rate).replace(/,/g, '').replace(/\.00$/, '') });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    try {
      if (!f.guest_name.trim()) throw new Error('Enter the guest’s name.');
      if (f.check_out < f.check_in) throw new Error('Check-out can’t be before check-in.');
      const guests = Number(f.guests || 1);
      if (!Number.isInteger(guests) || guests < 1) throw new Error('Guests must be 1 or more.');
      setBusy(true);
      const st = await q<{ id: number }>(sb.from('stays').insert({
        room_id: room.id, guest_name: f.guest_name.trim(), guest_phone: f.guest_phone.trim(), guests,
        check_in: f.check_in, check_out: f.check_out, rate: toPaise(f.rate),
      }).select('id').single());
      roomsChanged.current = true;
      toast(`${f.guest_name.trim()} checked in to Room ${room.number}`);
      onDone(st.id);
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title={`Check In · Room ${room.number}`}>
      <Field label="Guest name" value={f.guest_name} onChangeText={(v) => setF({ ...f, guest_name: v })} maxLength={80} autoFocus />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Field label="Phone" value={f.guest_phone} onChangeText={(v) => setF({ ...f, guest_phone: v })} keyboardType="phone-pad" maxLength={20} style={{ flex: 2 }} />
        <Field label="Guests" value={f.guests} onChangeText={(v) => setF({ ...f, guests: v })} keyboardType="number-pad" style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <DateField label="Check-in" value={f.check_in} onChange={(v) => setF({ ...f, check_in: v, check_out: f.check_out < v ? addDays(v, 1) : f.check_out })} />
        <DateField label="Check-out" value={f.check_out} min={f.check_in} onChange={(v) => setF({ ...f, check_out: v })} />
      </View>
      <Field label="Rate per night (₹)" value={f.rate} onChangeText={(v) => setF({ ...f, rate: v })} keyboardType="decimal-pad" />
      <Button title="Check In" onPress={save} busy={busy} />
    </Sheet>
  );
}

const s = StyleSheet.create({
  tile: { flex: 1, maxWidth: '32.2%', minHeight: 72, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 9, marginBottom: 8 },
  busy: { backgroundColor: '#FFF6EF', borderColor: '#F0C2A4' },
  due: { backgroundColor: '#F7F2FF', borderColor: '#D5C2FF' },
});

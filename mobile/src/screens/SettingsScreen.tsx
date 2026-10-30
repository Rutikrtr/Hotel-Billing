import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { rs, toPaise } from '../money';
import { useAppDispatch, useAppSelector } from '../store';
import { loginName, signOut, STAFF_DOMAIN } from '../store/auth';
import { hasPending } from '../store/cart';
import { setPrinter } from '../store/printer';
import { reloadSettings, reloadTables } from '../store/data';
import { q, sb } from '../supabase';
import type { Room, Table } from '../types';
import { Button, Card, Chip, Field, Header, initials, Pill, Sheet, T, ToggleRow } from '../ui/kit';
import { Icon } from '../ui/icons';
import { ask } from '../ui/dialog';
import { shareText } from '../ui/share';
import { isDesktop } from '../desktop';
import { useWide } from '../ui/wide';
import { C } from '../ui/theme';
import { toast } from '../ui/toast';
import type { Stack } from '../Root';
import TableLayoutCard from './TableLayoutCard';

const WEB = 'https://hotel-billing-v1.pages.dev';
const ROLE = { owner: 'Owner', manager: 'Manager', staff: 'Waiter' } as const;
const ROLE_COLOR = { owner: [C.accent, C.accentSoft], manager: [C.billed, C.billedSoft], staff: [C.free, C.freeSoft] } as const;
interface Member { email: string; user_id: string; role: keyof typeof ROLE; display_name: string | null }

const newPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; return Array.from({ length: 8 }, () => a[Math.floor(Math.random() * a.length)]).join(''); };
const nameOf = (m: Member) => m.display_name || (m.role === 'owner' ? 'Hotel owner' : loginName(m.email));

export default function SettingsScreen() {
  const wide = useWide();   // computer: Bills and Analytics are in the sidebar
  const nav = useNavigation<NativeStackNavigationProp<Stack>>();
  const dispatch = useAppDispatch();
  const { email, account } = useAppSelector((s) => s.auth);
  const settings = useAppSelector((s) => s.data.settings);
  const tables = useAppSelector((s) => s.data.tables);
  const printer = useAppSelector((s) => s.printer);
  const carts = useAppSelector((s) => s.cart);
  const owner = account?.role === 'owner';
  const feat = (k: string) => account?.features?.[k] === true;
  const [staff, setStaff] = useState<Member[]>([]);
  const [qr, setQr] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    try { setStaff(await q<Member[]>(sb.from('staff').select('email, user_id, role, display_name').order('created_at'))); } catch { /* shown as empty */ }
  }, []);
  useEffect(() => { if (owner) loadStaff(); }, [owner]);
  useEffect(() => {
    if (!feat('qr_menu')) return;
    q<string | null>(sb.rpc('my_menu_token')).then((t) => setQr(t ? `${WEB}/menu.html?m=${encodeURIComponent(t)}` : null), () => {});
  }, [account?.features?.qr_menu]);

  const me = staff.find((m) => m.email === email);
  const myName = me?.display_name || loginName(email);
  const unsaved = Object.values(carts).filter(hasPending).length;
  const out = () => {
    const go = () => dispatch(signOut());
    ask('Sign out', unsaved ? `${unsaved} order(s) on this phone are not saved yet. Sign out anyway?` : 'Sign out of Master Bill on this phone?', [{ text: 'Cancel' }, { text: 'Sign Out', style: 'destructive', onPress: go }]);
  };
  const role = account?.role ?? 'staff';

  // Phone: one column. Computer: two columns – your account, printer and links on the left; the hotel's
  // setup (bill details, table layout, tables, staff) on the right.
  const left = (
    <>
      <Card style={{ gap: 8 }}>
        <T w="heavy" style={{ fontSize: 15 }}>{isDesktop ? 'Printer & this computer' : 'Printer & this phone'}</T>
        <T style={{ color: C.muted }}>{printer.bill ? `Printer: ${printer.bill.name}${printer.separateKitchen && printer.kitchen ? ` · Kitchen: ${printer.kitchen.name}` : ''}` : (isDesktop ? 'No printer chosen on this computer' : 'No printer set up on this phone')}</T>
        {account?.can_bill || settings?.kot_tables ? <Button title="Printer Setup" onPress={() => nav.navigate('Printer')} /> : null}
        {isDesktop ? null : (
          <ToggleRow label="Voice search" hint="Mic in dish search: say “chicken biryani” instead of typing" value={printer.voice !== false} onChange={(v) => dispatch(setPrinter({ voice: v }))} />
        )}
      </Card>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[st.avatar, { backgroundColor: ROLE_COLOR[role][1] }]}><T w="heavy" style={{ color: ROLE_COLOR[role][0], fontSize: 15 }}>{initials(myName) || '?'}</T></View>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><T w="heavy" style={{ fontSize: 16, flexShrink: 1 }} numberOfLines={1}>{myName}</T><Pill label={ROLE[role]} color={ROLE_COLOR[role][0]} bg={ROLE_COLOR[role][1]} /></View>
            <T style={{ color: C.muted, fontSize: 12.5 }}>{email.endsWith(STAFF_DOMAIN) ? `Login ID ${loginName(email)}` : email}</T>
          </View>
        </View>
        <View style={st.info}>
          <Info k="Hotel" v={settings?.hotel_name ?? account?.hotel ?? ''} />
          {settings?.hotel_address ? <Info k="Address" v={settings.hotel_address} /> : null}
          {settings?.hotel_phone ? <Info k="Phone" v={settings.hotel_phone} /> : null}
        </View>
        {!owner ? <T style={{ color: C.muted, fontSize: 12 }}>{role === 'manager' ? 'You can take orders, print bills, take parcels and payments.' : 'You can take orders at tables.'} To change your password or role, ask the hotel owner.</T> : null}
      </Card>

      {account?.can_bill && (!wide || feat('trending')) ? (
        <Card style={{ gap: 2, paddingVertical: 4 }}>
          {wide ? null : <Row title="Bills" sub="Paid bills by day, waiting for payment, edit and reprint" onPress={() => nav.navigate('Bills')} />}
          {feat('trending') ? <>{wide ? null : <View style={st.sep} />}<Row title="Analytics" sub="Sales for any dates, busy hours, top dishes, download" onPress={() => nav.navigate('Analytics')} /></> : null}
        </Card>
      ) : null}
      {qr ? (
        <Card style={{ gap: 10, alignItems: 'center' }}>
          <T w="heavy" style={{ fontSize: 16, alignSelf: 'flex-start' }}>QR Menu</T>
          <T style={{ color: C.muted, fontSize: 12.5, alignSelf: 'flex-start' }}>Show this to customers. They scan it with the phone camera to see the menu.</T>
          <View style={{ padding: 12, backgroundColor: '#FFFFFF', borderRadius: 12 }}><QRCode value={qr} size={190} color={C.ink} /></View>
          <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
            <Button kind="secondary" title="Share Link" style={{ flex: 1 }} onPress={() => shareText(`${settings?.hotel_name ?? ''} menu: ${qr}`)} />
            <Button kind="secondary" title="Open Menu" style={{ flex: 1 }} onPress={() => Linking.openURL(qr)} />
          </View>
        </Card>
      ) : null}

      <Button kind="danger" title="Sign Out" onPress={out} />
      <T style={{ textAlign: 'center', color: C.muted, fontSize: 12 }}>Master Bill {isDesktop ? '2.5' : '2.0'} · Techyverve Solution Limited</T>
    </>
  );
  const right = (
    <>
      {owner && settings ? <BillDetails /> : null}
      {owner && feat('tables') && settings ? <TableLayoutCard /> : null}
      {owner && feat('tables') ? <Tables tables={tables} /> : null}
      {owner && feat('rooms') ? <Rooms /> : null}
      {owner ? <StaffLogins staff={staff} limit={settings?.staff_limit ?? 2} reload={loadStaff} /> : null}

    </>
  );
  if (wide) {
    return (
      <ScrollView style={{ backgroundColor: 'transparent' }} contentContainerStyle={{ padding: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
          <View style={{ flex: 2, gap: 14, minWidth: 0 }}>{left}</View>
          <View style={{ flex: 3, gap: 14, minWidth: 0 }}>{right}</View>
        </View>
      </ScrollView>
    );
  }
  return (
    <ScrollView style={{ backgroundColor: 'transparent' }} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
      <Header eyebrow="My account" title="Settings" />
      <Card style={{ gap: 8 }}>
        <T w="heavy" style={{ fontSize: 15 }}>{isDesktop ? 'Printer & this computer' : 'Printer & this phone'}</T>
        <T style={{ color: C.muted }}>{printer.bill ? `Printer: ${printer.bill.name}${printer.separateKitchen && printer.kitchen ? ` · Kitchen: ${printer.kitchen.name}` : ''}` : (isDesktop ? 'No printer chosen on this computer' : 'No printer set up on this phone')}</T>
        {account?.can_bill || settings?.kot_tables ? <Button title="Printer Setup" onPress={() => nav.navigate('Printer')} /> : null}
        {isDesktop ? null : (
          <ToggleRow label="Voice search" hint="Mic in dish search: say “chicken biryani” instead of typing" value={printer.voice !== false} onChange={(v) => dispatch(setPrinter({ voice: v }))} />
        )}
      </Card>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[st.avatar, { backgroundColor: ROLE_COLOR[role][1] }]}><T w="heavy" style={{ color: ROLE_COLOR[role][0], fontSize: 15 }}>{initials(myName) || '?'}</T></View>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><T w="heavy" style={{ fontSize: 16, flexShrink: 1 }} numberOfLines={1}>{myName}</T><Pill label={ROLE[role]} color={ROLE_COLOR[role][0]} bg={ROLE_COLOR[role][1]} /></View>
            <T style={{ color: C.muted, fontSize: 12.5 }}>{email.endsWith(STAFF_DOMAIN) ? `Login ID ${loginName(email)}` : email}</T>
          </View>
        </View>
        <View style={st.info}>
          <Info k="Hotel" v={settings?.hotel_name ?? account?.hotel ?? ''} />
          {settings?.hotel_address ? <Info k="Address" v={settings.hotel_address} /> : null}
          {settings?.hotel_phone ? <Info k="Phone" v={settings.hotel_phone} /> : null}
        </View>
        {!owner ? <T style={{ color: C.muted, fontSize: 12 }}>{role === 'manager' ? 'You can take orders, print bills, take parcels and payments.' : 'You can take orders at tables.'} To change your password or role, ask the hotel owner.</T> : null}
      </Card>

      {account?.can_bill && (!wide || feat('trending')) ? (
        <Card style={{ gap: 2, paddingVertical: 4 }}>
          {wide ? null : <Row title="Bills" sub="Paid bills by day, waiting for payment, edit and reprint" onPress={() => nav.navigate('Bills')} />}
          {feat('trending') ? <>{wide ? null : <View style={st.sep} />}<Row title="Analytics" sub="Sales for any dates, busy hours, top dishes, download" onPress={() => nav.navigate('Analytics')} /></> : null}
        </Card>
      ) : null}
      {owner && settings ? <BillDetails /> : null}
      {owner && feat('tables') && settings ? <TableLayoutCard /> : null}
      {owner && feat('tables') ? <Tables tables={tables} /> : null}
      {owner && feat('rooms') ? <Rooms /> : null}
      {owner ? <StaffLogins staff={staff} limit={settings?.staff_limit ?? 2} reload={loadStaff} /> : null}

      {qr ? (
        <Card style={{ gap: 10, alignItems: 'center' }}>
          <T w="heavy" style={{ fontSize: 16, alignSelf: 'flex-start' }}>QR Menu</T>
          <T style={{ color: C.muted, fontSize: 12.5, alignSelf: 'flex-start' }}>Show this to customers. They scan it with the phone camera to see the menu.</T>
          <View style={{ padding: 12, backgroundColor: '#FFFFFF', borderRadius: 12 }}><QRCode value={qr} size={190} color={C.ink} /></View>
          <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
            <Button kind="secondary" title="Share Link" style={{ flex: 1 }} onPress={() => shareText(`${settings?.hotel_name ?? ''} menu: ${qr}`)} />
            <Button kind="secondary" title="Open Menu" style={{ flex: 1 }} onPress={() => Linking.openURL(qr)} />
          </View>
        </Card>
      ) : null}

      <Button kind="danger" title="Sign Out" onPress={out} />
      <T style={{ textAlign: 'center', color: C.muted, fontSize: 12 }}>Master Bill {isDesktop ? '2.5' : '2.0'} · Techyverve Solution Limited</T>
    </ScrollView>
  );
}

/** A tappable row that opens another screen (only loads that screen's data when opened). */
function Row({ title, sub, onPress }: { title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.row, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      <View style={{ flex: 1 }}><T w="bold" style={{ fontSize: 14.5 }}>{title}</T><T style={{ color: C.muted, fontSize: 11.5 }}>{sub}</T></View>
      <Icon.chevR color={C.muted} size={18} />
    </Pressable>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}><T style={{ color: C.muted, width: 70 }}>{k}</T><T w="semibold" style={{ flex: 1 }}>{v}</T></View>;
}

/** Bill details the owner may change (name, address and phone are set by Techyverve). */
function BillDetails() {
  const dispatch = useAppDispatch();
  const s = useAppSelector((x) => x.data.settings)!;
  const [gstOn, setGstOn] = useState(s.tax_rate_bp > 0);
  const [rate, setRate] = useState(s.tax_rate_bp > 0 ? String(+(s.tax_rate_bp / 100).toFixed(2)) : '5');
  const [gstin, setGstin] = useState(s.hotel_gstin ?? '');
  const [quick, setQuick] = useState(s.quick_close !== false);
  const [kot, setKot] = useState(!!s.kot_tables);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    try {
      const bp = gstOn ? toPaise(rate) : 0;
      if (gstOn && bp <= 0) throw new Error('Enter a GST rate, like 5, or turn GST off.');
      if (bp > 10000) throw new Error('GST rate can’t be more than 100%.');
      setBusy(true);
      await q(sb.from('restaurants').update({ hotel_gstin: gstin.trim().toUpperCase(), tax_rate_bp: bp, quick_close: quick, kot_tables: kot }).eq('id', s.id));
      await dispatch(reloadSettings());
      toast('Changes saved');
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Card style={{ gap: 10 }}>
      <T w="heavy" style={{ fontSize: 15 }}>Bill Details</T>
      <View style={st.locked}><T style={{ color: C.muted, fontSize: 12 }}>Restaurant name 🔒</T><T w="bold">{s.hotel_name}</T></View>
      {s.hotel_address ? <View style={st.locked}><T style={{ color: C.muted, fontSize: 12 }}>Address 🔒</T><T w="bold">{s.hotel_address}</T></View> : null}
      <View style={st.locked}><T style={{ color: C.muted, fontSize: 12 }}>Phone 🔒</T><T w="bold">{s.hotel_phone || '—'}</T></View>
      <ToggleRow label="Charge GST on bills" value={gstOn} onChange={setGstOn} />
      {gstOn ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field label="GST rate (%)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" style={{ flex: 1 }} />
          <Field label="GSTIN" value={gstin} onChangeText={setGstin} autoCapitalize="characters" placeholder="Optional" style={{ flex: 1.6 }} />
        </View>
      ) : null}
      <ToggleRow label="Print Bill clears the table" hint="Off: the table waits for payment after printing" value={quick} onChange={setQuick} />
      <ToggleRow label="Kitchen tickets (KOT) for tables" hint="Send to Kitchen prints new dishes for the cook" value={kot} onChange={setKot} />
      <Button title="Save Changes" onPress={save} busy={busy} />
      <T style={{ color: C.muted, fontSize: 11.5 }}>To change the restaurant name, address or phone, contact Techyverve.</T>
    </Card>
  );
}

function Tables({ tables }: { tables: Table[] }) {
  const dispatch = useAppDispatch();
  const [edit, setEdit] = useState<{ id?: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const name = edit!.name.trim();
    if (!name) return toast('Enter a table name, like T1.', true);
    if (tables.some((t) => t.id !== edit!.id && t.name.trim().toLowerCase() === name.toLowerCase())) return toast(`There is already a table called ${name}. Each table needs its own name.`, true);
    setBusy(true);
    try {
      await q(edit!.id ? sb.from('dining_tables').update({ name }).eq('id', edit!.id) : sb.from('dining_tables').insert({ name, sort: tables.length + 1 }));
      await dispatch(reloadTables());
      toast(edit!.id ? 'Table renamed' : `Table ${name} added`);
      setEdit(null);
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  };
  const remove = (t: Table) => ask('Remove table', `Remove table ${t.name}?`, [{ text: 'Cancel' }, {
    text: 'Remove', style: 'destructive', onPress: async () => {
      try { await q(sb.from('dining_tables').delete().eq('id', t.id)); await dispatch(reloadTables()); toast(`Table ${t.name} removed`); } catch (err) { toast((err as Error).message, true); }
    },
  }]);
  return (
    <Card style={{ gap: 10 }}>
      <T w="heavy" style={{ fontSize: 15 }}>Tables · {tables.length}</T>
      <T style={{ color: C.muted, fontSize: 12 }}>Tap a table to rename it. Long-press to remove it.</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {tables.map((t) => <Chip key={t.id} label={t.name} onPress={() => setEdit({ id: t.id, name: t.name })} onLongPress={() => remove(t)} />)}
      </View>
      <Button kind="secondary" title="＋ Add Table" onPress={() => setEdit({ name: `T${tables.length + 1}` })} />
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Rename Table' : 'Add Table'}>
        {edit ? (<>
          <Field label="Table name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} maxLength={30} autoFocus />
          <Button title={edit.id ? 'Save' : 'Add Table'} onPress={save} busy={busy} />
          {edit.id ? <Button kind="danger" title="Remove Table" onPress={() => { const t = tables.find((x) => x.id === edit.id); setEdit(null); if (t) remove(t); }} /> : null}
        </>) : null}
      </Sheet>
    </Card>
  );
}

function Rooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [edit, setEdit] = useState<{ id?: number; number: string; room_type: string; rate: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { q<Room[]>(sb.from('lodging_rooms').select('*').order('sort').order('number')).then(setRooms, () => {}); }, []);
  useEffect(load, [load]);
  const save = async () => {
    const e = edit!;
    try {
      if (!e.number.trim()) throw new Error('Enter the room number, like 101.');
      setBusy(true);
      const row = { number: e.number.trim(), room_type: e.room_type.trim() || 'Standard', rate: toPaise(e.rate) };
      await q(e.id ? sb.from('lodging_rooms').update(row).eq('id', e.id) : sb.from('lodging_rooms').insert({ ...row, sort: rooms.length + 1 }));
      toast(e.id ? `Room ${row.number} saved` : `Room ${row.number} added`);
      setEdit(null); load();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  };
  const remove = (r: Room) => ask('Remove room', `Remove room ${r.number}?`, [{ text: 'Cancel' }, {
    text: 'Remove', style: 'destructive', onPress: async () => {
      try { await q(sb.from('lodging_rooms').delete().eq('id', r.id)); toast(`Room ${r.number} removed`); setEdit(null); load(); } catch (err) { toast((err as Error).message, true); }
    },
  }]);
  return (
    <Card style={{ gap: 10 }}>
      <T w="heavy" style={{ fontSize: 15 }}>Rooms · {rooms.length}</T>
      <T style={{ color: C.muted, fontSize: 12 }}>Tap a room to change its type or rate.</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {rooms.map((r) => <Chip key={r.id} label={`${r.number} · ${rs(r.rate).replace('.00', '')}`} onPress={() => setEdit({ id: r.id, number: r.number, room_type: r.room_type, rate: String(r.rate / 100) })} />)}
      </View>
      <Button kind="secondary" title="＋ Add Room" onPress={() => setEdit({ number: '', room_type: 'Standard', rate: '' })} />
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Room ${edit.number}` : 'Add Room'}>
        {edit ? (<>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Field label="Room number" value={edit.number} onChangeText={(v) => setEdit({ ...edit, number: v })} style={{ flex: 1 }} autoFocus={!edit.id} />
            <Field label="Type" value={edit.room_type} onChangeText={(v) => setEdit({ ...edit, room_type: v })} placeholder="Deluxe" style={{ flex: 1.4 }} />
          </View>
          <Field label="Rate per night (₹)" value={edit.rate} onChangeText={(v) => setEdit({ ...edit, rate: v })} keyboardType="decimal-pad" />
          <Button title={edit.id ? 'Save' : 'Add Room'} onPress={save} busy={busy} />
          {edit.id ? <Button kind="danger" title="Remove Room" onPress={() => { const r = rooms.find((x) => x.id === edit.id); if (r) remove(r); }} /> : null}
        </>) : null}
      </Sheet>
    </Card>
  );
}

function StaffLogins({ staff, limit, reload }: { staff: Member[]; limit: number; reload: () => Promise<void> }) {
  const [add, setAdd] = useState<{ name: string; password: string; role: 'staff' | 'manager' } | null>(null);
  const [made, setMade] = useState<{ name: string; login: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const used = staff.filter((m) => m.role !== 'owner').length;
  const create = async () => {
    if (!add!.name.trim()) return toast('Enter the staff member’s name.', true);
    if (add!.password.length < 6) return toast('Password needs at least 6 characters.', true);
    setBusy(true);
    try {
      const email = await q<string>(sb.rpc('owner_add_staff', { p_name: add!.name.trim(), p_password: add!.password, p_role: add!.role }));
      setMade({ name: add!.name.trim(), login: loginName(email), password: add!.password });
      setAdd(null);
      reload();
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  };
  const [pw, setPw] = useState<{ m: Member; password: string } | null>(null);
  const role = async (m: Member) => {
    try { await q(sb.rpc('owner_set_staff_role', { p_email: m.email, p_role: m.role === 'manager' ? 'staff' : 'manager' })); toast(`${nameOf(m)} is now ${m.role === 'manager' ? 'a Waiter' : 'a Manager'}`); reload(); }
    catch (err) { toast((err as Error).message, true); }
  };
  const setPassword = async () => {
    if (pw!.password.length < 6) return toast('Password needs at least 6 characters.', true);
    setBusy(true);
    try { await q(sb.rpc('owner_reset_staff_password', { p_email: pw!.m.email, p_password: pw!.password })); setMade({ name: nameOf(pw!.m), login: loginName(pw!.m.email), password: pw!.password }); setPw(null); }
    catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  };
  const remove = (m: Member) => ask('Remove login', `Remove ${nameOf(m)}? They won’t be able to sign in.`, [{ text: 'Cancel' }, {
    text: 'Remove', style: 'destructive', onPress: async () => { try { await q(sb.from('staff').delete().eq('email', m.email)); toast('Login removed'); reload(); } catch (err) { toast((err as Error).message, true); } },
  }]);
  return (
    <Card style={{ gap: 10 }}>
      <T w="heavy" style={{ fontSize: 15 }}>Staff Logins</T>
      <T style={{ color: C.muted, fontSize: 12 }}>Waiter adds dishes to tables · Manager also bills, parcels and payments. </T>
      {staff.map((m) => (
        <View key={m.email} style={st.member}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[st.avatar, { width: 38, height: 38, backgroundColor: ROLE_COLOR[m.role][1] }]}><T w="heavy" style={{ color: ROLE_COLOR[m.role][0] }}>{initials(nameOf(m)) || '?'}</T></View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><T w="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{nameOf(m)}</T><Pill label={ROLE[m.role]} color={ROLE_COLOR[m.role][0]} bg={ROLE_COLOR[m.role][1]} /></View>
              {m.email.endsWith(STAFF_DOMAIN)
                ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><T style={{ color: C.muted, fontSize: 11.5 }}>Login ID</T><View style={st.code}><T w="bold" style={{ fontSize: 11.5 }}>{loginName(m.email)}</T></View></View>
                : <T style={{ color: C.muted, fontSize: 11.5 }}>{m.email}</T>}
            </View>
          </View>
          {m.role !== 'owner' ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
              <Pressable style={st.mini} onPress={() => role(m)}><T w="bold" style={st.miniTxt}>⇄ {m.role === 'manager' ? 'To Waiter' : 'To Manager'}</T></Pressable>
              <Pressable style={st.mini} onPress={() => setPw({ m, password: newPassword() })}><T w="bold" style={st.miniTxt}>🔑 Password</T></Pressable>
              <Pressable style={[st.mini, { borderColor: '#E9B4B4' }]} onPress={() => remove(m)}><T w="bold" style={[st.miniTxt, { color: C.danger }]}>Remove</T></Pressable>
            </View>
          ) : null}
        </View>
      ))}
      <T w="semibold" style={{ color: used >= limit ? C.danger : C.muted, fontSize: 12.5 }}>{limit === 0 ? 'Your plan is for the owner login only.' : `${used} of ${limit} staff login${limit === 1 ? '' : 's'} used`}</T>
      {used < limit ? <Button title="＋ Add Staff Login" onPress={() => setAdd({ name: '', password: newPassword(), role: 'staff' })} /> : <T style={{ color: C.muted, fontSize: 12 }}>Need more logins? Contact Techyverve to upgrade your plan.</T>}

      <Sheet open={!!add} onClose={() => setAdd(null)} title="Add Staff Login">
        {add ? (<>
          <Field label="Staff name" value={add.name} onChangeText={(v) => setAdd({ ...add, name: v })} placeholder="e.g. Ramesh Patil" maxLength={40} autoFocus />
          <Field label="Password" value={add.password} onChangeText={(v) => setAdd({ ...add, password: v })} autoCapitalize="none" />
          <View style={{ flexDirection: 'row' }}>
            <Chip label="Waiter" on={add.role === 'staff'} onPress={() => setAdd({ ...add, role: 'staff' })} />
            <Chip label="Manager" on={add.role === 'manager'} onPress={() => setAdd({ ...add, role: 'manager' })} />
          </View>
          <Button title="Create Login" onPress={create} busy={busy} />
        </>) : null}
      </Sheet>
      <Sheet open={!!pw} onClose={() => setPw(null)} title={`New password · ${pw ? nameOf(pw.m) : ''}`}>
        {pw ? (<>
          <Field label="New password" value={pw.password} onChangeText={(v) => setPw({ ...pw, password: v })} autoCapitalize="none" autoFocus />
          <Button title="Set Password" onPress={setPassword} busy={busy} />
        </>) : null}
      </Sheet>
      <Sheet open={!!made} onClose={() => setMade(null)} title="Login details ✓">
        {made ? (<>
          <T style={{ color: C.muted }}>Give these to {made.name}. They sign in with the Master Bill app.</T>
          <View style={[st.locked, { gap: 6 }]}>
            <Info k="Login ID" v={made.login} />
            <Info k="Password" v={made.password} />
          </View>
          <Button title="Share" onPress={() => shareText(`Master Bill login\nLogin ID: ${made.login}\nPassword: ${made.password}`)} />
          <Button kind="secondary" title="Done" onPress={() => setMade(null)} />
        </>) : null}
      </Sheet>
    </Card>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  sep: { height: 1, backgroundColor: C.line },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  info: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, gap: 6 },
  locked: { backgroundColor: C.surface2, borderRadius: 12, padding: 10, gap: 2 },
  member: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 },
  code: { backgroundColor: C.surface2, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  mini: { flex: 1, height: 32, borderRadius: 9, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  miniTxt: { fontSize: 11.5, color: C.text },
});

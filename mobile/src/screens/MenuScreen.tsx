import React, { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Switch, TextInput, View } from 'react-native';
import { fmt, rs, toPaise } from '../money';
import { useAppDispatch, useAppSelector } from '../store';
import { patchMenuItem, reloadMenu } from '../store/data';
import { q, sb } from '../supabase';
import type { MenuItem } from '../types';
import { Icon } from '../ui/icons';
import { Button, Chip, Diet, Empty, Field, Header, SearchBox, Sheet, T, ToggleRow } from '../ui/kit';
import { C, F } from '../ui/theme';
import { toast } from '../ui/toast';
import { MicButton } from '../ui/Mic';
import { findDishes } from '../match';

const DEFAULT_CATEGORIES = ['Starters', 'Main Course', 'Breads', 'Rice', 'Beverages', 'Desserts', 'Others'];
type Draft = { id?: number; name: string; category: string; newCategory: string; price: string; is_veg: boolean; available: boolean; is_favorite: boolean };

/** Owner's menu: add, edit, delete, favourite and sold-out, like the web app's Menu screen. */
export default function MenuScreen() {
  const dispatch = useAppDispatch();
  const menu = useAppSelector((s) => s.data.menu);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const categories = useMemo(() => [...new Set(menu.map((m) => m.category))], [menu]);
  const choices = [...new Set([...categories, ...DEFAULT_CATEGORIES])];
  const sections = useMemo(() => {
    const found = new Set(findDishes(search, menu).map((m) => m.id));
    return categories.map((c) => ({ title: c, data: menu.filter((m) => m.category === c && found.has(m.id)) })).filter((x) => x.data.length);
  }, [menu, categories, search]);

  const refresh = async () => { setRefreshing(true); await dispatch(reloadMenu()); setRefreshing(false); };
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try { await fn(); await dispatch(reloadMenu()); if (done) toast(done); return true; } catch (err) { toast((err as Error).message, true); return false; }
  };

  /** Switch or star: move on screen first, save behind; put it back if the save fails. */
  const quick = async (m: MenuItem, change: Partial<MenuItem>, done?: string) => {
    const before = Object.fromEntries(Object.keys(change).map((k) => [k, m[k as keyof MenuItem]]));
    dispatch(patchMenuItem({ id: m.id, ...change }));
    try { await q(sb.from('menu_items').update(change).eq('id', m.id)); if (done) toast(done); }
    catch (err) { dispatch(patchMenuItem({ id: m.id, ...before })); toast((err as Error).message, true); }
  };

  const openNew = () => setDraft({ name: '', category: categories[0] ?? 'Others', newCategory: '', price: '', is_veg: true, available: true, is_favorite: false });
  const openEdit = (m: MenuItem) => setDraft({ id: m.id, name: m.name, category: m.category, newCategory: '', price: fmt(m.price).replace(/,/g, '').replace(/\.00$/, ''), is_veg: m.is_veg, available: m.available, is_favorite: m.is_favorite });

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const category = (draft.category === '__new__' ? draft.newCategory : draft.category).trim();
    if (!name) return toast('Enter a name for this item.', true);
    if (!category) return toast('Type a name for the new category.', true);
    if (!draft.price.trim()) return toast('Enter the rate in rupees.', true);
    let price: number;
    try { price = toPaise(draft.price); } catch (err) { return toast((err as Error).message, true); }
    setBusy(true);
    const row = { name, category, price, is_veg: draft.is_veg, available: draft.available, is_favorite: draft.is_favorite };
    const ok = await run(() => q(draft.id ? sb.from('menu_items').update(row).eq('id', draft.id) : sb.from('menu_items').insert(row)), draft.id ? `${name} updated` : `${name} added`);
    setBusy(false);
    if (ok) setDraft(null);
  };
  const remove = () => {
    if (!draft?.id) return;
    Alert.alert('Delete item', `Delete ${draft.name} from the menu? Past bills keep it.`, [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { if (await run(() => q(sb.from('menu_items').delete().eq('id', draft.id)), `${draft.name} deleted`)) setDraft(null); } },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <SectionList
        sections={sections}
        keyExtractor={(m) => String(m.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: 12, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[C.brand1]} />}
        ListHeaderComponent={
          <View>
            <Header eyebrow={`${menu.length} item${menu.length === 1 ? '' : 's'}`} title="Menu" />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SearchBox value={search} onChange={setSearch} placeholder="Search or tap the mic" style={st.search} />
              <MicButton onText={setSearch} hints={menu.map((m) => m.name)} />
            </View>
            <T style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>Tap ★ to show a dish first when taking orders. Switch off a dish when it is sold out.</T>
          </View>
        }
        ListEmptyComponent={<View style={{ marginTop: 14 }}><Empty icon="📋" text={search ? 'No dish matches your search.' : 'Your menu is empty. Tap “Add Item” to add your first dish.'} /></View>}
        renderSectionHeader={({ section }) => <T w="heavy" style={st.cat}>{section.title.toUpperCase()} · {section.data.length}</T>}
        renderItem={({ item: m, index, section }) => (
          <View style={[st.row, index === 0 && st.first, index === section.data.length - 1 && st.last]}>
            <Diet veg={m.is_veg} />
            <Pressable style={{ flex: 1 }} onPress={() => openEdit(m)} accessibilityRole="button" accessibilityLabel={`Edit ${m.name}`}>
              <T w="bold" style={{ opacity: m.available ? 1 : 0.5 }}>{m.name}</T>
              <T style={{ color: C.muted, fontSize: 12.5 }}>{rs(m.price)}{m.available ? '' : ' · Sold out'}</T>
            </Pressable>
            <Pressable hitSlop={10} onPress={() => quick(m, { is_favorite: !m.is_favorite }, m.is_favorite ? `${m.name} removed from favourites` : `★ ${m.name} will show first`)}
              accessibilityRole="button" accessibilityLabel={m.is_favorite ? 'Remove from favourites' : 'Mark as favourite'}>
              {m.is_favorite ? <Icon.star color="#F59E0B" /> : <Icon.starOff color="#C9BBB0" />}
            </Pressable>
            <Switch value={m.available} onValueChange={(v) => { quick(m, { available: v }); }} trackColor={{ true: C.free, false: '#D6CCC4' }} thumbColor="#FFFFFF" />
          </View>
        )}
      />
      <View style={st.fab}><Button title="＋ Add Item" onPress={openNew} /></View>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit Item' : 'Add Item'}>
        {draft ? (
          <>
            <Field label="Name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="e.g. Paneer Butter Masala" autoFocus={!draft.id} />
            <Field label="Rate (₹)" value={draft.price} onChangeText={(v) => setDraft({ ...draft, price: v })} keyboardType="decimal-pad" placeholder="0" />
            <View style={{ gap: 6 }}>
              <T w="semibold" style={{ fontSize: 12.5, color: C.muted }}>Category</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[...choices, '__new__'].map((c) => <Chip key={c} label={c === '__new__' ? '＋ New' : c} on={draft.category === c} onPress={() => setDraft({ ...draft, category: c })} />)}
              </View>
              {draft.category === '__new__' ? <Field label="New category name" value={draft.newCategory} onChangeText={(v) => setDraft({ ...draft, newCategory: v })} placeholder="e.g. Ice Cream" autoFocus /> : null}
            </View>
            <ToggleRow label="Vegetarian" value={draft.is_veg} onChange={(v) => setDraft({ ...draft, is_veg: v })} />
            <ToggleRow label="Available today" value={draft.available} onChange={(v) => setDraft({ ...draft, available: v })} />
            <ToggleRow label="★ Favourite" hint="Shows first when taking orders" value={draft.is_favorite} onChange={(v) => setDraft({ ...draft, is_favorite: v })} />
            {draft.id ? <T style={{ color: C.muted, fontSize: 12 }}>Tables already running keep the old rate. New orders use the new one.</T> : null}
            <Button title={draft.id ? 'Save Changes' : 'Add to Menu'} onPress={save} busy={busy} />
            {draft.id ? <Button kind="danger" title="Delete Item" onPress={remove} /> : null}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  search: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 12, fontFamily: F.regular, fontSize: 15, color: C.text },
  cat: { fontSize: 12, color: C.muted, letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderColor: C.line, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  first: { borderTopWidth: 1, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  last: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  fab: { position: 'absolute', left: 12, right: 12, bottom: 12 },
});

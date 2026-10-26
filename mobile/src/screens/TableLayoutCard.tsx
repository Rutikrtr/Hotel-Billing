import React, { useEffect, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, View } from 'react-native';
import { useAppDispatch, useAppSelector } from '../store';
import { reloadSettings } from '../store/data';
import { q, sb } from '../supabase';
import { BLANK, areaTables, cellSpan } from '../types';
import type { LayoutArea, Table, TableLayout } from '../types';
import { Button, Card, Chip, Field, Sheet, T, ToggleRow } from '../ui/kit';
import { ask, closeAsk } from '../ui/dialog';
import { C } from '../ui/theme';
import { toast } from '../ui/toast';

const SIZES: [number, number][] = [[2, 2], [3, 3], [3, 4], [4, 4], [4, 5], [5, 5]];
const MAX = 8;

/** Put the tables of an area into a grid of a new size, keeping their order; extra ones come off the plan. */
function resize(a: LayoutArea, cols: number, rows: number): LayoutArea {
  const used = a.cells.filter((c) => c != null).length;
  const old = a.cols === cols ? a.cells.slice(0, cols * rows) : null;
  // Same width and nothing cut off: keep the plan as drawn (big tables, blanks). Otherwise refill in order.
  const ids = areaTables(a).slice(0, cols * rows);
  const cells = old && old.filter((c) => c != null).length === used
    ? [...old, ...Array(Math.max(0, cols * rows - old.length)).fill(null)]
    : [...ids, ...Array(cols * rows - ids.length).fill(null)];
  return { ...a, cols, rows, cells };
}

/** A first plan: one hall with every table, 3 or 4 across. */
function starter(tables: Table[]): TableLayout {
  const cols = tables.length > 9 ? 4 : 3;
  const rows = Math.max(2, Math.ceil(tables.length / cols));
  const cells = [...tables.map((t) => t.id), ...Array(cols * rows - tables.length).fill(null)];
  return { on: true, areas: [{ id: `a${Date.now()}`, name: 'Hall', cols, rows, cells }] };
}

/**
 * Owner's floor plan: areas (Hall 1, Hall 2, Garden…) with a grid of spots; tap a grey spot to put a table there.
 * Waiters and managers then see their tables the same way. Saved with one request; turning it off goes back
 * to the plain list of tables (the plan is kept for later).
 */
export default function TableLayoutCard() {
  const dispatch = useAppDispatch();
  const s = useAppSelector((x) => x.data.settings)!;
  const tables = useAppSelector((x) => x.data.tables);
  const layout: TableLayout = s.table_layout ?? { on: false, areas: [] };
  const [edit, setEdit] = useState<LayoutArea | null>(null);
  const [pick, setPick] = useState<number | null>(null);   // which empty spot is choosing a table
  const [busy, setBusy] = useState(false);

  const save = async (next: TableLayout, done?: string) => {
    setBusy(true);
    try {
      await q(sb.from('restaurants').update({ table_layout: next }).eq('id', s.id));
      await dispatch(reloadSettings());
      if (done) toast(done);
      return true;
    } catch (err) { toast((err as Error).message, true); return false; } finally { setBusy(false); }
  };
  // The switch moves at once; the change is saved after the owner confirms, and moves back if saving fails.
  const [on, setOn] = useState(layout.on);
  useEffect(() => setOn(layout.on), [layout.on]);
  const toggle = (next: boolean) => {
    ask(next ? 'Turn on table layout?' : 'Turn off table layout?',
      next ? 'Tables will show by area (Hall, Garden…) in the places you set. Everyone on staff sees it.' : 'Tables go back to one simple list. Your areas are kept for later.',
      [{ text: 'Cancel', style: 'cancel' }, {
        text: next ? 'Turn On' : 'Turn Off', onPress: async () => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOn(next);
          const ok = await save(next && !layout.areas.length ? starter(tables) : { ...layout, on: next }, next ? 'Table layout on' : 'Back to the simple list of tables');
          if (!ok) setOn(!next);
        },
      }]);
  };

  const nameOf = (id: number | null) => tables.find((t) => t.id === id)?.name;
  const placedElsewhere = (areaId: string) => new Set(layout.areas.filter((a) => a.id !== areaId).flatMap(areaTables));
  const saveArea = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { toast('Give this area a name, like Hall 1 or Garden.', true); return; }
    const exists = layout.areas.some((a) => a.id === edit.id);
    const areas = exists ? layout.areas.map((a) => (a.id === edit.id ? { ...edit, name: edit.name.trim() } : a)) : [...layout.areas, { ...edit, name: edit.name.trim() }];
    if (await save({ on: true, areas }, `${edit.name.trim()} saved`)) setEdit(null);
  };
  const removeArea = () => {
    if (!edit) return;
    ask('Remove area', `Remove ${edit.name}? Its tables stay; they move to “Other tables”.`, [{ text: 'Cancel' }, {
      text: 'Remove', style: 'destructive', onPress: async () => { if (await save({ ...layout, areas: layout.areas.filter((a) => a.id !== edit.id) }, 'Area removed')) setEdit(null); },
    }]);
  };

  return (
    <Card style={{ gap: 10 }}>
      <ToggleRow label="Table layout by area" hint={on ? 'Tables show by hall, in the places you set' : 'Off: all tables in one simple list'} value={on} onChange={toggle} />
      {on && layout.on ? (
        <>
          {layout.areas.map((a) => (
            <Pressable key={a.id} onPress={() => setEdit({ ...a, cells: [...a.cells] })} style={st.areaRow} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <T w="bold">{a.name}</T>
                <T style={{ color: C.muted, fontSize: 11.5 }}>{a.cols} × {a.rows} · {areaTables(a).length} tables</T>
              </View>
              <MiniGrid a={a} />
            </Pressable>
          ))}
          <Button kind="secondary" small title="＋ Add Area" disabled={busy} onPress={() => setEdit({ id: `a${Date.now()}`, name: `Hall ${layout.areas.length + 1}`, cols: 3, rows: 3, cells: Array(9).fill(null) })} />
        </>
      ) : null}

      <Sheet open={!!edit} onClose={() => { setEdit(null); setPick(null); }} title={edit && layout.areas.some((a) => a.id === edit.id) ? `Edit ${edit.name}` : 'New area'}>
        {edit ? (<>
          <Field label="Area name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} placeholder="Hall 1, Garden, AC Room…" maxLength={30} />
          <View style={{ gap: 6 }}>
            <T w="semibold" style={{ fontSize: 12.5, color: C.muted }}>Size (across × down)</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {SIZES.map(([c, r]) => <Chip key={`${c}x${r}`} label={`${c} × ${r}`} on={edit.cols === c && edit.rows === r} onPress={() => setEdit(resize(edit, c, r))} />)}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Stepper label="Across" n={edit.cols} onChange={(n) => setEdit(resize(edit, n, edit.rows))} />
              <Stepper label="Down" n={edit.rows} onChange={(n) => setEdit(resize(edit, edit.cols, n))} />
            </View>
          </View>
          <T style={{ color: C.muted, fontSize: 12 }}>Tap a grey spot to put a table or a blank space there. Tap a table to make it bigger (up to 4 spots) or take it off.</T>
          <View style={st.plan}>
            {Array.from({ length: edit.rows }, (_, r) => (
              <View key={r} style={st.planRow}>
                {Array.from({ length: edit.cols }, (_, c) => {
                  const i = r * edit.cols + c;
                  const id = edit.cells[i];
                  const span = cellSpan(edit, r, c);
                  if (!span) return null;
                  const blank = id === BLANK;
                  const put = (changes: [number, number | null][]) => { const cells = [...edit.cells]; changes.forEach(([k, v]) => { cells[k] = v; }); setEdit({ ...edit, cells }); setPick(null); };
                  const tapTable = (tid: number) => {
                    // A table grows into free (grey) spots on its right first, then on its left, so a table at
                    // the end of a row or in a corner can still be made bigger. Up to 4 spots across.
                    const free = (k: number) => k >= 0 && k < edit.cols && edit.cells[r * edit.cols + k] == null;
                    let lo = c, hi = c + span - 1;   // columns the table covers now
                    const startFor: number[] = [];   // left column for each size 1..4
                    startFor[span] = c;
                    for (let k = span + 1; k <= 4; k++) {
                      if (free(hi + 1)) hi++; else if (free(lo - 1)) lo--; else break;
                      startFor[k] = lo;
                    }
                    for (let k = span - 1; k >= 1; k--) startFor[k] = c;   // smaller: keep the left edge
                    const max = startFor.length - 1;
                    const resizeTo = (k: number) => {
                      const s = r * edit.cols + startFor[k];
                      put([...Array.from({ length: span }, (_, j): [number, number | null] => [i + j, null]), ...Array.from({ length: k }, (_, j): [number, number | null] => [s + j, tid])]);
                    };
                    ask(nameOf(tid) ?? 'Table', max > 1 ? 'How many spots across should this table take? Bigger tables suit families and groups.' : 'There is no free spot next to it in this row. Free a spot beside it (or make the area wider) to make it bigger.', [
                      { text: 'Take off the plan', style: 'destructive', onPress: () => put(Array.from({ length: span }, (_, j): [number, number | null] => [i + j, null])) },
                      { text: 'Done', style: 'cancel' },
                    ], max > 1 ? (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, alignSelf: 'stretch' }}>
                        {[1, 2, 3, 4].map((k) => {
                          const can = k <= max;
                          return (
                            <Pressable key={k} disabled={!can} onPress={() => { closeAsk(); resizeTo(k); }} accessibilityRole="button" accessibilityLabel={`${k} spots`}
                              style={({ pressed }) => [st.size, k === span && st.sizeOn, !can && { opacity: 0.35 }, pressed && { transform: [{ scale: 0.96 }] }]}>
                              <View style={{ flexDirection: 'row', gap: 2 }}>{Array.from({ length: k }, (_, j) => <View key={j} style={[st.sizeDot, k === span && { backgroundColor: '#FFFFFF' }]} />)}</View>
                              <T w="heavy" style={{ fontSize: 12, color: k === span ? '#FFFFFF' : C.text }}>{k === 1 ? '1 spot' : `${k} spots`}</T>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null, 'info');
                  };
                  return (
                    <Pressable key={c} style={[st.spot, span > 1 && { flexGrow: span, flexBasis: 6 * (span - 1) }, id != null && !blank && st.spotOn, blank && st.blank, pick === i && st.spotPick]} accessibilityRole="button"
                      onPress={() => {
                        if (blank) put([[i, null]]);
                        else if (id != null) tapTable(id);
                        else setPick(pick === i ? null : i);
                      }}>
                      <T w="heavy" numberOfLines={1} style={{ fontSize: edit.cols > 4 ? 10.5 : 12, color: blank ? '#C9BDB3' : id != null ? '#FFFFFF' : '#B5A99F' }}>{blank ? 'blank' : id != null ? `${nameOf(id) ?? '?'}${span > 1 ? ` · ${span} wide` : ''}` : '+'}</T>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
          {pick != null ? (() => {
            const taken = new Set([...placedElsewhere(edit.id), ...areaTables(edit)]);
            const free = tables.filter((t) => !taken.has(t.id));
            return (
              <View style={{ gap: 6 }}>
                <T w="semibold" style={{ fontSize: 12.5 }}>Put which table here?</T>
                <Chip label="▢ Blank space (no table)" onPress={() => { const cells = [...edit.cells]; cells[pick] = BLANK; setEdit({ ...edit, cells }); setPick(null); }} />
                {free.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {free.map((t) => <Chip key={t.id} label={t.name} onPress={() => { const cells = [...edit.cells]; cells[pick] = t.id; setEdit({ ...edit, cells }); setPick(null); }} />)}
                  </View>
                ) : <T style={{ color: C.muted, fontSize: 12 }}>Every table already has a place. Add tables in the Tables card below.</T>}
              </View>
            );
          })() : null}
          <Button title="Save Area" onPress={saveArea} busy={busy} />
          {layout.areas.some((a) => a.id === edit.id) ? <Button kind="danger" small title="Remove Area" onPress={removeArea} /> : null}
        </>) : null}
      </Sheet>
    </Card>
  );
}

function Stepper({ label, n, onChange }: { label: string; n: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface2, borderRadius: 12, padding: 6 }}>
      <T style={{ flex: 1, color: C.muted, fontSize: 12.5, paddingLeft: 4 }}>{label}</T>
      <Pressable hitSlop={8} style={st.step} onPress={() => n > 1 && onChange(n - 1)}><T w="heavy" style={{ color: C.accent, fontSize: 16 }}>−</T></Pressable>
      <T w="heavy" style={{ minWidth: 16, textAlign: 'center' }}>{n}</T>
      <Pressable hitSlop={8} style={st.step} onPress={() => n < MAX && onChange(n + 1)}><T w="heavy" style={{ color: C.accent, fontSize: 16 }}>+</T></Pressable>
    </View>
  );
}

function MiniGrid({ a }: { a: LayoutArea }) {
  return (
    <View style={{ gap: 2 }}>
      {Array.from({ length: Math.min(a.rows, 5) }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 2 }}>
          {Array.from({ length: Math.min(a.cols, 6) }, (_, c) => <View key={c} style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: a.cells[r * a.cols + c] == null ? '#E5DDD6' : a.cells[r * a.cols + c] === BLANK ? 'transparent' : C.brand1 }} />)}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface2, borderRadius: 12, padding: 10 },
  plan: { backgroundColor: C.surface2, borderRadius: 14, padding: 8, gap: 6 },
  planRow: { flexDirection: 'row', gap: 6 },
  spot: { flex: 1, height: 44, borderRadius: 10, backgroundColor: '#ECE5DF', borderWidth: 1, borderColor: '#E0D6CE', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  size: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  sizeOn: { backgroundColor: C.accent, borderColor: C.accent },
  sizeDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.accent },
  blank: { backgroundColor: 'transparent', borderColor: '#E6DDD5' },
  spotOn: { backgroundColor: C.brand1, borderColor: C.brand1, borderStyle: 'solid' },
  spotPick: { borderColor: C.accent, borderWidth: 2, backgroundColor: C.accentSoft },
  step: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
});

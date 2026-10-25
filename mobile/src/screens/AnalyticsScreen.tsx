import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { addDays, daysBetween, hourLabel, localDay, shortDate, startOf, WEEKDAYS } from '../dates';
import { rsShort } from '../money';
import { useAppSelector } from '../store';
import { q, sb } from '../supabase';
import { Card, Chip, Diet, Empty, Header, SectionTitle, SummaryCard, T } from '../ui/kit';
import { C } from '../ui/theme';

interface Report {
  totals: { sales: number; bills: number; items: number; discount: number; tax: number; parcels: number; parcel_sales: number; dine_in_minutes: number | null };
  prev: { sales: number; bills: number };
  dishes: { menu_item_id: number | null; name: string; qty: number; revenue: number; prev_qty: number }[];
  days: { day: string; bills: number; sales: number }[];
  hours: { hour: number; bills: number; sales: number }[];
  weekdays: { dow: number; bills: number; sales: number }[];
  methods: { method: string; bills: number; sales: number }[];
}

const RANGES: Record<string, [string, () => [string, string]]> = {
  today: ['Today', () => [localDay(), localDay()]],
  yesterday: ['Yesterday', () => [addDays(localDay(), -1), addDays(localDay(), -1)]],
  week: ['7 days', () => [addDays(localDay(), -6), localDay()]],
  d30: ['30 days', () => [addDays(localDay(), -29), localDay()]],
  month: ['This month', () => { const n = new Date(); return [localDay(new Date(n.getFullYear(), n.getMonth(), 1)), localDay()]; }],
  last: ['Last month', () => { const n = new Date(); return [localDay(new Date(n.getFullYear(), n.getMonth() - 1, 1)), localDay(new Date(n.getFullYear(), n.getMonth(), 0))]; }],
};
const METHOD_COLOR: Record<string, string> = { Cash: '#15803D', UPI: '#6D28D9', Card: '#0E7490' };
const money = (p: number) => rsShort(Number(p));

/** Sales for a date range: one sales_report request, same numbers as the web app's Analytics. */
export default function AnalyticsScreen() {
  const menu = useAppSelector((s) => s.data.menu);
  const [range, setRange] = useState('week');
  const [sort, setSort] = useState<'qty' | 'revenue'>('qty');
  const [all, setAll] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [from, to] = RANGES[range][1]();
  const days = daysBetween(from, to);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, t] = RANGES[range][1]();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      setReport(await q<Report>(sb.rpc('sales_report', { p_from: startOf(f), p_to: startOf(addDays(t, 1)), p_tz: tz })));
      setError(null);
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }, [range]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const change = (now: number, before: number) => {
    if (!before) return now ? { text: 'New', color: C.free } : { text: '—', color: C.muted };
    const pc = Math.round(((now - before) / before) * 100);
    return pc === 0 ? { text: 'Same', color: C.muted } : { text: `${pc > 0 ? '▲' : '▼'} ${Math.abs(pc)}%`, color: pc > 0 ? C.free : C.danger };
  };

  const body = () => {
    if (!report) return loading ? <ActivityIndicator color={C.brand1} style={{ marginTop: 30 }} /> : null;
    const t = report.totals;
    if (!t.bills) return <Empty icon="📊" text={`No paid bills ${days === 1 ? 'on this day' : 'in these dates'}. Pick another range above.`} />;
    const menuById = new Map(menu.map((m) => [m.id, m]));
    const sold = report.dishes.map((x) => {
      const m = x.menu_item_id != null ? menuById.get(x.menu_item_id) : undefined;
      return { name: m?.name ?? x.name, category: m?.category ?? 'Other', veg: m?.is_veg ?? true, qty: Number(x.qty), revenue: Number(x.revenue), prevQty: Number(x.prev_qty) };
    }).filter((r) => r.qty > 0);
    const metric = (r: { qty: number; revenue: number }) => (sort === 'qty' ? r.qty : r.revenue);
    sold.sort((a, b) => metric(b) - metric(a) || b.qty - a.qty || a.name.localeCompare(b.name));
    const dishMax = sold.length ? metric(sold[0]) : 0;
    const cats = new Map<string, { name: string; qty: number; revenue: number }>();
    sold.forEach((r) => { const c = cats.get(r.category) ?? { name: r.category, qty: 0, revenue: 0 }; c.qty += r.qty; c.revenue += r.revenue; cats.set(r.category, c); });
    const catList = [...cats.values()].sort((a, b) => metric(b) - metric(a));

    const byDay = new Map(report.days.map((d) => [d.day, d]));
    const dayRows = Array.from({ length: Math.min(days, 62) }, (_, i) => {
      const day = addDays(from, i);
      return { label: days <= 7 ? WEEKDAYS[new Date(`${day}T00:00:00`).getDay()] : String(Number(day.slice(8))), sales: Number(byDay.get(day)?.sales ?? 0) };
    });
    const hrs = report.hours.map((h) => h.hour);
    const hourRows = hrs.length ? Array.from({ length: Math.max(...hrs) - Math.min(...hrs) + 1 }, (_, i) => {
      const h = Math.min(...hrs) + i;
      return { label: hourLabel(h), h, sales: Number(report.hours.find((x) => x.hour === h)?.sales ?? 0) };
    }) : [];
    const peak = hourRows.length ? hourRows.reduce((a, b) => (b.sales > a.sales ? b : a)) : null;
    const best = report.days.length ? report.days.reduce((a, b) => (Number(b.sales) > Number(a.sales) ? b : a)) : null;
    const wk = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({ name: WEEKDAYS[dow], value: Number(report.weekdays.find((w) => w.dow === dow)?.sales ?? 0) }));
    const methodTotal = report.methods.reduce((n, m) => n + Number(m.sales), 0);
    const avg = Math.round(t.sales / t.bills / 100) * 100;
    const billsTrend = change(t.bills, report.prev.bills);
    const kpis: [string, string, string?][] = [
      ['Bills vs before', String(t.bills), billsTrend.text],
      ['Discount given', money(t.discount)],
      ...(t.tax ? [['GST collected', money(t.tax)] as [string, string]] : []),
      ['Parcels', `${t.parcels} · ${money(t.parcel_sales)}`],
      ...(t.dine_in_minutes ? [['Avg. time at table', t.dine_in_minutes! >= 60 ? `${Math.floor(t.dine_in_minutes! / 60)} h ${t.dine_in_minutes! % 60} min` : `${t.dine_in_minutes} min`] as [string, string]] : []),
      ...(peak ? [['Busiest hour', peak.label] as [string, string]] : []),
      ...(days > 1 && best ? [['Best day', `${shortDate(best.day)} · ${money(best.sales)}`] as [string, string]] : []),
    ];
    const shown = all ? sold : sold.slice(0, 10);

    return (
      <>
        <View style={st.kpis}>
          {kpis.map(([k, v, tr]) => (
            <View key={k} style={st.kpi}>
              <T style={{ color: C.muted, fontSize: 11.5 }}>{k}</T>
              <T w="heavy" style={{ fontSize: 15 }}>{v}{tr ? <T w="bold" style={{ fontSize: 12, color: billsTrend.color }}>{`  ${tr}`}</T> : null}</T>
            </View>
          ))}
        </View>

        {days > 1 ? (<><SectionTitle>Sales by day</SectionTitle><Card><Columns rows={dayRows} /></Card></>) : null}
        {hourRows.length > 1 ? (<><SectionTitle>Busy hours</SectionTitle><Card><Columns rows={hourRows} peak={peak?.label} every={hourRows.length > 10 ? 2 : 1} /></Card></>) : null}

        <SectionTitle>Payments</SectionTitle>
        <Card style={{ gap: 10 }}>
          <View style={st.split}>
            {report.methods.map((m) => <View key={m.method} style={{ flex: Number(m.sales) || 0.0001, backgroundColor: METHOD_COLOR[m.method] ?? C.muted }} />)}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {report.methods.map((m) => (
              <View key={m.method} style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: METHOD_COLOR[m.method] ?? C.muted }} />
                  <T style={{ color: C.muted, fontSize: 12 }}>{m.method} · {methodTotal ? Math.round((Number(m.sales) / methodTotal) * 100) : 0}%</T>
                </View>
                <T w="heavy">{money(m.sales)}</T>
                <T style={{ color: C.muted, fontSize: 11.5 }}>{m.bills} bill{m.bills === 1 ? '' : 's'}</T>
              </View>
            ))}
          </View>
        </Card>

        {days >= 7 ? (<><SectionTitle>By weekday</SectionTitle><Card style={{ gap: 8 }}><Bars rows={wk.map((w) => ({ name: w.name, value: w.value, text: money(w.value) }))} /></Card></>) : null}

        <SectionTitle right={<View style={{ flexDirection: 'row' }}><Chip label="Quantity" on={sort === 'qty'} onPress={() => setSort('qty')} /><Chip label="Sales ₹" on={sort === 'revenue'} onPress={() => setSort('revenue')} /></View>}>Top dishes</SectionTitle>
        <Card style={{ gap: 12 }}>
          {shown.map((r, i) => (
            <View key={r.name} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={[st.rank, i < 3 && { backgroundColor: C.accentSoft }]}><T w="heavy" style={{ fontSize: 12, color: i < 3 ? C.accent : C.muted }}>{i + 1}</T></View>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Diet veg={r.veg} />
                  <T w="bold" numberOfLines={1} style={{ flex: 1 }}>{r.name}</T>
                  <T w="heavy">{sort === 'qty' ? `${r.qty} sold` : money(r.revenue)}</T>
                </View>
                <View style={st.track}><View style={[st.bar, { width: `${Math.max(3, (metric(r) / dishMax) * 100)}%` }]} /></View>
                <T style={{ color: C.muted, fontSize: 11.5 }}>
                  {r.category} · {sort === 'qty' ? money(r.revenue) : `${r.qty} sold`} · {r.prevQty ? (r.qty - r.prevQty ? `${r.qty > r.prevQty ? '▲' : '▼'} ${Math.abs(r.qty - r.prevQty)}` : 'Same') : 'New'}
                </T>
              </View>
            </View>
          ))}
          {sold.length > 10 ? (
            <Pressable onPress={() => setAll(!all)} hitSlop={8}><T w="bold" style={{ color: C.accent, textAlign: 'center' }}>{all ? 'Show top 10' : `Show all ${sold.length} dishes`}</T></Pressable>
          ) : null}
        </Card>

        {catList.length > 1 ? (<><SectionTitle>By category</SectionTitle><Card style={{ gap: 8 }}><Bars rows={catList.map((c) => ({ name: c.name, value: metric(c), text: sort === 'qty' ? String(c.qty) : money(c.revenue) }))} /></Card></>) : null}
      </>
    );
  };

  const t = report?.totals;
  const tr = t ? change(t.sales, report!.prev.sales) : null;
  return (
    <ScrollView style={{ backgroundColor: 'transparent' }} contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={loading && !!report} onRefresh={load} colors={[C.brand1]} />}>
      <Header eyebrow="Sales report" title="Analytics" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, flexGrow: 0 }}>
        {Object.entries(RANGES).map(([k, [label]]) => <Chip key={k} label={label} on={range === k} onPress={() => setRange(k)} />)}
      </ScrollView>
      <SummaryCard
        label={`Sales · ${days === 1 ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`}`}
        value={t ? money(t.sales) : '…'}
        note={t ? `${tr!.text} vs ${days === 1 ? 'the day before' : `the ${days} days before`} (${money(report!.prev.sales)})` : undefined}
        noteColor={tr?.color}
        stats={[
          { value: t?.bills ?? '–', label: 'Bills', color: C.accentStrong, bg: C.accentSoft },
          { value: t?.bills ? money(Math.round(t.sales / t.bills / 100) * 100) : '–', label: 'Avg. bill', color: C.billed, bg: C.billedSoft },
          { value: t?.items ?? '–', label: 'Dishes sold', color: C.free, bg: C.freeSoft },
        ]}
      />
      {error ? <T style={{ color: C.danger, marginBottom: 8 }}>{error}</T> : null}
      {body()}
    </ScrollView>
  );
}

function Columns({ rows, peak, every = 1 }: { rows: { label: string; sales: number }[]; peak?: string; every?: number }) {
  const max = Math.max(...rows.map((r) => r.sales), 0);
  const step = rows.length > 14 ? Math.ceil(rows.length / 10) : every;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: rows.length > 20 ? 2 : 4 }}>
        {rows.map((r, i) => (
          <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
            <View style={{ alignSelf: 'center', width: rows.length > 20 ? '80%' : '64%', height: `${max ? Math.max(r.sales ? 3 : 0, (r.sales / max) * 100) : 0}%`, backgroundColor: r.label === peak ? C.brand2 : C.brand1, borderTopLeftRadius: 4, borderTopRightRadius: 4, opacity: r.label === peak || !peak ? 1 : 0.75 }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: rows.length > 20 ? 2 : 4, marginTop: 4 }}>
        {rows.map((r, i) => <T key={i} numberOfLines={1} style={{ flex: 1, fontSize: 9.5, color: C.muted, textAlign: 'center' }}>{i % step === 0 ? r.label : ''}</T>)}
      </View>
      <T style={{ color: C.muted, fontSize: 11.5, marginTop: 6 }}>Highest {money(max)}</T>
    </View>
  );
}

function Bars({ rows }: { rows: { name: string; value: number; text: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <>
      {rows.map((r) => (
        <View key={r.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T numberOfLines={1} style={{ width: 86, fontSize: 12.5 }}>{r.name}</T>
          <View style={[st.track, { flex: 1 }]}><View style={[st.bar, { width: `${max ? Math.max(r.value ? 3 : 0, (r.value / max) * 100) : 0}%` }]} /></View>
          <T w="bold" style={{ width: 70, textAlign: 'right', fontSize: 12.5 }}>{r.text}</T>
        </View>
      ))}
    </>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 18, padding: 14, overflow: 'hidden', marginBottom: 12 },
  fact: { flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 10, padding: 8 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { width: '48.6%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, gap: 2 },
  split: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  rank: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  track: { height: 7, borderRadius: 4, backgroundColor: C.surface2, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4, backgroundColor: C.brand1 },
});

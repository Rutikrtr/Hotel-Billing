-- Analytics for any date range in one call: totals, the same-length period before (for comparison),
-- payment methods, day by day, hour of day, weekday, dishes and categories. Everything is added up
-- in the database so the phone downloads one small JSON instead of every bill.
-- p_tz: the phone's time zone (e.g. 'Asia/Kolkata'), so days and hours match the clock on the wall.
create or replace function public.sales_report(p_from timestamptz, p_to timestamptz, p_tz text default 'Asia/Kolkata')
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with bills as (
    select o.id, o.closed_at, o.opened_at, o.is_parcel, coalesce(o.payment_method, 'Cash') as method,
           (o.closed_at < p_from) as prev,
           (o.closed_at at time zone p_tz) as local_at,
           s.sub, least(o.discount, s.sub) as disc,
           floor(((s.sub - least(o.discount, s.sub)) * coalesce(o.tax_rate_bp, 0) + 5000) / 10000.0)::bigint as tax,
           public.bill_total(o.id) as total
      from public.orders o
      cross join lateral (select coalesce(sum(i.quantity::bigint * i.unit_price), 0)::bigint as sub
                            from public.order_items i where i.order_id = o.id) s
     where public.can_bill() and o.restaurant_id = public.my_restaurant() and o.status = 'paid'
       and o.closed_at >= p_from - (p_to - p_from) and o.closed_at < p_to
  ),
  cur as (select * from bills where not prev),
  items as (
    select i.menu_item_id, i.name, i.quantity, i.unit_price, b.prev
      from bills b join public.order_items i on i.order_id = b.id
  ),
  rooms as (
    select count(*) as bills, coalesce(sum(public.stay_total(st.id)), 0)::bigint as sales
      from public.stays st
     where public.can_bill() and public.has_feature('rooms') and st.restaurant_id = public.my_restaurant()
       and st.status = 'paid' and st.closed_at >= p_from and st.closed_at < p_to
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'bills', count(*), 'sales', coalesce(sum(total), 0), 'subtotal', coalesce(sum(sub), 0),
        'discount', coalesce(sum(disc), 0), 'tax', coalesce(sum(tax), 0),
        'parcels', count(*) filter (where is_parcel), 'parcel_sales', coalesce(sum(total) filter (where is_parcel), 0),
        'dine_in_minutes', coalesce(round(avg(extract(epoch from closed_at - opened_at) / 60) filter (where not is_parcel and opened_at is not null)), 0),
        'items', (select coalesce(sum(quantity), 0) from items where not prev))
      from cur),
    'prev', (select jsonb_build_object('bills', count(*), 'sales', coalesce(sum(total), 0),
        'items', (select coalesce(sum(quantity), 0) from items where prev)) from bills where prev),
    'methods', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'bills', n, 'sales', amt) order by amt desc), '[]')
      from (select method, count(*) as n, sum(total) as amt from cur group by method) m),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'bills', n, 'sales', amt) order by d), '[]')
      from (select local_at::date as d, count(*) as n, sum(total) as amt from cur group by 1) x),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'bills', n, 'sales', amt) order by h), '[]')
      from (select extract(hour from local_at)::int as h, count(*) as n, sum(total) as amt from cur group by 1) x),
    'weekdays', (select coalesce(jsonb_agg(jsonb_build_object('dow', w, 'bills', n, 'sales', amt) order by w), '[]')
      from (select extract(dow from local_at)::int as w, count(*) as n, sum(total) as amt from cur group by 1) x),
    'dishes', (select coalesce(jsonb_agg(jsonb_build_object('menu_item_id', menu_item_id, 'name', name, 'qty', qty, 'revenue', revenue, 'prev_qty', prev_qty)), '[]')
      from (select menu_item_id, min(name) as name,
                   coalesce(sum(quantity) filter (where not prev), 0) as qty,
                   coalesce(sum(quantity::bigint * unit_price) filter (where not prev), 0) as revenue,
                   coalesce(sum(quantity) filter (where prev), 0) as prev_qty
              from items group by menu_item_id, case when menu_item_id is null then name end) x),
    'rooms', (select jsonb_build_object('bills', bills, 'sales', sales) from rooms)
  );
$$;
revoke all on function public.sales_report(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.sales_report(timestamptz, timestamptz, text) to authenticated;

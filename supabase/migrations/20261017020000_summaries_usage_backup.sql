-- ===== Server-side summaries (much less data per screen), database usage, and per-hotel backups =====

-- Bills for a time range with their totals worked out here, so the app doesn't download every item.
create or replace function public.bill_list(p_from timestamptz, p_to timestamptz)
returns table (id bigint, kind text, bill_no text, label text, method text, total bigint, closed_at timestamptz, edit_count int)
language sql stable security definer set search_path = '' as $$
  select o.id, 'order', o.bill_no, public.bill_table_label(o.id), o.payment_method, public.bill_total(o.id), o.closed_at, o.edit_count
    from public.orders o
   where public.can_bill() and o.restaurant_id = public.my_restaurant() and o.status = 'paid'
     and o.closed_at >= p_from and o.closed_at < p_to
  union all
  select s.id, 'stay', s.bill_no, 'Room ' || r.number || ' · ' || s.guest_name, s.payment_method, public.stay_total(s.id), s.closed_at, 0
    from public.stays s join public.lodging_rooms r on r.id = s.room_id
   where public.can_bill() and public.has_feature('rooms') and s.restaurant_id = public.my_restaurant() and s.status = 'paid'
     and s.closed_at >= p_from and s.closed_at < p_to
  order by closed_at desc;
$$;

-- Total food sales since a moment (Tables screen "Today's sales").
create or replace function public.sales_total(p_from timestamptz) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(public.bill_total(o.id)), 0)::bigint from public.orders o
   where public.can_bill() and o.restaurant_id = public.my_restaurant() and o.status = 'paid' and o.closed_at >= p_from;
$$;

-- Dish sales for Trending: this period (from p_split) and the period before (p_start to p_split).
create or replace function public.dish_sales(p_start timestamptz, p_split timestamptz)
returns table (menu_item_id bigint, name text, qty bigint, revenue bigint, prev_qty bigint)
language sql stable security definer set search_path = '' as $$
  select i.menu_item_id, min(i.name),
         coalesce(sum(i.quantity) filter (where o.closed_at >= p_split), 0)::bigint,
         coalesce(sum(i.quantity::bigint * i.unit_price) filter (where o.closed_at >= p_split), 0)::bigint,
         coalesce(sum(i.quantity) filter (where o.closed_at < p_split), 0)::bigint
    from public.orders o join public.order_items i on i.order_id = o.id
   where public.can_bill() and o.restaurant_id = public.my_restaurant() and o.status = 'paid' and o.closed_at >= p_start
   group by i.menu_item_id, case when i.menu_item_id is null then i.name end;
$$;

revoke execute on function public.bill_list(timestamptz, timestamptz), public.sales_total(timestamptz),
  public.dish_sales(timestamptz, timestamptz) from public, anon;
grant execute on function public.bill_list(timestamptz, timestamptz), public.sales_total(timestamptz),
  public.dish_sales(timestamptz, timestamptz) to authenticated;

-- Super admin: how full the database is, and which hotels use the most.
create or replace function public.sa_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'limit_bytes', 500 * 1024 * 1024,
    'bills', (select count(*) from public.orders where status = 'paid') + (select count(*) from public.stays where status = 'paid'),
    'items', (select count(*) from public.order_items),
    'hotels', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.hotel_name,
        'bills', (select count(*) from public.orders o where o.restaurant_id = r.id),
        'items', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.restaurant_id = r.id))
        order by r.id) from public.restaurants r), '[]'::jsonb));
end;
$$;

-- Super admin: everything for one hotel (bills closed on or after p_since; null = all), for a local backup.
create or replace function public.sa_export_hotel(p_id bigint, p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_since timestamptz := coalesce(p_since, '-infinity');
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.restaurants where id = p_id) then raise exception 'Hotel not found'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'since', p_since,
    'hotel', (select to_jsonb(r) - 'bill_counter' from public.restaurants r where r.id = p_id),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('login', s.email, 'role', s.role, 'added', s.created_at) order by s.created_at)
                        from public.staff s where s.restaurant_id = p_id), '[]'),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort, t.name)
                        from public.dining_tables t where t.restaurant_id = p_id), '[]'),
    'menu', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'category', m.category, 'price', m.price,
                        'veg', m.is_veg, 'available', m.available, 'favourite', m.is_favorite) order by m.id)
                        from public.menu_items m where m.restaurant_id = p_id), '[]'),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', lr.id, 'number', lr.number, 'type', lr.room_type, 'rate', lr.rate) order by lr.sort)
                        from public.lodging_rooms lr where lr.restaurant_id = p_id), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', o.id, 'bill_no', o.bill_no, 'label', public.bill_table_label(o.id), 'parcel', o.is_parcel,
                        'opened_at', o.opened_at, 'closed_at', o.closed_at, 'method', o.payment_method,
                        'discount', o.discount, 'tax_rate_bp', o.tax_rate_bp, 'total', public.bill_total(o.id), 'edits', o.edit_count,
                        'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.quantity, 'price', i.unit_price) order by i.id)
                                    from public.order_items i where i.order_id = o.id)) order by o.closed_at)
                        from public.orders o where o.restaurant_id = p_id and o.status = 'paid' and o.closed_at >= v_since), '[]'),
    'room_bills', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', s.id, 'bill_no', s.bill_no, 'room', lr.number, 'guest', s.guest_name, 'phone', s.guest_phone, 'guests', s.guests,
                        'check_in', s.check_in, 'check_out', s.check_out, 'rate', s.rate, 'discount', s.discount,
                        'closed_at', s.closed_at, 'method', s.payment_method, 'total', public.stay_total(s.id),
                        'charges', (select jsonb_agg(jsonb_build_object('name', c.description, 'qty', c.quantity, 'price', c.unit_price) order by c.id)
                                      from public.stay_charges c where c.stay_id = s.id)) order by s.closed_at)
                        from public.stays s join public.lodging_rooms lr on lr.id = s.room_id
                        where s.restaurant_id = p_id and s.status = 'paid' and s.closed_at >= v_since), '[]'),
    'change_log', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at)
                        from public.bill_logs l where l.restaurant_id = p_id and l.created_at >= v_since), '[]'));
end;
$$;

revoke execute on function public.sa_usage(), public.sa_export_hotel(bigint, timestamptz) from public, anon;
grant execute on function public.sa_usage(), public.sa_export_hotel(bigint, timestamptz) to authenticated;

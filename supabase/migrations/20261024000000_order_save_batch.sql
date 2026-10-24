-- Save-once ordering for the mobile app: the waiter builds the order on the phone, then one request applies
-- every change. Changes are +/- amounts (not totals), so two phones saving the same table both count.
-- p_changes: [{"menu_item_id": 12, "delta": 2}, {"menu_item_id": 7, "delta": -1}, ...]
-- Returns the whole open order with its items, so the phone needs no second request.
create or replace function public.order_save(
  p_order_id bigint, p_table_id bigint, p_section text, p_parcel boolean, p_changes jsonb, p_discount bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rest bigint := public.my_restaurant();
  v_order bigint := p_order_id;
  c jsonb; v_menu bigint; v_delta int; v_name text; v_price bigint;
begin
  if v_rest is null then raise exception 'Please sign in again'; end if;
  if jsonb_typeof(coalesce(p_changes, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 200 then
    raise exception 'Invalid order changes';
  end if;
  if v_order is not null then
    if not exists (select 1 from public.orders where id = v_order and restaurant_id = v_rest and status = 'open') then
      raise exception 'This order was already paid or closed. Go back to Tables to see the latest.';
    end if;
  elsif jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) = 0 then
    return null;   -- nothing to save on an empty table
  elsif p_parcel then
    insert into public.orders (is_parcel, restaurant_id) values (true, v_rest) returning id into v_order;
  else
    if not exists (select 1 from public.dining_tables where id = p_table_id and restaurant_id = v_rest) then
      raise exception 'Table not found';
    end if;
    insert into public.orders (table_id, section, restaurant_id) values (p_table_id, coalesce(p_section, 'A'), v_rest)
      on conflict (table_id, section) where status = 'open' do nothing;
    select id into v_order from public.orders where table_id = p_table_id and section = coalesce(p_section, 'A') and status = 'open';
  end if;

  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    v_menu := (c->>'menu_item_id')::bigint;
    v_delta := (c->>'delta')::int;
    continue when v_delta is null or v_delta = 0;
    if abs(v_delta) > 500 then raise exception 'Invalid quantity'; end if;
    if v_delta > 0 then
      select name, price into v_name, v_price from public.menu_items where id = v_menu and restaurant_id = v_rest;
      if not found then raise exception 'A dish is no longer on the menu. Refresh the menu and try again.'; end if;
      insert into public.order_items (order_id, menu_item_id, name, unit_price, quantity)
      values (v_order, v_menu, v_name, v_price, v_delta)
      on conflict (order_id, menu_item_id) do update set quantity = public.order_items.quantity + excluded.quantity;
    else
      delete from public.order_items where order_id = v_order and menu_item_id = v_menu and quantity + v_delta <= 0;
      if not found then
        update public.order_items set quantity = quantity + v_delta where order_id = v_order and menu_item_id = v_menu;
      end if;
    end if;
  end loop;

  if p_discount is not null then
    update public.orders set discount = greatest(p_discount, 0) where id = v_order;
  end if;
  return public.order_snapshot(v_order);
end;
$$;

-- The open order with its items, as one small JSON object.
create or replace function public.order_snapshot(p_order_id bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'table_id', o.table_id, 'section', o.section, 'is_parcel', o.is_parcel, 'status', o.status,
    'discount', o.discount, 'bill_no', o.bill_no, 'billed_at', o.billed_at, 'opened_at', o.opened_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'menu_item_id', i.menu_item_id, 'name', i.name,
                        'unit_price', i.unit_price, 'quantity', i.quantity, 'kot_qty', i.kot_qty) order by i.id)
                       from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_order_id and o.restaurant_id = public.my_restaurant();
$$;

-- After a kitchen ticket prints: everything on the order has now been told to the kitchen.
create or replace function public.order_mark_kot(p_order_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.orders where id = p_order_id and restaurant_id = public.my_restaurant() and status = 'open') then
    raise exception 'This order was already paid or closed.';
  end if;
  update public.order_items set kot_qty = quantity where order_id = p_order_id and kot_qty <> quantity;
  return public.order_snapshot(p_order_id);
end;
$$;

revoke all on function public.order_save(bigint, bigint, text, boolean, jsonb, bigint) from public, anon;
revoke all on function public.order_snapshot(bigint) from public, anon;
revoke all on function public.order_mark_kot(bigint) from public, anon;
grant execute on function public.order_save(bigint, bigint, text, boolean, jsonb, bigint) to authenticated;
grant execute on function public.order_snapshot(bigint) to authenticated;
grant execute on function public.order_mark_kot(bigint) to authenticated;

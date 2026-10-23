-- Several phones on one table: add or remove dishes as +1 / -1 in one atomic step, so taps from two
-- waiters at the same moment both count (before, each phone wrote its own total and one could overwrite
-- the other). Also opens the table's order if needed (one open order per table section is enforced).
create or replace function public.order_item_change(
  p_order_id bigint, p_table_id bigint, p_section text, p_parcel boolean,
  p_menu_item_id bigint, p_delta integer, p_kot_qty integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rest bigint := public.my_restaurant();
  v_order bigint := p_order_id;
  v_name text; v_price bigint;
  v_item bigint; v_qty integer := 0;
begin
  if v_rest is null then raise exception 'Please sign in again'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 50 then raise exception 'Invalid quantity change'; end if;
  if v_order is not null then
    if not exists (select 1 from public.orders where id = v_order and restaurant_id = v_rest and status = 'open') then
      raise exception 'This order was already paid or closed. Go back to Tables to see the latest.';
    end if;
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

  if p_delta > 0 then
    select name, price into v_name, v_price from public.menu_items where id = p_menu_item_id and restaurant_id = v_rest;
    if not found then raise exception 'This dish is no longer on the menu'; end if;
    insert into public.order_items (order_id, menu_item_id, name, unit_price, quantity, kot_qty)
    values (v_order, p_menu_item_id, v_name, v_price, p_delta, greatest(coalesce(p_kot_qty, 0), 0))
    on conflict (order_id, menu_item_id) do update set quantity = public.order_items.quantity + excluded.quantity
    returning id, quantity into v_item, v_qty;
  else
    delete from public.order_items where order_id = v_order and menu_item_id = p_menu_item_id and quantity + p_delta <= 0
      returning id into v_item;
    if found then v_qty := 0;
    else
      update public.order_items set quantity = quantity + p_delta where order_id = v_order and menu_item_id = p_menu_item_id
        returning id, quantity into v_item, v_qty;
    end if;
  end if;
  return jsonb_build_object('order_id', v_order, 'item_id', v_item, 'quantity', coalesce(v_qty, 0));
end;
$$;
revoke all on function public.order_item_change(bigint, bigint, text, boolean, bigint, integer, integer) from public, anon;
grant execute on function public.order_item_change(bigint, bigint, text, boolean, bigint, integer, integer) to authenticated;

-- The old add-staff function did not check the plan's staff limit; the app uses owner_add_staff.
revoke execute on function public.owner_create_staff(text, text, text) from public, anon, authenticated;
-- Trigger functions are not meant to be called through the API.
revoke execute on function public.sa_audit_restaurants() from public, anon, authenticated;
revoke execute on function public.sa_audit_subscriptions() from public, anon, authenticated;
revoke execute on function public.sa_bill_fill() from public, anon, authenticated;
create index if not exists sa_bills_restaurant_id_idx on public.sa_bills (restaurant_id);

-- Live updates: phones get a small message when an order in their own hotel opens, is billed or closes
-- (row-level security on orders decides who receives what).
alter publication supabase_realtime add table public.orders;

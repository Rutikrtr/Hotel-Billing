-- Edit a paid bill (owner only): replace its items, discount and payment method; log before/after.
create or replace function public.edit_paid_bill(p_order_id bigint, p_items jsonb, p_discount bigint, p_method text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rest bigint; v_bill text; v_before jsonb; v_after jsonb;
begin
  if not public.is_owner() or not public.order_in_my_restaurant(p_order_id) then
    raise exception 'Only the owner can edit bills';
  end if;
  select restaurant_id, bill_no into v_rest, v_bill from public.orders where id = p_order_id and status = 'paid' for update;
  if not found then raise exception 'Only paid bills can be edited'; end if;
  if p_method not in ('Cash', 'UPI', 'Card') then raise exception 'Choose Cash, UPI or Card'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A bill needs at least one item. Delete the bill instead.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
             where coalesce(trim(i->>'name'), '') = '' or (i->>'quantity')::int < 1 or (i->>'unit_price')::bigint < 0) then
    raise exception 'Each item needs a name, a quantity of at least 1 and a price';
  end if;
  v_before := public.bill_snapshot(p_order_id);
  delete from public.order_items where order_id = p_order_id;
  insert into public.order_items (order_id, menu_item_id, name, unit_price, quantity)
  select p_order_id,
         (select m.id from public.menu_items m where m.id = nullif(i->>'menu_item_id', '')::bigint and m.restaurant_id = v_rest),
         trim(i->>'name'), (i->>'unit_price')::bigint, (i->>'quantity')::int
  from jsonb_array_elements(p_items) i;
  perform set_config('hotel.edit_paid', 'on', true);
  update public.orders set discount = greatest(coalesce(p_discount, 0), 0), payment_method = p_method, edit_count = edit_count + 1
   where id = p_order_id;
  perform set_config('hotel.edit_paid', 'off', true);
  v_after := public.bill_snapshot(p_order_id);
  insert into public.bill_logs (restaurant_id, order_id, bill_no, table_label, action, user_id, user_email, reason, before, after)
  values (v_rest, p_order_id, v_bill, public.bill_table_label(p_order_id), 'edit', auth.uid(),
          (select email from auth.users where id = auth.uid()), coalesce(trim(p_reason), ''), v_before, v_after);
  return v_after;
end;
$$;

-- Delete a paid bill (owner only); the full bill is kept in the log.
create or replace function public.delete_paid_bill(p_order_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rest bigint; v_bill text; v_before jsonb; v_label text;
begin
  if not public.is_owner() or not public.order_in_my_restaurant(p_order_id) then
    raise exception 'Only the owner can delete bills';
  end if;
  select restaurant_id, bill_no into v_rest, v_bill from public.orders where id = p_order_id and status = 'paid' for update;
  if not found then raise exception 'Only paid bills can be deleted'; end if;
  v_before := public.bill_snapshot(p_order_id);
  v_label := public.bill_table_label(p_order_id);
  insert into public.bill_logs (restaurant_id, order_id, bill_no, table_label, action, user_id, user_email, reason, before, after)
  values (v_rest, p_order_id, v_bill, v_label, 'delete', auth.uid(),
          (select email from auth.users where id = auth.uid()), coalesce(trim(p_reason), ''), v_before, null);
  delete from public.orders where id = p_order_id;
end;
$$;

revoke execute on function public.edit_paid_bill(bigint, jsonb, bigint, text, text), public.delete_paid_bill(bigint, text) from public, anon;
grant execute on function public.edit_paid_bill(bigint, jsonb, bigint, text, text), public.delete_paid_bill(bigint, text) to authenticated;

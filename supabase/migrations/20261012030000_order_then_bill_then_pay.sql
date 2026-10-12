-- Three steps per table: take the order, print the bill after the meal, then receive payment.
alter table public.orders add column billed_at timestamptz;

-- Print Bill: gives the order its bill number (kept through payment) and marks it billed.
create or replace function public.generate_bill(p_order_id bigint) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_bill text;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'Add at least one item before printing the bill';
  end if;
  if not public.order_is_open(p_order_id) then
    raise exception 'Order not found or already paid';
  end if;
  select bill_no into v_bill from public.orders where id = p_order_id;
  if v_bill is null then
    v_bill := 'B' || lpad(nextval('public.bill_no_seq')::text, 5, '0');
  end if;
  perform set_config('hotel.settle', 'on', true);
  update public.orders set bill_no = v_bill, billed_at = now() where id = p_order_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end;
$$;
revoke execute on function public.generate_bill(bigint) from public, anon;
grant execute on function public.generate_bill(bigint) to authenticated;

-- Receive Payment: keeps the bill number from Print Bill (or assigns one if the bill was never printed).
create or replace function public.settle_order(p_order_id bigint, p_method text) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_bill text;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'Add at least one item before settling';
  end if;
  if not public.order_is_open(p_order_id) then
    raise exception 'Order not found or already settled';
  end if;
  select bill_no into v_bill from public.orders where id = p_order_id;
  if v_bill is null then
    v_bill := 'B' || lpad(nextval('public.bill_no_seq')::text, 5, '0');
  end if;
  perform set_config('hotel.settle', 'on', true);
  update public.orders
     set status = 'paid', bill_no = v_bill, payment_method = p_method, closed_at = now(),
         billed_at = coalesce(billed_at, now()),
         tax_rate_bp = (select tax_rate_bp from public.settings where id = 1)
   where id = p_order_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end;
$$;

-- billed_at is also only set through the functions above.
create or replace function public.guard_order_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'paid' then
    raise exception 'This bill is already settled';
  end if;
  if current_setting('hotel.settle', true) is distinct from 'on'
     and (new.status <> old.status or new.bill_no is distinct from old.bill_no
          or new.tax_rate_bp is distinct from old.tax_rate_bp or new.closed_at is distinct from old.closed_at
          or new.payment_method is distinct from old.payment_method or new.table_id <> old.table_id
          or new.billed_at is distinct from old.billed_at) then
    raise exception 'Use Print Bill or Receive Payment to change this order';
  end if;
  return new;
end;
$$;

-- An order that already has a bill number can't be cleared, so bill numbers stay continuous.
alter policy "staff clear open orders" on public.orders
  using ((select public.is_staff()) and status = 'open' and bill_no is null);

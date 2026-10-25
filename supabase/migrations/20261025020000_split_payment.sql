-- Split payments: one bill paid partly by Cash, UPI and/or Card. The parts are kept in payment_split
-- (paise per method) and payment_method is 'Split'. The parts must add up exactly to the bill total.
alter table public.orders add column if not exists payment_split jsonb;

create or replace function public.settle_order_split(p_order_id bigint, p_split jsonb) returns text language plpgsql security definer set search_path to '' as $f$
declare v_bill text; v_rest bigint; v_total bigint; v_sum bigint := 0; k text; v bigint; clean jsonb := '{}'::jsonb;
begin
  if not public.can_bill() or not public.order_in_my_restaurant(p_order_id) then raise exception 'Only the owner or a manager can take payment'; end if;
  if not public.order_is_open(p_order_id) then raise exception 'Order not found or already settled'; end if;
  if jsonb_typeof(p_split) <> 'object' then raise exception 'Split payment needs amounts'; end if;
  for k, v in select key, value::bigint from jsonb_each_text(p_split) loop
    if k not in ('Cash', 'UPI', 'Card') then raise exception 'Unknown payment method %', k; end if;
    if v < 0 then raise exception 'Amounts can''t be negative'; end if;
    if v > 0 then clean := clean || jsonb_build_object(k, v); v_sum := v_sum + v; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(clean)) < 2 then raise exception 'A split needs at least two ways of paying'; end if;
  select bill_no, restaurant_id into v_bill, v_rest from public.orders where id = p_order_id for update;
  perform set_config('hotel.settle', 'on', true);
  -- The bill's total with today's GST rate, as settle_order charges it.
  update public.orders set tax_rate_bp = (select tax_rate_bp from public.restaurants where id = v_rest) where id = p_order_id;
  v_total := public.bill_total(p_order_id);
  if v_sum <> v_total then raise exception 'The parts add up to %, but the bill is %', round(v_sum / 100.0, 2), round(v_total / 100.0, 2); end if;
  if v_bill is null then v_bill := public.next_bill_no(v_rest); end if;
  update public.orders
     set status = 'paid', bill_no = v_bill, payment_method = 'Split', payment_split = clean, closed_at = now(),
         billed_at = coalesce(billed_at, now())
   where id = p_order_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end $f$;
revoke execute on function public.settle_order_split(bigint, jsonb) from public, anon;
grant execute on function public.settle_order_split(bigint, jsonb) to authenticated;

-- Analytics: a split bill counts its parts under Cash / UPI / Card.
do $do$ declare d text := pg_get_functiondef('public.sales_report'::regproc); begin
  if position('payment_split' in d) > 0 then return; end if;
  d := replace(d, 'coalesce(o.payment_method, ''Cash'') as method,', 'coalesce(o.payment_method, ''Cash'') as method, case when o.payment_method = ''Split'' then o.payment_split end as split,');
  d := replace(d, 'from (select method, count(*) as n, sum(total) as amt from cur group by method) m',
    'from (select x.method, count(*) as n, sum(x.amt) as amt from (select coalesce(sp.key, c.method) as method, coalesce(sp.value::bigint, c.total) as amt from cur c left join lateral jsonb_each_text(c.split) sp on true) x group by x.method) m');
  execute d;
end $do$;

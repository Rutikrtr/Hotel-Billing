-- Each owner runs their own restaurant: menu, tables, orders, bills, settings and staff are per restaurant.
-- (The old single-row public.settings table is left in place but no longer used.)
create table public.restaurants (
  id bigint generated always as identity primary key,
  hotel_name text not null default 'My Restaurant',
  hotel_address text not null default '',
  hotel_phone text not null default '',
  hotel_gstin text not null default '',
  tax_rate_bp int not null default 0 check (tax_rate_bp between 0 and 10000),
  bill_counter int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.restaurants (hotel_name, hotel_address, hotel_phone, hotel_gstin, tax_rate_bp, bill_counter)
select s.hotel_name, s.hotel_address, s.hotel_phone, s.hotel_gstin, s.tax_rate_bp,
       coalesce((select max(substr(o.bill_no, 2)::int) from public.orders o where o.bill_no is not null), 0)
from public.settings s where s.id = 1;

alter table public.staff add column restaurant_id bigint references public.restaurants(id);
alter table public.dining_tables add column restaurant_id bigint references public.restaurants(id);
alter table public.menu_items add column restaurant_id bigint references public.restaurants(id);
alter table public.orders add column restaurant_id bigint references public.restaurants(id);
update public.staff set restaurant_id = (select min(id) from public.restaurants) where restaurant_id is null;
update public.dining_tables set restaurant_id = (select min(id) from public.restaurants) where restaurant_id is null;
update public.menu_items set restaurant_id = (select min(id) from public.restaurants) where restaurant_id is null;
-- One-time tag of existing orders (paid ones included); amounts and bill numbers are untouched.
alter table public.orders disable trigger guard_order_update;
update public.orders set restaurant_id = (select min(id) from public.restaurants) where restaurant_id is null;
alter table public.orders enable trigger guard_order_update;

create or replace function public.my_restaurant() returns bigint
language sql stable security definer set search_path = '' as $$
  select restaurant_id from public.staff where user_id = (select auth.uid());
$$;
revoke execute on function public.my_restaurant() from public, anon;
grant execute on function public.my_restaurant() to authenticated;

create or replace function public.order_in_my_restaurant(o bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders where id = o and restaurant_id = public.my_restaurant());
$$;
revoke execute on function public.order_in_my_restaurant(bigint) from public, anon;
grant execute on function public.order_in_my_restaurant(bigint) to authenticated;

alter table public.staff alter column restaurant_id set not null;
alter table public.dining_tables alter column restaurant_id set not null;
alter table public.menu_items alter column restaurant_id set not null;
alter table public.orders alter column restaurant_id set not null;
-- New rows land in the signed-in person's restaurant without the app sending it.
alter table public.staff alter column restaurant_id set default public.my_restaurant();
alter table public.dining_tables alter column restaurant_id set default public.my_restaurant();
alter table public.menu_items alter column restaurant_id set default public.my_restaurant();
alter table public.orders alter column restaurant_id set default public.my_restaurant();
create index on public.staff (restaurant_id);
create index on public.dining_tables (restaurant_id);
create index on public.menu_items (restaurant_id);
create index on public.orders (restaurant_id);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()) and restaurant_id is not null);
$$;

alter table public.restaurants enable row level security;
create policy "staff read own restaurant" on public.restaurants for select to authenticated using (id = (select public.my_restaurant()));
create policy "staff update own restaurant" on public.restaurants for update to authenticated
  using (id = (select public.my_restaurant())) with check (id = (select public.my_restaurant()));
revoke update on public.restaurants from authenticated, anon;
grant update (hotel_name, hotel_address, hotel_phone, hotel_gstin, tax_rate_bp) on public.restaurants to authenticated;

alter policy "staff can view staff" on public.staff using (restaurant_id = (select public.my_restaurant()));
alter policy "owner adds staff" on public.staff with check ((select public.is_owner()) and role = 'staff' and restaurant_id = (select public.my_restaurant()));
alter policy "owner removes staff" on public.staff using ((select public.is_owner()) and role = 'staff' and restaurant_id = (select public.my_restaurant()));

alter policy "staff read tables" on public.dining_tables using (restaurant_id = (select public.my_restaurant()));
alter policy "staff add tables" on public.dining_tables with check (restaurant_id = (select public.my_restaurant()));
alter policy "staff update tables" on public.dining_tables using (restaurant_id = (select public.my_restaurant())) with check (restaurant_id = (select public.my_restaurant()));
alter policy "staff delete tables" on public.dining_tables using (restaurant_id = (select public.my_restaurant()));

alter policy "staff read menu" on public.menu_items using (restaurant_id = (select public.my_restaurant()));
alter policy "staff add menu" on public.menu_items with check (restaurant_id = (select public.my_restaurant()));
alter policy "staff update menu" on public.menu_items using (restaurant_id = (select public.my_restaurant())) with check (restaurant_id = (select public.my_restaurant()));
alter policy "staff delete menu" on public.menu_items using (restaurant_id = (select public.my_restaurant()));

alter policy "staff read orders" on public.orders using (restaurant_id = (select public.my_restaurant()));
alter policy "staff open orders" on public.orders with check (
  restaurant_id = (select public.my_restaurant()) and status = 'open' and bill_no is null and tax_rate_bp is null and closed_at is null
  and exists (select 1 from public.dining_tables t where t.id = table_id and t.restaurant_id = (select public.my_restaurant())));
alter policy "staff update orders" on public.orders using (restaurant_id = (select public.my_restaurant())) with check (restaurant_id = (select public.my_restaurant()));
alter policy "staff clear open orders" on public.orders using (restaurant_id = (select public.my_restaurant()) and status = 'open' and bill_no is null);

alter policy "staff read order items" on public.order_items using (public.order_in_my_restaurant(order_id));
alter policy "staff add order items" on public.order_items with check (public.order_in_my_restaurant(order_id) and public.order_is_open(order_id));
alter policy "staff change order items" on public.order_items
  using (public.order_in_my_restaurant(order_id) and public.order_is_open(order_id))
  with check (public.order_in_my_restaurant(order_id) and public.order_is_open(order_id));
alter policy "staff remove order items" on public.order_items using (public.order_in_my_restaurant(order_id) and public.order_is_open(order_id));

-- Bill numbers count per restaurant (B00001, B00002, ... for each).
create or replace function public.next_bill_no(p_restaurant bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.restaurants set bill_counter = bill_counter + 1 where id = p_restaurant returning bill_counter into n;
  return 'B' || lpad(n::text, 5, '0');
end;
$$;
revoke execute on function public.next_bill_no(bigint) from public, anon, authenticated;

create or replace function public.generate_bill(p_order_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare v_bill text; v_rest bigint;
begin
  if not public.is_staff() or not public.order_in_my_restaurant(p_order_id) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'Add at least one item before printing the bill';
  end if;
  if not public.order_is_open(p_order_id) then raise exception 'Order not found or already paid'; end if;
  select bill_no, restaurant_id into v_bill, v_rest from public.orders where id = p_order_id for update;
  if v_bill is null then v_bill := public.next_bill_no(v_rest); end if;
  perform set_config('hotel.settle', 'on', true);
  update public.orders set bill_no = v_bill, billed_at = now() where id = p_order_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end;
$$;

create or replace function public.settle_order(p_order_id bigint, p_method text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_bill text; v_rest bigint;
begin
  if not public.is_staff() or not public.order_in_my_restaurant(p_order_id) then raise exception 'Not authorised'; end if;
  if p_method not in ('Cash', 'UPI', 'Card') then raise exception 'Unknown payment method'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'Add at least one item before settling';
  end if;
  if not public.order_is_open(p_order_id) then raise exception 'Order not found or already settled'; end if;
  select bill_no, restaurant_id into v_bill, v_rest from public.orders where id = p_order_id for update;
  if v_bill is null then v_bill := public.next_bill_no(v_rest); end if;
  perform set_config('hotel.settle', 'on', true);
  update public.orders
     set status = 'paid', bill_no = v_bill, payment_method = p_method, closed_at = now(),
         billed_at = coalesce(billed_at, now()),
         tax_rate_bp = (select tax_rate_bp from public.restaurants where id = v_rest)
   where id = p_order_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end;
$$;
revoke execute on function public.generate_bill(bigint) from public, anon;
revoke execute on function public.settle_order(bigint, text) from public, anon;
grant execute on function public.generate_bill(bigint) to authenticated;
grant execute on function public.settle_order(bigint, text) to authenticated;

-- Names and bill numbers only need to be unique within one restaurant.
create unique index menu_items_restaurant_name_key on public.menu_items (restaurant_id, name);
create unique index dining_tables_restaurant_name_key on public.dining_tables (restaurant_id, name);
create unique index orders_restaurant_bill_no_key on public.orders (restaurant_id, bill_no);

-- Table-wise restaurant orders. The earlier room tables (rooms, bookings, extras, payments)
-- are left in place but are no longer used by the app.

alter table public.settings alter column tax_rate_bp set default 500;
update public.settings set tax_rate_bp = 500 where id = 1 and tax_rate_bp = 1200;

create table public.dining_tables (
  id bigint generated always as identity primary key,
  name text not null unique check (name <> ''),
  sort int not null default 0
);
insert into public.dining_tables (name, sort) select 'T' || n, n from generate_series(1, 8) n;

create table public.menu_items (
  id bigint generated always as identity primary key,
  name text not null unique check (name <> ''),
  category text not null default 'Other',
  price bigint not null check (price >= 0),
  is_veg boolean not null default true,
  available boolean not null default true
);

create sequence public.bill_no_seq;

create table public.orders (
  id bigint generated always as identity primary key,
  table_id bigint not null references public.dining_tables(id),
  status text not null default 'open' check (status in ('open', 'paid')),
  discount bigint not null default 0 check (discount >= 0),
  tax_rate_bp int,
  bill_no text unique,
  payment_method text check (payment_method in ('Cash', 'UPI', 'Card')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on public.orders (table_id);
create index on public.orders (closed_at);
-- One running order per table.
create unique index orders_one_open_per_table on public.orders (table_id) where status = 'open';

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  menu_item_id bigint references public.menu_items(id) on delete set null,
  name text not null,
  unit_price bigint not null check (unit_price >= 0),
  quantity int not null check (quantity >= 1),
  unique (order_id, menu_item_id)
);
create index on public.order_items (menu_item_id);

create or replace function public.order_is_open(o bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders where id = o and status = 'open');
$$;
revoke execute on function public.order_is_open(bigint) from public, anon;
grant execute on function public.order_is_open(bigint) to authenticated;

-- Paid orders are locked; only settle_order() may mark an order paid.
create or replace function public.guard_order_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'paid' then
    raise exception 'This bill is already settled';
  end if;
  if current_setting('hotel.settle', true) is distinct from 'on'
     and (new.status <> old.status or new.bill_no is distinct from old.bill_no
          or new.tax_rate_bp is distinct from old.tax_rate_bp or new.closed_at is distinct from old.closed_at
          or new.payment_method is distinct from old.payment_method or new.table_id <> old.table_id) then
    raise exception 'Use settle to close an order';
  end if;
  return new;
end;
$$;
create trigger guard_order_update before update on public.orders
  for each row execute function public.guard_order_update();

-- Closes a table's order: issues the next bill number and freezes the GST rate on it.
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
  v_bill := 'B' || lpad(nextval('public.bill_no_seq')::text, 5, '0');
  perform set_config('hotel.settle', 'on', true);
  update public.orders
     set status = 'paid', bill_no = v_bill, payment_method = p_method, closed_at = now(),
         tax_rate_bp = (select tax_rate_bp from public.settings where id = 1)
   where id = p_order_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end;
$$;
revoke execute on function public.settle_order(bigint, text) from public, anon;
grant execute on function public.settle_order(bigint, text) to authenticated;
grant usage on sequence public.bill_no_seq to authenticated;

alter table public.dining_tables enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "staff read tables" on public.dining_tables for select to authenticated using ((select public.is_staff()));
create policy "staff add tables" on public.dining_tables for insert to authenticated with check ((select public.is_staff()));
create policy "staff update tables" on public.dining_tables for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff delete tables" on public.dining_tables for delete to authenticated using ((select public.is_staff()));

create policy "staff read menu" on public.menu_items for select to authenticated using ((select public.is_staff()));
create policy "staff add menu" on public.menu_items for insert to authenticated with check ((select public.is_staff()));
create policy "staff update menu" on public.menu_items for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff delete menu" on public.menu_items for delete to authenticated using ((select public.is_staff()));

create policy "staff read orders" on public.orders for select to authenticated using ((select public.is_staff()));
create policy "staff open orders" on public.orders for insert to authenticated
  with check ((select public.is_staff()) and status = 'open' and bill_no is null and tax_rate_bp is null and closed_at is null);
create policy "staff update orders" on public.orders for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff clear open orders" on public.orders for delete to authenticated using ((select public.is_staff()) and status = 'open');

create policy "staff read order items" on public.order_items for select to authenticated using ((select public.is_staff()));
create policy "staff add order items" on public.order_items for insert to authenticated
  with check ((select public.is_staff()) and public.order_is_open(order_id));
create policy "staff change order items" on public.order_items for update to authenticated
  using ((select public.is_staff()) and public.order_is_open(order_id))
  with check ((select public.is_staff()) and public.order_is_open(order_id));
create policy "staff remove order items" on public.order_items for delete to authenticated
  using ((select public.is_staff()) and public.order_is_open(order_id));

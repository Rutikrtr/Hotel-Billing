-- Owners can edit or delete paid bills; every change is written to an append-only log.
alter table public.orders add column edit_count int not null default 0;

create table public.bill_logs (
  id bigint generated always as identity primary key,
  restaurant_id bigint not null references public.restaurants(id),
  order_id bigint,
  bill_no text,
  table_label text,
  action text not null check (action in ('edit', 'delete')),
  user_id uuid,
  user_email text,
  reason text not null default '',
  before jsonb not null,
  after jsonb,
  created_at timestamptz not null default now()
);
create index on public.bill_logs (restaurant_id, created_at desc);
create index on public.bill_logs (order_id);
alter table public.bill_logs enable row level security;
-- Only the owner reads the log. Nobody writes it directly; only edit_paid_bill / delete_paid_bill do.
create policy "owner reads bill log" on public.bill_logs for select to authenticated
  using (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()));

-- Bill total exactly as the app computes it (discount capped, GST rounded half up, total to the nearest rupee).
create or replace function public.bill_total(o bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  with s as (select coalesce(sum(quantity::bigint * unit_price), 0) as sub from public.order_items where order_id = o),
       x as (select s.sub, least(oo.discount, s.sub) as d, coalesce(oo.tax_rate_bp, 0) as r from s, public.orders oo where oo.id = o)
  select (floor(((sub - d) + floor(((sub - d) * r + 5000) / 10000.0) + 50) / 100.0) * 100)::bigint from x;
$$;

create or replace function public.bill_snapshot(o bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.quantity, 'price', i.unit_price) order by i.id)
                       from public.order_items i where i.order_id = o), '[]'::jsonb),
    'discount', oo.discount, 'method', oo.payment_method, 'tax_rate_bp', oo.tax_rate_bp, 'total', public.bill_total(o))
  from public.orders oo where oo.id = o;
$$;

create or replace function public.bill_table_label(o bigint) returns text
language sql stable security definer set search_path = '' as $$
  select t.name || case when oo.is_split or oo.section <> 'A' then '-' || oo.section else '' end
  from public.orders oo join public.dining_tables t on t.id = oo.table_id where oo.id = o;
$$;
revoke execute on function public.bill_total(bigint), public.bill_snapshot(bigint), public.bill_table_label(bigint) from public, anon, authenticated;

-- Paid bills stay locked, except for the owner's logged edit (edit_paid_bill sets hotel.edit_paid).
create or replace function public.guard_order_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'paid' then
    if current_setting('hotel.edit_paid', true) = 'on'
       and new.status = 'paid' and new.bill_no is not distinct from old.bill_no
       and new.closed_at is not distinct from old.closed_at and new.table_id = old.table_id then
      return new;
    end if;
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

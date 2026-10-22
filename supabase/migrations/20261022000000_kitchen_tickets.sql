-- Kitchen order tickets (KOT) for tables.
-- kot_qty: how many of this dish the kitchen has already been told about. A ticket lists only
-- what was added since (quantity - kot_qty), so add-ons later in the meal print as their own ticket.
alter table public.order_items add column if not exists kot_qty integer not null default 0 check (kot_qty >= 0);
-- Hotel switch: show "Send to Kitchen" on table orders. Off by default; printing to the kitchen is optional.
alter table public.restaurants add column if not exists kot_tables boolean not null default false;

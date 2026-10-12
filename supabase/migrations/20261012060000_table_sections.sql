-- A table can be split into sections (A, B, C, ...) when different groups share it.
-- Each section has its own order and bill. Existing orders become section A.
alter table public.orders add column section text not null default 'A' check (section ~ '^[A-Z]$');
create unique index orders_one_open_per_table_section on public.orders (table_id, section) where status = 'open';

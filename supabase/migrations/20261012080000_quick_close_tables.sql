-- When on, "Print Bill" settles the order straight away and frees the table (no separate Receive Payment step).
alter table public.restaurants add column quick_close boolean not null default true;
grant update (quick_close) on public.restaurants to authenticated;

-- Replaced by the per-restaurant unique indexes created in multi_restaurant.
alter table public.menu_items drop constraint menu_items_name_key;
alter table public.dining_tables drop constraint dining_tables_name_key;
alter table public.orders drop constraint orders_bill_no_key;

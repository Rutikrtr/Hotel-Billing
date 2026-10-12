-- Starred dishes show first when taking an order.
alter table public.menu_items add column is_favorite boolean not null default false;

-- Best sellers for the signed-in person's restaurant: quantity ordered per dish over the last p_days.
create or replace function public.popular_menu_items(p_days int default 30, p_limit int default 12)
returns table (menu_item_id bigint, sold bigint)
language sql stable security invoker set search_path = '' as $$
  select oi.menu_item_id, sum(oi.quantity)::bigint as sold
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.restaurant_id = public.my_restaurant()
    and o.opened_at > now() - make_interval(days => greatest(p_days, 1))
    and oi.menu_item_id is not null
  group by oi.menu_item_id
  order by sold desc, oi.menu_item_id
  limit least(greatest(p_limit, 1), 50);
$$;
revoke execute on function public.popular_menu_items(int, int) from public, anon;
grant execute on function public.popular_menu_items(int, int) to authenticated;

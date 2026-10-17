-- Any staff member (owner, manager, waiter) may show the hotel's menu QR; only the owner can change the link.
create or replace function public.my_menu_token() returns text
language sql stable security definer set search_path = '' as $$
  select r.menu_token from public.restaurants r
   where r.id = public.my_restaurant() and r.feat_qr_menu;
$$;

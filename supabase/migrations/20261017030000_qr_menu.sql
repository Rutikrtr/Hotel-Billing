-- ===== Public QR menu: each hotel gets an unguessable link; the super admin switches the feature on per hotel =====

alter table public.restaurants
  add column feat_qr_menu boolean not null default false,
  add column menu_token text;

-- 14 random URL-safe characters (about 84 bits): impossible to guess, unrelated to the hotel's name or id.
create or replace function public.new_menu_token() returns text
language sql volatile set search_path = '' as $$
  select translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', 'xyz')::text;
$$;
revoke execute on function public.new_menu_token() from public, anon, authenticated;

update public.restaurants set menu_token = public.new_menu_token() where menu_token is null;
alter table public.restaurants alter column menu_token set default public.new_menu_token();
alter table public.restaurants alter column menu_token set not null;
create unique index restaurants_menu_token_key on public.restaurants (menu_token);
-- Row-level security already limits each hotel's row (and token) to its own staff.

create or replace function public.has_feature(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case p when 'tables' then r.feat_tables when 'rooms' then r.feat_rooms
                                 when 'trending' then r.feat_trending when 'bill_edit' then r.feat_bill_edit
                                 when 'qr_menu' then r.feat_qr_menu else false end
                   from public.restaurants r where r.id = public.my_restaurant()), false);
$$;

create or replace function public.account_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'super_admin', public.is_super_admin(),
    'staff', s.user_id is not null,
    'role', s.role,
    'can_bill', s.role in ('owner', 'manager'),
    'active', coalesce(r.active, false),
    'paused_reason', r.paused_reason,
    'hotel', r.hotel_name,
    'features', jsonb_build_object('tables', r.feat_tables, 'rooms', r.feat_rooms, 'trending', r.feat_trending,
                                   'bill_edit', r.feat_bill_edit, 'qr_menu', r.feat_qr_menu))
  from (select (select auth.uid()) as uid) me
  left join public.staff s on s.user_id = me.uid
  left join public.restaurants r on r.id = s.restaurant_id;
$$;

-- Owner: the hotel's menu link token (only when the feature is on).
create or replace function public.my_menu_token() returns text
language sql stable security definer set search_path = '' as $$
  select r.menu_token from public.restaurants r
   where r.id = public.my_restaurant() and public.is_owner() and r.feat_qr_menu;
$$;

-- Owner: make a new link; the old QR code stops working.
create or replace function public.owner_new_menu_link() returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not public.is_owner() or not public.has_feature('qr_menu') then raise exception 'Not authorised'; end if;
  update public.restaurants set menu_token = public.new_menu_token() where id = public.my_restaurant() returning menu_token into v;
  return v;
end;
$$;

-- Anyone with the link (no login): hotel name, address, phone and the dishes that are available.
create or replace function public.public_menu(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', r.hotel_name, 'address', r.hotel_address, 'phone', r.hotel_phone,
    'items', coalesce((select jsonb_agg(jsonb_build_object('n', m.name, 'c', m.category, 'p', m.price, 'v', m.is_veg, 'f', m.is_favorite) order by m.id)
                         from public.menu_items m where m.restaurant_id = r.id and m.available), '[]'::jsonb))
  from public.restaurants r
  where r.menu_token = p_token and r.active and r.feat_qr_menu and length(coalesce(p_token, '')) >= 12;
$$;

-- Super admin: switch the QR menu on or off for a hotel.
create or replace function public.sa_set_qr_menu(p_id bigint, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  update public.restaurants set feat_qr_menu = coalesce(p_on, false) where id = p_id;
  if not found then raise exception 'Hotel not found'; end if;
end;
$$;

revoke execute on function public.my_menu_token(), public.owner_new_menu_link(), public.sa_set_qr_menu(bigint, boolean) from public, anon;
grant execute on function public.my_menu_token(), public.owner_new_menu_link(), public.sa_set_qr_menu(bigint, boolean) to authenticated;
revoke execute on function public.public_menu(text) from public;
grant execute on function public.public_menu(text) to anon, authenticated;

-- Super admin hotel list: include the QR menu switch.
create or replace function public.sa_list_hotels() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  return coalesce((
    select jsonb_agg(h order by (h->>'id')::bigint) from (
      select jsonb_build_object(
        'id', r.id, 'name', r.hotel_name, 'address', r.hotel_address, 'phone', r.hotel_phone,
        'active', r.active, 'paused_reason', r.paused_reason, 'created_at', r.created_at,
        'features', jsonb_build_object('tables', r.feat_tables, 'rooms', r.feat_rooms, 'trending', r.feat_trending, 'bill_edit', r.feat_bill_edit, 'qr_menu', r.feat_qr_menu),
        'owners', coalesce((select jsonb_agg(s.email order by s.email) from public.staff s where s.restaurant_id = r.id and s.role = 'owner'), '[]'::jsonb),
        'staff_count', (select count(*) from public.staff s where s.restaurant_id = r.id),
        'tables', (select count(*) from public.dining_tables t where t.restaurant_id = r.id),
        'rooms', (select count(*) from public.lodging_rooms lr where lr.restaurant_id = r.id),
        'menu_items', (select count(*) from public.menu_items m where m.restaurant_id = r.id),
        'bills', (select count(*) from public.orders o where o.restaurant_id = r.id and o.status = 'paid')
               + (select count(*) from public.stays st where st.restaurant_id = r.id and st.status = 'paid'),
        'sales_today', coalesce((select sum(public.bill_total(o.id)) from public.orders o where o.restaurant_id = r.id and o.status = 'paid'
                                   and o.closed_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0)
                     + coalesce((select sum(public.stay_total(st.id)) from public.stays st where st.restaurant_id = r.id and st.status = 'paid'
                                   and st.closed_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0),
        'last_bill_at', greatest((select max(o.closed_at) from public.orders o where o.restaurant_id = r.id),
                                 (select max(st.closed_at) from public.stays st where st.restaurant_id = r.id))
      ) as h
      from public.restaurants r
    ) x), '[]'::jsonb);
end;
$$;

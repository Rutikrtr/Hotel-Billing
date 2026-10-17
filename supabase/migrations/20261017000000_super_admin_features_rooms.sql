-- ===== Super admin, per-hotel feature switches, pause, and a multi-hotel Rooms module =====

-- Super admins (Techyverve). Not tied to any hotel.
create table public.super_admins (
  user_id uuid primary key references auth.users(id),
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.super_admins enable row level security;
create policy "super admin sees own row" on public.super_admins for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.super_admins where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- Hotel status and feature switches (only the super admin may change these).
alter table public.restaurants
  add column active boolean not null default true,
  add column paused_reason text not null default '',
  add column feat_tables boolean not null default true,
  add column feat_rooms boolean not null default false,
  add column feat_trending boolean not null default true,
  add column feat_bill_edit boolean not null default true;

-- A paused hotel's staff lose access everywhere: every policy goes through these helpers.
create or replace function public.my_restaurant() returns bigint
language sql stable security definer set search_path = '' as $$
  select s.restaurant_id from public.staff s join public.restaurants r on r.id = s.restaurant_id
  where s.user_id = (select auth.uid()) and r.active;
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_restaurant() is not null;
$$;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s join public.restaurants r on r.id = s.restaurant_id
                 where s.user_id = (select auth.uid()) and s.role = 'owner' and r.active);
$$;
create or replace function public.has_feature(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case p when 'tables' then r.feat_tables when 'rooms' then r.feat_rooms
                                 when 'trending' then r.feat_trending when 'bill_edit' then r.feat_bill_edit else false end
                   from public.restaurants r where r.id = public.my_restaurant()), false);
$$;
revoke execute on function public.has_feature(text) from public, anon;
grant execute on function public.has_feature(text) to authenticated;

-- What the app needs to know right after sign-in.
create or replace function public.account_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'super_admin', public.is_super_admin(),
    'staff', s.user_id is not null,
    'role', s.role,
    'active', coalesce(r.active, false),
    'paused_reason', r.paused_reason,
    'hotel', r.hotel_name,
    'features', jsonb_build_object('tables', r.feat_tables, 'rooms', r.feat_rooms, 'trending', r.feat_trending, 'bill_edit', r.feat_bill_edit))
  from (select (select auth.uid()) as uid) me
  left join public.staff s on s.user_id = me.uid
  left join public.restaurants r on r.id = s.restaurant_id;
$$;
revoke execute on function public.account_status() from public, anon;
grant execute on function public.account_status() to authenticated;

-- ----- Rooms (lodging), per hotel, only when the Rooms feature is on -----
create table public.lodging_rooms (
  id bigint generated always as identity primary key,
  restaurant_id bigint not null default public.my_restaurant() references public.restaurants(id),
  number text not null check (number <> ''),
  room_type text not null default 'Standard',
  rate bigint not null check (rate >= 0),
  sort int not null default 0
);
create unique index lodging_rooms_restaurant_number_key on public.lodging_rooms (restaurant_id, number);

create table public.stays (
  id bigint generated always as identity primary key,
  restaurant_id bigint not null default public.my_restaurant() references public.restaurants(id),
  room_id bigint not null references public.lodging_rooms(id),
  guest_name text not null check (guest_name <> ''),
  guest_phone text not null default '',
  guests int not null default 1 check (guests >= 1),
  check_in date not null,
  check_out date not null,
  rate bigint not null check (rate >= 0),
  discount bigint not null default 0 check (discount >= 0),
  status text not null default 'open' check (status in ('open', 'paid')),
  bill_no text,
  payment_method text check (payment_method in ('Cash', 'UPI', 'Card')),
  tax_rate_bp int,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (check_out >= check_in)
);
create index on public.stays (restaurant_id, status);
create index on public.stays (room_id);
create unique index stays_one_open_per_room on public.stays (room_id) where status = 'open';
create unique index stays_restaurant_bill_no_key on public.stays (restaurant_id, bill_no);

create table public.stay_charges (
  id bigint generated always as identity primary key,
  stay_id bigint not null references public.stays(id) on delete cascade,
  description text not null check (description <> ''),
  quantity int not null default 1 check (quantity >= 1),
  unit_price bigint not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create index on public.stay_charges (stay_id);

create or replace function public.stay_open_mine(s bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.stays where id = s and status = 'open' and restaurant_id = public.my_restaurant());
$$;
create or replace function public.stay_mine(s bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.stays where id = s and restaurant_id = public.my_restaurant());
$$;
revoke execute on function public.stay_open_mine(bigint), public.stay_mine(bigint) from public, anon;
grant execute on function public.stay_open_mine(bigint), public.stay_mine(bigint) to authenticated;

create or replace function public.guard_stay_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'paid' then raise exception 'This room bill is already settled'; end if;
  if current_setting('hotel.settle', true) is distinct from 'on'
     and (new.status <> old.status or new.bill_no is distinct from old.bill_no or new.tax_rate_bp is distinct from old.tax_rate_bp
          or new.closed_at is distinct from old.closed_at or new.payment_method is distinct from old.payment_method
          or new.room_id <> old.room_id or new.restaurant_id <> old.restaurant_id) then
    raise exception 'Use Check Out to close a stay';
  end if;
  return new;
end;
$$;
create trigger guard_stay_update before update on public.stays for each row execute function public.guard_stay_update();

alter table public.lodging_rooms enable row level security;
alter table public.stays enable row level security;
alter table public.stay_charges enable row level security;

create policy "rooms: read" on public.lodging_rooms for select to authenticated
  using (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')));
create policy "rooms: add" on public.lodging_rooms for insert to authenticated
  with check (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')));
create policy "rooms: change" on public.lodging_rooms for update to authenticated
  using (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')))
  with check (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')));
create policy "rooms: remove" on public.lodging_rooms for delete to authenticated
  using (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')));

create policy "stays: read" on public.stays for select to authenticated
  using (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')));
create policy "stays: check in" on public.stays for insert to authenticated
  with check (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')) and status = 'open'
              and bill_no is null and closed_at is null and tax_rate_bp is null
              and exists (select 1 from public.lodging_rooms lr where lr.id = room_id and lr.restaurant_id = (select public.my_restaurant())));
create policy "stays: change open" on public.stays for update to authenticated
  using (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')))
  with check (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')));
create policy "stays: cancel open" on public.stays for delete to authenticated
  using (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')) and status = 'open');

create policy "charges: read" on public.stay_charges for select to authenticated using (public.stay_mine(stay_id));
create policy "charges: add" on public.stay_charges for insert to authenticated with check (public.stay_open_mine(stay_id));
create policy "charges: remove" on public.stay_charges for delete to authenticated using (public.stay_open_mine(stay_id));

-- Room bill total, matching the app: nights x rate + charges, discount capped, GST half-up, rounded to the rupee.
create or replace function public.stay_total(s bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  with base as (
    select st.discount, coalesce(st.tax_rate_bp, 0) as r,
           greatest(st.check_out - st.check_in, 1)::bigint * st.rate
             + coalesce((select sum(c.quantity::bigint * c.unit_price) from public.stay_charges c where c.stay_id = st.id), 0) as sub
    from public.stays st where st.id = s),
  x as (select sub, least(discount, sub) as d, r from base)
  select (floor(((sub - d) + floor(((sub - d) * r + 5000) / 10000.0) + 50) / 100.0) * 100)::bigint from x;
$$;
revoke execute on function public.stay_total(bigint) from public, anon, authenticated;

-- Check out: issue a room bill number (R00001...) from the hotel's counter and lock the stay.
create or replace function public.checkout_stay(p_stay_id bigint, p_method text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_rest bigint; v_bill text; n int;
begin
  if not public.is_staff() or not public.has_feature('rooms') or not public.stay_open_mine(p_stay_id) then
    raise exception 'Not authorised';
  end if;
  if p_method not in ('Cash', 'UPI', 'Card') then raise exception 'Choose Cash, UPI or Card'; end if;
  select restaurant_id into v_rest from public.stays where id = p_stay_id for update;
  update public.restaurants set bill_counter = bill_counter + 1 where id = v_rest returning bill_counter into n;
  v_bill := 'R' || lpad(n::text, 5, '0');
  perform set_config('hotel.settle', 'on', true);
  update public.stays set status = 'paid', bill_no = v_bill, payment_method = p_method, closed_at = now(),
         tax_rate_bp = (select tax_rate_bp from public.restaurants where id = v_rest)
   where id = p_stay_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end;
$$;
revoke execute on function public.checkout_stay(bigint, text) from public, anon;
grant execute on function public.checkout_stay(bigint, text) to authenticated;

-- ----- Super admin console functions -----
create or replace function public.sa_list_hotels() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  return coalesce((
    select jsonb_agg(h order by (h->>'id')::bigint) from (
      select jsonb_build_object(
        'id', r.id, 'name', r.hotel_name, 'address', r.hotel_address, 'phone', r.hotel_phone,
        'active', r.active, 'paused_reason', r.paused_reason, 'created_at', r.created_at,
        'features', jsonb_build_object('tables', r.feat_tables, 'rooms', r.feat_rooms, 'trending', r.feat_trending, 'bill_edit', r.feat_bill_edit),
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

create or replace function public.sa_create_hotel(
  p_name text, p_address text, p_phone text, p_owner_email text, p_owner_password text,
  p_tables int, p_rooms int, p_feat_tables boolean, p_feat_rooms boolean, p_feat_trending boolean, p_feat_bill_edit boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_uid uuid := gen_random_uuid(); v_email text := lower(trim(p_owner_email));
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the hotel name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' then raise exception 'Enter a valid owner email'; end if;
  if length(coalesce(p_owner_password, '')) < 6 then raise exception 'Owner password must be at least 6 characters'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) or exists (select 1 from public.staff where email = v_email) then
    raise exception 'An account with this email already exists';
  end if;
  insert into public.restaurants (hotel_name, hotel_address, hotel_phone, feat_tables, feat_rooms, feat_trending, feat_bill_edit)
  values (trim(p_name), coalesce(trim(p_address), ''), coalesce(trim(p_phone), ''),
          coalesce(p_feat_tables, true), coalesce(p_feat_rooms, false), coalesce(p_feat_trending, true), coalesce(p_feat_bill_edit, true))
  returning id into v_id;
  insert into public.staff (email, role, restaurant_id) values (v_email, 'owner', v_id);
  insert into public.dining_tables (name, sort, restaurant_id)
    select 'T' || n, n, v_id from generate_series(1, greatest(least(coalesce(p_tables, 0), 100), 0)) n;
  insert into public.lodging_rooms (number, room_type, rate, sort, restaurant_id)
    select (100 + n)::text, 'Standard', 100000, n, v_id from generate_series(1, greatest(least(coalesce(p_rooms, 0), 200), 0)) n;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_owner_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  update public.staff set user_id = v_uid where email = v_email and user_id is null;
  return v_id;
end;
$$;

create or replace function public.sa_update_hotel(
  p_id bigint, p_name text, p_address text, p_phone text,
  p_feat_tables boolean, p_feat_rooms boolean, p_feat_trending boolean, p_feat_bill_edit boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the hotel name'; end if;
  update public.restaurants set hotel_name = trim(p_name), hotel_address = coalesce(trim(p_address), ''), hotel_phone = coalesce(trim(p_phone), ''),
         feat_tables = p_feat_tables, feat_rooms = p_feat_rooms, feat_trending = p_feat_trending, feat_bill_edit = p_feat_bill_edit
   where id = p_id;
  if not found then raise exception 'Hotel not found'; end if;
end;
$$;

create or replace function public.sa_set_active(p_id bigint, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  update public.restaurants set active = p_active, paused_reason = case when p_active then '' else coalesce(trim(p_reason), '') end where id = p_id;
  if not found then raise exception 'Hotel not found'; end if;
end;
$$;

create or replace function public.sa_reset_password(p_id bigint, p_email text, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if not exists (select 1 from public.staff where restaurant_id = p_id and email = lower(trim(p_email))) then
    raise exception 'That email is not part of this hotel';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where lower(email) = lower(trim(p_email));
end;
$$;

revoke execute on function public.sa_list_hotels(), public.sa_create_hotel(text, text, text, text, text, int, int, boolean, boolean, boolean, boolean),
  public.sa_update_hotel(bigint, text, text, text, boolean, boolean, boolean, boolean), public.sa_set_active(bigint, boolean, text),
  public.sa_reset_password(bigint, text, text) from public, anon;
grant execute on function public.sa_list_hotels(), public.sa_create_hotel(text, text, text, text, text, int, int, boolean, boolean, boolean, boolean),
  public.sa_update_hotel(bigint, text, text, text, boolean, boolean, boolean, boolean), public.sa_set_active(bigint, boolean, text),
  public.sa_reset_password(bigint, text, text) to authenticated;

-- The first, single-hotel room tables are no longer used; nobody should reach them.
revoke all on public.rooms, public.bookings, public.extras, public.payments from anon, authenticated;
-- ===== Staff logins made by the owner, Waiter / Manager roles, and parcel (takeaway) orders =====

-- Roles: owner (everything), manager (orders, billing, bills, rooms), staff = waiter (only adds dishes to tables).
alter table public.staff drop constraint staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('owner', 'manager', 'staff'));

create or replace function public.can_bill() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s join public.restaurants r on r.id = s.restaurant_id
                 where s.user_id = (select auth.uid()) and s.role in ('owner', 'manager') and r.active);
$$;
revoke execute on function public.can_bill() from public, anon;
grant execute on function public.can_bill() to authenticated;

-- Owner-only setup: tables, menu and restaurant settings.
alter policy "staff add tables" on public.dining_tables with check (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()));
alter policy "staff update tables" on public.dining_tables using (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()))
  with check (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()));
alter policy "staff delete tables" on public.dining_tables using (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()));
alter policy "staff add menu" on public.menu_items with check (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()));
alter policy "staff update menu" on public.menu_items using (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()))
  with check (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()));
alter policy "staff delete menu" on public.menu_items using (restaurant_id = (select public.my_restaurant()) and (select public.is_owner()));
alter policy "staff update own restaurant" on public.restaurants using (id = (select public.my_restaurant()) and (select public.is_owner()))
  with check (id = (select public.my_restaurant()) and (select public.is_owner()));
alter policy "rooms: add" on public.lodging_rooms with check (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')) and (select public.is_owner()));
alter policy "rooms: change" on public.lodging_rooms using (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')) and (select public.is_owner()))
  with check (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')) and (select public.is_owner()));
alter policy "rooms: remove" on public.lodging_rooms using (restaurant_id = (select public.my_restaurant()) and (select public.has_feature('rooms')) and (select public.is_owner()));

-- Parcel orders have no table. Only owners and managers take parcels.
alter table public.orders alter column table_id drop not null;
alter table public.orders add column is_parcel boolean not null default false;
alter table public.orders add constraint orders_parcel_has_no_table check (is_parcel = (table_id is null));
alter policy "staff open orders" on public.orders with check (
  restaurant_id = (select public.my_restaurant()) and status = 'open' and bill_no is null and tax_rate_bp is null and closed_at is null
  and case when is_parcel then (select public.can_bill())
           else exists (select 1 from public.dining_tables t where t.id = orders.table_id and t.restaurant_id = (select public.my_restaurant())) end);

create or replace function public.bill_table_label(o bigint) returns text
language sql stable security definer set search_path = '' as $$
  select case when oo.is_parcel then 'Parcel'
              else t.name || case when oo.is_split or oo.section <> 'A' then '-' || oo.section else '' end end
  from public.orders oo left join public.dining_tables t on t.id = oo.table_id where oo.id = o;
$$;

create or replace function public.mark_split_sections() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.table_id is not null and exists (select 1 from public.orders o
             where o.table_id = new.table_id and o.status = 'open' and o.id <> new.id) then
    update public.orders set is_split = true
     where table_id = new.table_id and status = 'open' and id <> new.id and not is_split;
    update public.orders set is_split = true where id = new.id;
  end if;
  return null;
end;
$$;

create or replace function public.guard_order_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'paid' then
    if current_setting('hotel.edit_paid', true) = 'on'
       and new.status = 'paid' and new.bill_no is not distinct from old.bill_no
       and new.closed_at is not distinct from old.closed_at and new.table_id is not distinct from old.table_id then
      return new;
    end if;
    raise exception 'This bill is already settled';
  end if;
  if current_setting('hotel.settle', true) is distinct from 'on'
     and (new.status <> old.status or new.bill_no is distinct from old.bill_no
          or new.tax_rate_bp is distinct from old.tax_rate_bp or new.closed_at is distinct from old.closed_at
          or new.payment_method is distinct from old.payment_method or new.table_id is distinct from old.table_id
          or new.is_parcel <> old.is_parcel or new.billed_at is distinct from old.billed_at) then
    raise exception 'Use Print Bill or Receive Payment to change this order';
  end if;
  return new;
end;
$$;

-- Printing and settling bills: owners and managers only (waiters just take orders).
create or replace function public.generate_bill(p_order_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare v_bill text; v_rest bigint;
begin
  if not public.can_bill() or not public.order_in_my_restaurant(p_order_id) then raise exception 'Only the owner or a manager can print bills'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'Add at least one item before printing the bill';
  end if;
  if not public.order_is_open(p_order_id) then raise exception 'Order not found or already paid'; end if;
  select bill_no, restaurant_id into v_bill, v_rest from public.orders where id = p_order_id for update;
  if v_bill is null then v_bill := public.next_bill_no(v_rest); end if;
  perform set_config('hotel.settle', 'on', true);
  update public.orders set bill_no = v_bill, billed_at = now() where id = p_order_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end;
$$;

create or replace function public.settle_order(p_order_id bigint, p_method text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_bill text; v_rest bigint;
begin
  if not public.can_bill() or not public.order_in_my_restaurant(p_order_id) then raise exception 'Only the owner or a manager can take payment'; end if;
  if p_method not in ('Cash', 'UPI', 'Card') then raise exception 'Unknown payment method'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'Add at least one item before settling';
  end if;
  if not public.order_is_open(p_order_id) then raise exception 'Order not found or already settled'; end if;
  select bill_no, restaurant_id into v_bill, v_rest from public.orders where id = p_order_id for update;
  if v_bill is null then v_bill := public.next_bill_no(v_rest); end if;
  perform set_config('hotel.settle', 'on', true);
  update public.orders
     set status = 'paid', bill_no = v_bill, payment_method = p_method, closed_at = now(),
         billed_at = coalesce(billed_at, now()),
         tax_rate_bp = (select tax_rate_bp from public.restaurants where id = v_rest)
   where id = p_order_id and status = 'open';
  perform set_config('hotel.settle', 'off', true);
  return v_bill;
end;
$$;

create or replace function public.checkout_stay(p_stay_id bigint, p_method text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_rest bigint; v_bill text; n int;
begin
  if not public.can_bill() or not public.has_feature('rooms') or not public.stay_open_mine(p_stay_id) then
    raise exception 'Only the owner or a manager can check guests out';
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

-- account_status() also reports whether this login may bill.
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
    'features', jsonb_build_object('tables', r.feat_tables, 'rooms', r.feat_rooms, 'trending', r.feat_trending, 'bill_edit', r.feat_bill_edit))
  from (select (select auth.uid()) as uid) me
  left join public.staff s on s.user_id = me.uid
  left join public.restaurants r on r.id = s.restaurant_id;
$$;

-- Owner creates a staff login: a Login ID (or an email) and a password. Login IDs sign in as <id>@staff.login.
create or replace function public.owner_create_staff(p_login text, p_password text, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_rest bigint := public.my_restaurant(); v_login text := lower(trim(p_login)); v_email text; v_uid uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can add staff'; end if;
  if p_role not in ('staff', 'manager') then raise exception 'Choose Waiter or Manager'; end if;
  if v_login ~ '@' then v_email := v_login;
  elsif v_login ~ '^[a-z0-9][a-z0-9._-]{2,29}$' then v_email := v_login || '@staff.login';
  else raise exception 'Login ID: 3 to 30 letters or numbers, no spaces (dots, - and _ are fine)'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if exists (select 1 from public.staff where email = v_email) then
    raise exception 'This Login ID is already taken. Try adding your hotel name, like ramesh.morya';
  end if;
  insert into public.staff (email, role, restaurant_id) values (v_email, p_role, v_rest);
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  else
    -- A login left over from someone removed earlier: give it the new password.
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = v_uid;
  end if;
  update public.staff set user_id = v_uid where email = v_email;
  return v_email;
end;
$$;

create or replace function public.owner_reset_staff_password(p_email text, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can change staff passwords'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if not exists (select 1 from public.staff where email = lower(trim(p_email)) and restaurant_id = public.my_restaurant() and role <> 'owner') then
    raise exception 'That login is not one of your staff';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where lower(email) = lower(trim(p_email));
end;
$$;

-- Owner can switch a staff member between Waiter and Manager.
create or replace function public.owner_set_staff_role(p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can change roles'; end if;
  if p_role not in ('staff', 'manager') then raise exception 'Choose Waiter or Manager'; end if;
  update public.staff set role = p_role where email = lower(trim(p_email)) and restaurant_id = public.my_restaurant() and role <> 'owner';
  if not found then raise exception 'That login is not one of your staff'; end if;
end;
$$;

revoke execute on function public.owner_create_staff(text, text, text), public.owner_reset_staff_password(text, text),
  public.owner_set_staff_role(text, text) from public, anon;
grant execute on function public.owner_create_staff(text, text, text), public.owner_reset_staff_password(text, text),
  public.owner_set_staff_role(text, text) to authenticated;

-- Owner removes staff (managers too, not only waiters).
alter policy "owner removes staff" on public.staff
  using ((select public.is_owner()) and role in ('staff', 'manager') and restaurant_id = (select public.my_restaurant()));

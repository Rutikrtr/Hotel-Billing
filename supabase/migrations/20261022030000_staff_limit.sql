-- Staff logins per hotel are part of the plan (Starter: owner only; Pro: owner + 2). Only the super admin
-- changes the limit; owner_add_staff refuses to go past it.
alter table public.restaurants add column if not exists staff_limit integer not null default 2
  check (staff_limit between 0 and 50);
-- Existing hotels keep every login they already have.
update public.restaurants r
   set staff_limit = greatest(2, (select count(*) from public.staff s where s.restaurant_id = r.id and s.role <> 'owner'));

-- Staff are created only through owner_add_staff (which checks the limit), never by inserting rows directly.
revoke insert on public.staff from authenticated, anon;

create or replace function public.sa_set_staff_limit(p_id bigint, p_limit integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  if p_limit is null or p_limit < 0 or p_limit > 50 then raise exception 'Staff logins must be between 0 and 50'; end if;
  update public.restaurants set staff_limit = p_limit where id = p_id;
  if not found then raise exception 'Hotel not found'; end if;
end;
$$;
revoke all on function public.sa_set_staff_limit(bigint, integer) from public, anon;
grant execute on function public.sa_set_staff_limit(bigint, integer) to authenticated;

create or replace function public.owner_add_staff(p_name text, p_password text, p_role text)
 returns text language plpgsql security definer set search_path = '' as $function$
declare
  v_rest bigint := public.my_restaurant();
  v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_first text; v_code text; v_login text; v_email text; v_uid uuid; n int := 0; v_limit int;
begin
  if not public.is_owner() then raise exception 'Only the owner can add staff'; end if;
  if p_role not in ('staff', 'manager') then raise exception 'Choose Waiter or Manager'; end if;
  if v_name = '' or length(v_name) > 40 then raise exception 'Enter the staff member’s name'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  -- Lock the hotel row so two taps at once can't both squeeze past the limit.
  select staff_limit into v_limit from public.restaurants where id = v_rest for update;
  if (select count(*) from public.staff where restaurant_id = v_rest and role <> 'owner') >= v_limit then
    raise exception 'Your plan includes % staff login%. Contact Techyverve to add more.', v_limit, case when v_limit = 1 then '' else 's' end;
  end if;

  v_first := left(regexp_replace(lower(split_part(v_name, ' ', 1)), '[^a-z]', '', 'g'), 10);
  if length(v_first) < 2 then v_first := 'staff'; end if;
  select left(string_agg(left(w, 1), '' order by i), 3) into v_code
    from regexp_split_to_table(lower(regexp_replace((select hotel_name from public.restaurants where id = v_rest), '[^A-Za-z ]', ' ', 'g')), '\s+')
         with ordinality as t(w, i)
   where w <> '' and w not in ('hotel', 'restaurant', 'the', 'and', 'family', 'cafe', 'dhaba', 'bar');
  if coalesce(length(v_code), 0) < 2 then v_code := 'h' || v_rest; end if;

  loop
    n := n + 1;
    v_login := v_first || '.' || v_code || (case when n <= 40 then (10 + floor(random() * 90))::int else (100 + floor(random() * 900))::int end);
    v_email := v_login || '@staff.login';
    exit when not exists (select 1 from public.staff where email = v_email)
          and not exists (select 1 from auth.users where lower(email) = v_email);
    if n > 200 then raise exception 'Could not make a Login ID, please try again'; end if;
  end loop;

  insert into public.staff (email, role, restaurant_id, display_name) values (v_email, p_role, v_rest, v_name);
  v_uid := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('name', v_name), now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  update public.staff set user_id = v_uid where email = v_email;
  return v_login;
end;
$function$;

create or replace function public.sa_list_hotels()
 returns jsonb language plpgsql stable security definer set search_path = '' as $function$
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
        'staff_used', (select count(*) from public.staff s where s.restaurant_id = r.id and s.role <> 'owner'),
        'staff_limit', r.staff_limit,
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
$function$;

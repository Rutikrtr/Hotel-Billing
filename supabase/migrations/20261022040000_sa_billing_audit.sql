-- Super admin back office: each hotel's plan and price, Techyverve's own bills to hotels,
-- the business details printed on those bills, and an activity log of every change.
-- Only the super admin can read or change any of it (hotels never see these tables).

-- 1. Plan and price per hotel
create table if not exists public.sa_subscriptions (
  restaurant_id bigint primary key references public.restaurants(id) on delete cascade,
  plan text not null default 'Pro',
  annual_price bigint not null default 599900 check (annual_price >= 0),   -- paise
  install_fee bigint not null default 200000 check (install_fee >= 0),     -- paise
  renews_on date,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

-- 2. Techyverve's details printed on its bills (one row)
create table if not exists public.sa_profile (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Techyverve',
  address text not null default '',
  phone text not null default '91725 23881',
  email text not null default '',
  website text not null default 'techyverve.in',
  gstin text not null default '',
  upi_id text not null default '',
  invoice_gst_bp int not null default 0 check (invoice_gst_bp between 0 and 2800),
  invoice_prefix text not null default 'TV'
);
insert into public.sa_profile (id) values (1) on conflict (id) do nothing;

-- 3. Bills from Techyverve to hotels. items: [{"text": "...", "qty": 1, "amount": 599900}] (amount = paise each)
create sequence if not exists public.sa_invoice_seq;
create table if not exists public.sa_invoices (
  id bigint generated always as identity primary key,
  invoice_no text not null unique,
  restaurant_id bigint references public.restaurants(id) on delete set null,
  hotel_name text not null,
  hotel_address text not null default '',
  hotel_phone text not null default '',
  issued_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  due_on date,
  items jsonb not null default '[]'::jsonb,
  gst_rate_bp int not null default 0 check (gst_rate_bp between 0 and 2800),
  subtotal bigint not null default 0,
  gst bigint not null default 0,
  total bigint not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'cancelled')),
  paid_on date,
  payment_method text,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Number and add up every bill in the database, so the totals are always right.
create or replace function public.sa_invoice_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prefix text;
begin
  if new.invoice_no is null or new.invoice_no = '' then
    select invoice_prefix into v_prefix from public.sa_profile where id = 1;
    new.invoice_no := coalesce(nullif(v_prefix, ''), 'TV') || '-' || to_char(new.issued_on, 'YYYY') || '-'
                      || lpad(nextval('public.sa_invoice_seq')::text, 4, '0');
  end if;
  select coalesce(sum(greatest((i->>'qty')::numeric, 0) * greatest((i->>'amount')::bigint, 0)), 0)::bigint
    into new.subtotal from jsonb_array_elements(new.items) i;
  new.gst := floor((new.subtotal * new.gst_rate_bp + 5000) / 10000.0)::bigint;
  new.total := new.subtotal + new.gst;
  if new.status = 'paid' and new.paid_on is null then new.paid_on := (now() at time zone 'Asia/Kolkata')::date; end if;
  if new.status <> 'paid' then new.paid_on := null; new.payment_method := null; end if;
  return new;
end;
$$;
create or replace trigger sa_invoice_fill before insert or update on public.sa_invoices
  for each row execute function public.sa_invoice_fill();

-- 4. Activity log
create table if not exists public.sa_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  actor_role text,
  restaurant_id bigint,
  hotel_name text,
  action text not null,
  details jsonb not null default '{}'::jsonb
);
create index if not exists sa_audit_at on public.sa_audit (at desc);

create or replace function public.sa_log(p_restaurant bigint, p_hotel text, p_action text, p_details jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.sa_audit (actor, actor_role, restaurant_id, hotel_name, action, details)
  values (coalesce((select email from auth.users where id = (select auth.uid())), 'system'),
          case when public.is_super_admin() then 'super admin' when public.is_owner() then 'owner'
               when (select auth.uid()) is null then 'system' else 'staff' end,
          p_restaurant, p_hotel, p_action, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function public.sa_log(bigint, text, text, jsonb) from public, anon, authenticated;

-- Hotel created, edited (only the fields that changed, old → new), paused, deleted
create or replace function public.sa_audit_restaurants() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text; d jsonb := '{}'::jsonb; o jsonb; n jsonb;
  watched text[] := array['hotel_name', 'hotel_address', 'hotel_phone', 'hotel_gstin', 'tax_rate_bp', 'quick_close', 'kot_tables',
                          'feat_tables', 'feat_rooms', 'feat_trending', 'feat_bill_edit', 'feat_qr_menu', 'staff_limit', 'active', 'paused_reason'];
begin
  if tg_op = 'INSERT' then
    perform public.sa_log(new.id, new.hotel_name, 'Hotel created', '{}'::jsonb);
  elsif tg_op = 'DELETE' then
    perform public.sa_log(old.id, old.hotel_name, 'Hotel deleted', '{}'::jsonb);
  else
    o := to_jsonb(old); n := to_jsonb(new);
    foreach k in array watched loop
      if (o -> k) is distinct from (n -> k) then d := d || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k)); end if;
    end loop;
    if d <> '{}'::jsonb then
      perform public.sa_log(new.id, new.hotel_name,
        case when d ? 'active' then case when new.active then 'Service resumed' else 'Service paused' end else 'Hotel edited' end, d);
    end if;
  end if;
  return null;
end;
$$;
create or replace trigger sa_audit_restaurants after insert or update or delete on public.restaurants
  for each row execute function public.sa_audit_restaurants();

-- Staff logins added, removed, role changed
create or replace function public.sa_audit_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_rid bigint; v_email text; v_role text; v_hotel text;
begin
  if tg_op = 'DELETE' then v_rid := old.restaurant_id; v_email := old.email; v_role := old.role;
  else v_rid := new.restaurant_id; v_email := new.email; v_role := new.role; end if;
  select hotel_name into v_hotel from public.restaurants where id = v_rid;
  if tg_op = 'INSERT' then
    perform public.sa_log(v_rid, v_hotel, 'Login added', jsonb_build_object('login', v_email, 'role', v_role));
  elsif tg_op = 'DELETE' then
    perform public.sa_log(v_rid, v_hotel, 'Login removed', jsonb_build_object('login', v_email, 'role', v_role));
  elsif old.role is distinct from new.role then
    perform public.sa_log(v_rid, v_hotel, 'Role changed', jsonb_build_object('login', v_email, 'role', jsonb_build_array(old.role, new.role)));
  end if;
  return null;
end;
$$;
create or replace trigger sa_audit_staff after insert or update or delete on public.staff
  for each row execute function public.sa_audit_staff();

-- Plan / price changes
create or replace function public.sa_audit_subscriptions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_hotel text; d jsonb := '{}'::jsonb; k text; o jsonb; n jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' then o := to_jsonb(old); end if;
  select hotel_name into v_hotel from public.restaurants where id = new.restaurant_id;
  foreach k in array array['plan', 'annual_price', 'install_fee', 'renews_on', 'notes'] loop
    if tg_op = 'INSERT' or (o -> k) is distinct from (n -> k) then
      d := d || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
    end if;
  end loop;
  if d <> '{}'::jsonb then perform public.sa_log(new.restaurant_id, v_hotel, 'Plan & price changed', d); end if;
  return null;
end;
$$;
create or replace trigger sa_audit_subscriptions after insert or update on public.sa_subscriptions
  for each row execute function public.sa_audit_subscriptions();

-- Bills created, paid, cancelled, edited, deleted
create or replace function public.sa_audit_invoices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.sa_log(new.restaurant_id, new.hotel_name, 'Bill created', jsonb_build_object('bill', new.invoice_no, 'total', new.total));
  elsif tg_op = 'DELETE' then
    perform public.sa_log(old.restaurant_id, old.hotel_name, 'Bill deleted', jsonb_build_object('bill', old.invoice_no, 'total', old.total));
  elsif old.status is distinct from new.status then
    perform public.sa_log(new.restaurant_id, new.hotel_name,
      case new.status when 'paid' then 'Bill paid' when 'cancelled' then 'Bill cancelled' else 'Bill marked unpaid' end,
      jsonb_build_object('bill', new.invoice_no, 'total', new.total, 'method', new.payment_method));
  elsif old.items is distinct from new.items or old.total is distinct from new.total then
    perform public.sa_log(new.restaurant_id, new.hotel_name, 'Bill edited',
      jsonb_build_object('bill', new.invoice_no, 'total', jsonb_build_array(old.total, new.total)));
  end if;
  return null;
end;
$$;
create or replace trigger sa_audit_invoices after insert or update or delete on public.sa_invoices
  for each row execute function public.sa_audit_invoices();

-- Password resets by the super admin are logged too (the password itself is never stored).
create or replace function public.sa_reset_password(p_id bigint, p_email text, p_password text)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if not exists (select 1 from public.staff where restaurant_id = p_id and email = lower(trim(p_email))) then
    raise exception 'That email is not part of this hotel';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where lower(email) = lower(trim(p_email));
  perform public.sa_log(p_id, (select hotel_name from public.restaurants where id = p_id), 'Password reset',
                        jsonb_build_object('login', lower(trim(p_email))));
end;
$function$;

-- 5. Access: super admin only
alter table public.sa_subscriptions enable row level security;
alter table public.sa_profile enable row level security;
alter table public.sa_invoices enable row level security;
alter table public.sa_audit enable row level security;
create policy "super admin manages subscriptions" on public.sa_subscriptions for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy "super admin manages profile" on public.sa_profile for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy "super admin manages invoices" on public.sa_invoices for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy "super admin reads activity" on public.sa_audit for select to authenticated
  using ((select public.is_super_admin()));
revoke all on public.sa_subscriptions, public.sa_profile, public.sa_invoices, public.sa_audit from anon;
revoke insert, update, delete on public.sa_audit from authenticated;
revoke insert, delete on public.sa_profile from authenticated;
grant select, insert, update, delete on public.sa_subscriptions, public.sa_invoices to authenticated;
grant select, update on public.sa_profile to authenticated;
grant select on public.sa_audit to authenticated;

-- Every existing hotel starts on Pro at ₹5,999 a year.
insert into public.sa_subscriptions (restaurant_id) select id from public.restaurants on conflict do nothing;

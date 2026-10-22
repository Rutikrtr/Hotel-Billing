-- Keep the super admin back office small:
--  * bills store only amounts (yearly plan, installation, one extra charge), GST, total and paid status;
--  * the activity log keeps only "Hotel created", "Hotel edited" and "Plan edited".
-- (Applied in pieces through the SQL API; removing the old objects is in cleanup_after_short_bills.sql.)

create table if not exists public.sa_bills (
  id bigint generated always as identity primary key,
  bill_no text not null unique,
  restaurant_id bigint references public.restaurants(id) on delete set null,
  hotel_name text not null,
  bill_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  annual_amount bigint not null default 0 check (annual_amount >= 0),
  install_amount bigint not null default 0 check (install_amount >= 0),
  extra_amount bigint not null default 0 check (extra_amount >= 0),
  extra_text text not null default '' check (length(extra_text) <= 80),
  gst_rate_bp int not null default 0 check (gst_rate_bp between 0 and 2800),
  total bigint not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  paid_on date,
  method text
);
create or replace function public.sa_bill_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prefix text; v_sub bigint;
begin
  if new.bill_no is null or new.bill_no = '' then
    select invoice_prefix into v_prefix from public.sa_profile where id = 1;
    new.bill_no := coalesce(nullif(v_prefix, ''), 'TV') || '-' || to_char(new.bill_date, 'YYYY') || '-'
                   || lpad(nextval('public.sa_invoice_seq')::text, 4, '0');
  end if;
  v_sub := new.annual_amount + new.install_amount + new.extra_amount;
  new.total := v_sub + floor((v_sub * new.gst_rate_bp + 5000) / 10000.0)::bigint;
  if new.status = 'paid' and new.paid_on is null then new.paid_on := (now() at time zone 'Asia/Kolkata')::date; end if;
  if new.status <> 'paid' then new.paid_on := null; new.method := null; end if;
  return new;
end;
$$;
create or replace trigger sa_bill_fill before insert or update on public.sa_bills
  for each row execute function public.sa_bill_fill();
alter table public.sa_bills enable row level security;
create policy "super admin manages bills" on public.sa_bills for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
revoke all on public.sa_bills from anon;
grant select, insert, update, delete on public.sa_bills to authenticated;

-- Log only hotel create / edit and plan edits.
create or replace function public.sa_audit_invoices() returns trigger
language plpgsql security definer set search_path = '' as $$ begin return null; end; $$;
create or replace function public.sa_audit_staff() returns trigger
language plpgsql security definer set search_path = '' as $$ begin return null; end; $$;
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
end;
$function$;
create or replace function public.sa_audit_restaurants() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text; d jsonb := '{}'::jsonb; o jsonb; n jsonb;
  watched text[] := array['hotel_name', 'hotel_address', 'hotel_phone', 'hotel_gstin', 'tax_rate_bp', 'quick_close', 'kot_tables',
                          'feat_tables', 'feat_rooms', 'feat_trending', 'feat_bill_edit', 'feat_qr_menu', 'staff_limit', 'active', 'paused_reason'];
begin
  if tg_op = 'INSERT' then
    perform public.sa_log(new.id, new.hotel_name, 'Hotel created', '{}'::jsonb);
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new);
    foreach k in array watched loop
      if (o -> k) is distinct from (n -> k) then d := d || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k)); end if;
    end loop;
    if d <> '{}'::jsonb then perform public.sa_log(new.id, new.hotel_name, 'Hotel edited', d); end if;
  end if;
  return null;
end;
$$;
create or replace function public.sa_audit_subscriptions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_hotel text; d jsonb := '{}'::jsonb; k text; o jsonb; n jsonb := to_jsonb(new);
begin
  if tg_op <> 'UPDATE' then return null; end if;
  o := to_jsonb(old);
  select hotel_name into v_hotel from public.restaurants where id = new.restaurant_id;
  foreach k in array array['plan', 'annual_price', 'install_fee', 'renews_on'] loop
    if (o -> k) is distinct from (n -> k) then d := d || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k)); end if;
  end loop;
  if d <> '{}'::jsonb then perform public.sa_log(new.restaurant_id, v_hotel, 'Plan edited', d); end if;
  return null;
end;
$$;
update public.sa_audit set action = 'Plan edited' where action = 'Plan & price changed';

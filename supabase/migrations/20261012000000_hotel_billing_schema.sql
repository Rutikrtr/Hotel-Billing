-- Hotel Billing schema for Supabase. Applied to project "hotel-billing".
-- Money columns are integer paise (1/100 rupee). Tax rates are basis points (1200 = 12%).

-- Staff allow-list. Only users whose email is listed here can read or change data.
create table public.staff (
  email text primary key check (email = lower(email)),
  user_id uuid unique references auth.users(id) on delete set null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()));
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()) and role = 'owner');
$$;

-- Links a new sign-up to its staff entry. If the staff list is empty, the first sign-up becomes owner.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff) then
    insert into public.staff (email, user_id, role) values (lower(new.email), new.id, 'owner');
  else
    update public.staff set user_id = new.id where email = lower(new.email) and user_id is null;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.settings (
  id int primary key default 1 check (id = 1),
  hotel_name text not null default 'My Hotel',
  hotel_address text not null default '',
  hotel_phone text not null default '',
  hotel_gstin text not null default '',
  tax_rate_bp int not null default 1200 check (tax_rate_bp between 0 and 10000)
);
insert into public.settings (id) values (1);

create table public.rooms (
  id bigint generated always as identity primary key,
  number text not null unique,
  room_type text not null,
  rate bigint not null check (rate >= 0)
);

create table public.bookings (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id),
  guest_name text not null check (guest_name <> ''),
  guest_phone text not null default '',
  guest_address text not null default '',
  guest_gstin text not null default '',
  check_in date not null,
  check_out date not null,
  rate bigint not null check (rate >= 0),
  discount bigint not null default 0 check (discount >= 0),
  status text not null default 'checked_in' check (status in ('checked_in', 'checked_out')),
  invoice_no text unique,
  tax_rate_bp int,
  created_at timestamptz not null default now(),
  check (check_out >= check_in)
);
create index on public.bookings (room_id);
-- A room can only have one guest in house at a time.
create unique index bookings_one_active_per_room on public.bookings (room_id) where status = 'checked_in';

create table public.extras (
  id bigint generated always as identity primary key,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  description text not null check (description <> ''),
  quantity int not null check (quantity >= 1),
  unit_price bigint not null check (unit_price >= 0)
);
create index on public.extras (booking_id);

create table public.payments (
  id bigint generated always as identity primary key,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  amount bigint not null check (amount > 0),
  method text not null check (method in ('Cash', 'Card', 'UPI', 'Bank transfer')),
  paid_at timestamptz not null default now()
);
create index on public.payments (booking_id);

create or replace function public.booking_is_open(b bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings where id = b and status = 'checked_in');
$$;

-- Checked-out bookings are locked; only checkout() may change status/invoice fields.
create or replace function public.guard_booking_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'checked_out' then
    raise exception 'Booking is already checked out and invoiced';
  end if;
  if current_setting('hotel.checkout', true) is distinct from 'on'
     and (new.status <> old.status or new.invoice_no is distinct from old.invoice_no
          or new.tax_rate_bp is distinct from old.tax_rate_bp) then
    raise exception 'Use checkout to close a booking';
  end if;
  if new.check_out < new.check_in then
    raise exception 'Check-out cannot be before check-in';
  end if;
  return new;
end;
$$;
create trigger guard_booking_update before update on public.bookings
  for each row execute function public.guard_booking_update();

-- Closes a stay, issues the invoice number and freezes the current tax rate on it.
create or replace function public.checkout(p_booking_id bigint) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_invoice text;
begin
  if not public.is_staff() then
    raise exception 'Not authorised';
  end if;
  v_invoice := 'INV-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(p_booking_id::text, 5, '0');
  perform set_config('hotel.checkout', 'on', true);
  update public.bookings
     set status = 'checked_out', invoice_no = v_invoice,
         tax_rate_bp = (select tax_rate_bp from public.settings where id = 1)
   where id = p_booking_id and status = 'checked_in';
  perform set_config('hotel.checkout', 'off', true);
  if not found then
    raise exception 'Booking not found or already checked out';
  end if;
  return v_invoice;
end;
$$;

alter table public.staff enable row level security;
alter table public.settings enable row level security;
alter table public.rooms enable row level security;
alter table public.bookings enable row level security;
alter table public.extras enable row level security;
alter table public.payments enable row level security;

create policy "staff can view staff" on public.staff for select to authenticated using ((select public.is_staff()));
create policy "owner adds staff" on public.staff for insert to authenticated with check ((select public.is_owner()) and role = 'staff');
create policy "owner removes staff" on public.staff for delete to authenticated using ((select public.is_owner()) and role = 'staff');

create policy "staff read settings" on public.settings for select to authenticated using ((select public.is_staff()));
create policy "staff update settings" on public.settings for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "staff read rooms" on public.rooms for select to authenticated using ((select public.is_staff()));
create policy "staff add rooms" on public.rooms for insert to authenticated with check ((select public.is_staff()));
create policy "staff update rooms" on public.rooms for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff delete rooms" on public.rooms for delete to authenticated using ((select public.is_staff()));

create policy "staff read bookings" on public.bookings for select to authenticated using ((select public.is_staff()));
create policy "staff add bookings" on public.bookings for insert to authenticated
  with check ((select public.is_staff()) and status = 'checked_in' and invoice_no is null and tax_rate_bp is null);
create policy "staff update bookings" on public.bookings for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "staff read extras" on public.extras for select to authenticated using ((select public.is_staff()));
create policy "staff add extras" on public.extras for insert to authenticated
  with check ((select public.is_staff()) and public.booking_is_open(booking_id));
create policy "staff delete extras" on public.extras for delete to authenticated
  using ((select public.is_staff()) and public.booking_is_open(booking_id));

create policy "staff read payments" on public.payments for select to authenticated using ((select public.is_staff()));
create policy "staff add payments" on public.payments for insert to authenticated with check ((select public.is_staff()));

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.checkout(bigint) from public, anon;
grant execute on function public.checkout(bigint) to authenticated;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_owner() from public, anon;
revoke execute on function public.booking_is_open(bigint) from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.booking_is_open(bigint) to authenticated;

-- The owner account is seeded per deployment, e.g.:
-- insert into public.staff (email, role) values ('owner@example.com', 'owner');

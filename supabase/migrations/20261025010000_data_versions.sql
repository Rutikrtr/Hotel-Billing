-- One small change number per hotel. It goes up whenever the menu, the tables or the hotel's settings change
-- (not on every bill). The phone app keeps the menu and tables saved and downloads them again only when this
-- number has moved, so opening the app is 3 small requests instead of downloading the whole menu each time.
create table if not exists public.data_versions (
  restaurant_id bigint primary key references public.restaurants(id) on delete cascade,
  version bigint not null default 1
);
alter table public.data_versions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'data_versions' and policyname = 'own hotel reads its version') then
    create policy "own hotel reads its version" on public.data_versions for select to authenticated using (restaurant_id = public.my_restaurant());
  end if;
end $$;
grant select on public.data_versions to authenticated;
revoke insert, update, delete on public.data_versions from anon, authenticated;
insert into public.data_versions (restaurant_id) select id from public.restaurants on conflict do nothing;

create or replace function public.bump_data_version() returns trigger language plpgsql security definer set search_path to '' as $f$
declare rid bigint;
begin
  if tg_table_name = 'restaurants' then
    rid := new.id;
    -- A new bill number is not a settings change.
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'bill_counter') is not distinct from (to_jsonb(old) - 'bill_counter') then return null; end if;
  else
    rid := coalesce(new.restaurant_id, old.restaurant_id);
  end if;
  insert into public.data_versions (restaurant_id, version) values (rid, 2)
    on conflict (restaurant_id) do update set version = public.data_versions.version + 1;
  return null;
end $f$;
revoke execute on function public.bump_data_version() from public, anon, authenticated;

drop trigger if exists bump_data_version on public.menu_items;
create trigger bump_data_version after insert or update or delete on public.menu_items for each row execute function public.bump_data_version();
drop trigger if exists bump_data_version on public.dining_tables;
create trigger bump_data_version after insert or update or delete on public.dining_tables for each row execute function public.bump_data_version();
drop trigger if exists bump_data_version on public.restaurants;
create trigger bump_data_version after insert or update on public.restaurants for each row execute function public.bump_data_version();

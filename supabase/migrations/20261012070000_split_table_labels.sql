-- Once a table has more than one section, every section is labelled with its letter (T2-A, T2-B).
alter table public.orders add column is_split boolean not null default false;

create or replace function public.mark_split_sections() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.orders o
             where o.table_id = new.table_id and o.status = 'open' and o.id <> new.id) then
    update public.orders set is_split = true
     where table_id = new.table_id and status = 'open' and id <> new.id and not is_split;
    update public.orders set is_split = true where id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function public.mark_split_sections() from public, anon, authenticated;
create trigger mark_split_sections after insert on public.orders
  for each row execute function public.mark_split_sections();

-- Tables that are already split right now.
update public.orders o set is_split = true
 where o.status = 'open' and not o.is_split
   and exists (select 1 from public.orders x where x.table_id = o.table_id and x.status = 'open' and x.id <> o.id);

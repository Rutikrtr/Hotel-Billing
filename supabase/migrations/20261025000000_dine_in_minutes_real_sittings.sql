-- Average time at table: count only real sittings (up to 4 hours). A table left open overnight
-- made the average jump to hours. Applied with a text replace of the function body:
do $do$ declare d text := pg_get_functiondef('public.sales_report'::regproc); begin
  if position('4 hours' in d) > 0 then return; end if;
  execute replace(d, 'filter (where not is_parcel and opened_at is not null)',
    'filter (where not is_parcel and opened_at is not null and closed_at - opened_at <= interval ''4 hours'')');
end $do$;

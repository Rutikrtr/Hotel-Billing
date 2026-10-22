-- Run ONCE in Supabase → SQL Editor (paste and press Run). Safe to run again; it skips what is already gone.
-- Removes the old, longer bills table and the log entries/loggers that are no longer kept,
-- so the database holds only: short bills, plans, and hotel create/edit logs.
-- Your bills are already copied to the new short table (sa_bills); nothing in use is deleted.

drop table if exists public.sa_invoices;                               -- old long bills table (copied to sa_bills)
drop function if exists public.sa_invoice_fill();
drop function if exists public.sa_audit_invoices();
drop trigger if exists sa_audit_staff on public.staff;                 -- staff logins are no longer logged
drop function if exists public.sa_audit_staff();
drop policy if exists "owner adds staff" on public.staff;              -- unused: staff are added only via owner_add_staff
alter table public.sa_subscriptions drop column if exists notes;       -- never used
delete from public.sa_audit where action not in ('Hotel created', 'Hotel edited', 'Plan edited');

select 'Cleanup done' as result;

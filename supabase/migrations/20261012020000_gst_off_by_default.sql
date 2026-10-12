-- GST is optional: off by default (0). Owners turn it on in Settings → Charge GST on bills.
alter table public.settings alter column tax_rate_bp set default 0;
update public.settings set tax_rate_bp = 0 where id = 1;

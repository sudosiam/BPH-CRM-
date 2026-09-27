-- Qualified sits between lead and sold. The new enum value has to commit
-- before later migrations can use it in a check.
alter type public.lead_status add value if not exists 'qualified' after 'lead';

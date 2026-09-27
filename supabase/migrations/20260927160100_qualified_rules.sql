-- A qualified contact is still open: it can have a follow-up, and it is not closed.
alter table public.leads drop constraint follow_up_only_for_leads;
alter table public.leads add constraint follow_up_only_for_leads
  check (status in ('lead', 'qualified') or follow_up_on is null);

alter table public.leads drop constraint open_leads_are_not_closed;
alter table public.leads add constraint open_leads_are_not_closed
  check (status not in ('lead', 'qualified') or closed_on is null);

drop index if exists public.leads_owner_follow_up_idx;
create index leads_owner_follow_up_idx on public.leads (owner_id, follow_up_on)
  where status in ('lead', 'qualified') and deleted_at is null;

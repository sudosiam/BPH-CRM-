alter table public.orgs add column if not exists wa_template text not null default '';

alter table public.leads add column if not exists sold_amount numeric;
alter table public.leads add column if not exists lost_reason text;
alter table public.leads add column if not exists source text;
alter table public.leads add column if not exists last_contact_at timestamptz;
alter table public.leads add column if not exists contact_count integer not null default 0;
alter table public.leads add column if not exists history text not null default '';

alter table public.leads drop constraint if exists leads_sold_amount_check;
alter table public.leads add constraint leads_sold_amount_check check (sold_amount is null or sold_amount >= 0);

create or replace function public.set_wa_template(template text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  next_template text := left(coalesce(template, ''), 500);
begin
  select org_id into org
  from public.profiles
  where id = auth.uid() and role = 'owner' and removed_at is null;
  if org is null then
    raise exception 'not owner';
  end if;
  update public.orgs set wa_template = next_template where id = org;
  return next_template;
end;
$$;

revoke all on function public.set_wa_template(text) from public;
grant execute on function public.set_wa_template(text) to authenticated;

create or replace function public.my_book()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'org_id', o.id,
    'org_name', o.name,
    'invite_code', case when p.role = 'owner' then o.invite_code else null end,
    'role', p.role,
    'display_name', p.display_name,
    'timezone', p.timezone,
    'notify_enabled', p.notify_enabled,
    'notify_minute', p.notify_minute,
    'wa_template', o.wa_template
  )
  from public.profiles p
  join public.orgs o on o.id = p.org_id
  where p.id = auth.uid()
    and p.removed_at is null
$$;

create or replace view public.orgs_visible
with (security_barrier = true, security_invoker = false) as
select o.id,
       o.name,
       case when p.role = 'owner' then o.invite_code else null end as invite_code,
       o.wa_template
from public.orgs o
join public.profiles p on p.org_id = o.id and p.id = auth.uid() and p.removed_at is null;

grant select on public.orgs_visible to authenticated;

-- Morning digest. Runs only when pg_cron and pg_net exist and a vault secret named bph_function_key is set.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema extensions;
    create extension if not exists pg_net with schema extensions;
  end if;
exception when others then
  raise notice 'followup digest cron extensions were not enabled';
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from vault.decrypted_secrets where name = 'bph_function_key') then
    begin
      perform cron.unschedule('followup-digest');
    exception when others then
      null;
    end;
    perform cron.schedule(
      'followup-digest',
      '*/15 * * * *',
      $job$
      select net.http_post(
        url := 'https://peokaompmxeoxidupvfs.supabase.co/functions/v1/followup-digest',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bph_function_key' limit 1)
        ),
        body := '{}'::jsonb
      );
      $job$
    );
  end if;
exception when others then
  raise notice 'followup digest was not scheduled';
end $$;

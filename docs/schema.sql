-- BPH CRM schema.
-- Apply this in Supabase. The included server implements the same rules when Supabase is not configured.

create extension if not exists pgcrypto;

create type public.lead_status as enum ('lead', 'sold', 'lost');
create type public.member_role as enum ('owner', 'member');

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  invite_code text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.orgs (id),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  role public.member_role not null default 'member',
  timezone text not null default 'UTC',
  notify_enabled boolean not null default false,
  notify_minute smallint not null default 480 check (notify_minute between 0 and 1439),
  last_digest_on date,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create index profiles_org_idx on public.profiles (org_id);

create table public.leads (
  id uuid primary key,
  org_id uuid not null references public.orgs (id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 40),
  notes text not null default '' check (char_length(notes) <= 2000),
  status public.lead_status not null default 'lead',
  follow_up_on date,
  closed_on date,
  owner_id uuid not null,
  created_by uuid not null,
  updated_by uuid not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint follow_up_only_for_leads check (status = 'lead' or follow_up_on is null),
  constraint open_leads_are_not_closed check (status <> 'lead' or closed_on is null),
  constraint leads_owner_fk foreign key (org_id, owner_id) references public.profiles (org_id, id),
  constraint leads_created_by_fk foreign key (org_id, created_by) references public.profiles (org_id, id),
  constraint leads_updated_by_fk foreign key (org_id, updated_by) references public.profiles (org_id, id)
);

create index leads_org_updated_idx on public.leads (org_id, updated_at);
create index leads_owner_follow_up_idx on public.leads (owner_id, follow_up_on)
  where status = 'lead' and deleted_at is null;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_lead_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' then
    new.version = old.version + 1;
  end if;
  return new;
end;
$$;

create trigger leads_version
before insert or update on public.leads
for each row execute function public.set_lead_version();

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id
  from public.profiles
  where id = auth.uid()
    and removed_at is null
$$;

revoke all on function public.current_org_id() from public;
grant execute on function public.current_org_id() to authenticated;

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
    'notify_minute', p.notify_minute
  )
  from public.profiles p
  join public.orgs o on o.id = p.org_id
  where p.id = auth.uid()
    and p.removed_at is null
$$;

revoke all on function public.my_book() from public;
grant execute on function public.my_book() to authenticated;

alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.push_subscriptions enable row level security;

create policy orgs_select on public.orgs
for select to authenticated
using (id = public.current_org_id());

create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or org_id = public.current_org_id());

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid() and org_id = public.current_org_id());

create policy leads_select on public.leads
for select to authenticated
using (org_id = public.current_org_id());

create policy leads_insert on public.leads
for insert to authenticated
with check (
  org_id = public.current_org_id()
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy leads_update on public.leads
for update to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id() and updated_by = auth.uid());

create policy push_own on public.push_subscriptions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Tombstones stay selectable so other phones learn about deletes.
-- Authenticated clients do not get a hard-delete policy.

create or replace function public.make_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end;
$$;

create or replace function public.create_org(org_name text, display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
  code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and removed_at is null) then
    raise exception 'already in a business';
  end if;

  loop
    code := public.make_invite_code();
    exit when not exists (select 1 from public.orgs where invite_code = code);
  end loop;

  insert into public.orgs (name, invite_code, created_by)
  values (btrim(org_name), code, auth.uid())
  returning id into new_org;

  perform set_config('bph.profile_admin', 'on', true);
  insert into public.profiles (id, org_id, display_name, role)
  values (auth.uid(), new_org, btrim(display_name), 'owner')
  on conflict (id) do update
    set org_id = excluded.org_id,
        display_name = excluded.display_name,
        role = 'owner',
        removed_at = null;

  return new_org;
end;
$$;

create or replace function public.join_org(code text, display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and removed_at is null) then
    raise exception 'already in a business';
  end if;

  select id into found_org
  from public.orgs
  where invite_code = upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'));

  if found_org is null then
    raise exception 'invalid code';
  end if;

  perform set_config('bph.profile_admin', 'on', true);
  insert into public.profiles (id, org_id, display_name, role)
  values (auth.uid(), found_org, btrim(display_name), 'member')
  on conflict (id) do update
    set org_id = excluded.org_id,
        display_name = excluded.display_name,
        role = 'member',
        removed_at = null;

  return found_org;
end;
$$;

create or replace function public.protect_profile()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bph.profile_admin', true), '') = 'on' then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.role is distinct from old.role
     or new.removed_at is distinct from old.removed_at then
    raise exception 'profile membership cannot be changed here';
  end if;
  return new;
end;
$$;

create trigger profiles_protect
before update on public.profiles
for each row execute function public.protect_profile();

create or replace function public.freeze_lead_owner()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_id := auth.uid();
      new.created_by := auth.uid();
    end if;
    return new;
  end if;
  new.owner_id := old.owner_id;
  new.created_by := old.created_by;
  return new;
end;
$$;

create trigger leads_freeze_owner
before insert or update on public.leads
for each row execute function public.freeze_lead_owner();

create or replace function public.remove_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  if member_id = auth.uid() then
    raise exception 'you cannot remove yourself';
  end if;

  select org_id into org
  from public.profiles
  where id = auth.uid()
    and role = 'owner'
    and removed_at is null;

  if org is null then
    raise exception 'not owner';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = member_id and org_id = org and removed_at is null
  ) then
    raise exception 'member not found';
  end if;

  perform set_config('bph.profile_admin', 'on', true);

  update public.profiles
  set removed_at = now()
  where id = member_id;
end;
$$;

create or replace function public.regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  code text;
begin
  select org_id into org
  from public.profiles
  where id = auth.uid()
    and role = 'owner'
    and removed_at is null;

  if org is null then
    raise exception 'not owner';
  end if;

  loop
    code := public.make_invite_code();
    exit when not exists (select 1 from public.orgs where invite_code = code);
  end loop;

  update public.orgs set invite_code = code where id = org;
  return code;
end;
$$;

revoke all on function public.make_invite_code() from public, anon, authenticated;
revoke all on function public.create_org(text, text) from public;
revoke all on function public.join_org(text, text) from public;
revoke all on function public.remove_member(uuid) from public;
revoke all on function public.regenerate_invite_code() from public;
grant execute on function public.create_org(text, text) to authenticated;
grant execute on function public.join_org(text, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.regenerate_invite_code() to authenticated;

create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$ select now() $$;

grant execute on function public.server_now() to authenticated;

create or replace view public.orgs_visible
with (security_barrier = true, security_invoker = false) as
select o.id,
       o.name,
       case when p.role = 'owner' then o.invite_code else null end as invite_code
from public.orgs o
join public.profiles p on p.org_id = o.id and p.id = auth.uid() and p.removed_at is null;

revoke select on public.orgs from anon, authenticated;
grant select on public.orgs_visible to authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end;
$$;

revoke all on function public.save_push_subscription(text, text, text) from public;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

create or replace function public.transfer_owner(member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  if member_id = auth.uid() then
    raise exception 'pick someone else';
  end if;
  select org_id into org
  from public.profiles
  where id = auth.uid() and role = 'owner' and removed_at is null;
  if org is null then
    raise exception 'not owner';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = member_id and org_id = org and removed_at is null
  ) then
    raise exception 'member not found';
  end if;
  perform set_config('bph.profile_admin', 'on', true);
  update public.profiles set role = 'member' where id = auth.uid();
  update public.profiles set role = 'owner' where id = member_id;
end;
$$;

revoke all on function public.transfer_owner(uuid) from public;
grant execute on function public.transfer_owner(uuid) to authenticated;

create or replace function public.purge_tombstones()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.leads
  where deleted_at is not null
    and deleted_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_tombstones() from public;
grant execute on function public.purge_tombstones() to service_role;

alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.profiles;

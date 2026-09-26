-- Rejoin, hidden invite codes, push endpoint takeover, ownership transfer, tombstone purge.

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

-- Moving a profile to another business updates profiles.org_id. Leads reference
-- (org_id, id) with no ON UPDATE CASCADE, so those references are moved to
-- someone who is still in the old business first. Same-org rejoin does not
-- change org_id and does not touch leads.

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
  if coalesce(current_setting('bph.lead_admin', true), '') = 'on' then
    return new;
  end if;
  new.owner_id := old.owner_id;
  new.created_by := old.created_by;
  return new;
end;
$$;

create or replace function public.detach_profile_leads(profile_id uuid, old_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  keeper uuid;
begin
  if old_org is null or profile_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.leads
    where org_id = old_org
      and (owner_id = profile_id or created_by = profile_id or updated_by = profile_id)
  ) then
    return;
  end if;

  select id into keeper
  from public.profiles
  where org_id = old_org
    and id <> profile_id
    and removed_at is null
    and role = 'owner'
  limit 1;

  if keeper is null then
    select id into keeper
    from public.profiles
    where org_id = old_org
      and id <> profile_id
      and removed_at is null
    limit 1;
  end if;

  if keeper is null then
    raise exception 'This account still has leads in the other business. Ask that owner to reassign them before leaving.';
  end if;

  perform set_config('bph.lead_admin', 'on', true);
  update public.leads
  set owner_id = case when owner_id = profile_id then keeper else owner_id end,
      created_by = case when created_by = profile_id then keeper else created_by end,
      updated_by = case when updated_by = profile_id then keeper else updated_by end
  where org_id = old_org
    and (owner_id = profile_id or created_by = profile_id or updated_by = profile_id);
end;
$$;

revoke all on function public.detach_profile_leads(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_org(org_name text, display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
  code text;
  existing public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into existing
  from public.profiles
  where id = auth.uid();

  if existing.id is not null and existing.removed_at is null then
    raise exception 'already in a business';
  end if;

  loop
    code := public.make_invite_code();
    exit when not exists (select 1 from public.orgs where invite_code = code);
  end loop;

  insert into public.orgs (name, invite_code, created_by)
  values (btrim(org_name), code, auth.uid())
  returning id into new_org;

  if existing.id is not null and existing.org_id is distinct from new_org then
    perform public.detach_profile_leads(auth.uid(), existing.org_id);
  end if;

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
  next_name text := nullif(btrim(coalesce(display_name, '')), '');
  existing public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select id into found_org
  from public.orgs
  where invite_code = upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));

  if found_org is null then
    raise exception 'That code does not match a business.';
  end if;

  select * into existing
  from public.profiles
  where id = auth.uid();

  perform set_config('bph.profile_admin', 'on', true);

  if existing.id is not null and existing.removed_at is null then
    if existing.org_id <> found_org then
      raise exception 'You are already in a business.';
    end if;
    if next_name is not null then
      update public.profiles
      set display_name = next_name
      where id = auth.uid();
    end if;
    return found_org;
  end if;

  if next_name is null then
    next_name := nullif(btrim(coalesce(existing.display_name, '')), '');
  end if;
  if next_name is null then
    raise exception 'Add your name.';
  end if;

  if existing.id is not null and existing.org_id is distinct from found_org then
    perform public.detach_profile_leads(auth.uid(), existing.org_id);
  end if;

  insert into public.profiles (id, org_id, display_name, role)
  values (auth.uid(), found_org, next_name, 'member')
  on conflict (id) do update
    set org_id = excluded.org_id,
        display_name = excluded.display_name,
        role = 'member',
        removed_at = null;

  return found_org;
end;
$$;

comment on column public.leads.history is
  'The app caps history at 4000 characters before upload. There is no database check, so an older longer note is not rejected on the next save.';

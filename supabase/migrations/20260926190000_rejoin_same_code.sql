-- An existing teammate can enter the current invite code and get back in.
-- A removed teammate rejoins with that code. A blank name keeps the name they already had.

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

-- The person who adds a lead stays its owner. Later edits cannot reassign it.

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

drop trigger if exists leads_freeze_owner on public.leads;
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

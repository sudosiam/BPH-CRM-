-- A signed-in person can always see their own team, including after they sign out and back in.

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or org_id = public.current_org_id());

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

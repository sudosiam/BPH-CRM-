-- Signed-in RPCs stay executable by authenticated. purge_tombstones is service_role only.
-- server_now stays callable by anon because the keepalive job uses the anon key.

revoke all on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

revoke all on function public.my_book() from public, anon;
grant execute on function public.my_book() to authenticated;

revoke all on function public.create_org(text, text) from public, anon;
grant execute on function public.create_org(text, text) to authenticated;

revoke all on function public.join_org(text, text) from public, anon;
grant execute on function public.join_org(text, text) to authenticated;

revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

revoke all on function public.regenerate_invite_code() from public, anon;
grant execute on function public.regenerate_invite_code() to authenticated;

revoke all on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

revoke all on function public.transfer_owner(uuid) from public, anon;
grant execute on function public.transfer_owner(uuid) to authenticated;

revoke all on function public.set_wa_template(text) from public, anon;
grant execute on function public.set_wa_template(text) to authenticated;

revoke all on function public.detach_profile_leads(uuid, uuid) from public, anon, authenticated;

create or replace function public.purge_tombstones()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'not allowed';
  end if;
  delete from public.leads
  where deleted_at is not null
    and deleted_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_tombstones() from public, anon, authenticated;
grant execute on function public.purge_tombstones() to service_role;

grant execute on function public.server_now() to anon, authenticated;

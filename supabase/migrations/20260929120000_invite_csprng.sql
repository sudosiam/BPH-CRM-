-- Invite codes use the database CSPRNG. The alphabet length divides 256, so the byte modulo is uniform.

create or replace function public.make_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  code text := '';
  i int;
begin
  for i in 0..7 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % length(alphabet)), 1);
  end loop;
  return code;
end;
$$;

revoke all on function public.make_invite_code() from public, anon, authenticated;

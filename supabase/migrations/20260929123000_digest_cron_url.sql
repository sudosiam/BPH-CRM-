-- Reschedule the morning digest against this project's URL.
-- The URL comes from the database setting app.supabase_url or the vault secret supabase_url.
-- The bearer is the vault secret bph_function_key, which must match the edge function secret BPH_FUNCTION_KEY.
-- If either value is missing, the existing job is left in place.

do $$
declare
  base text;
  secret text;
  job text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'followup digest was not rescheduled; cron extensions are not available';
    return;
  end if;

  begin
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'bph_function_key'
    limit 1;
  exception when others then
    secret := null;
  end;

  begin
    base := nullif(current_setting('app.supabase_url', true), '');
  exception when others then
    base := null;
  end;

  if base is null then
    begin
      select decrypted_secret into base
      from vault.decrypted_secrets
      where name = 'supabase_url'
      limit 1;
    exception when others then
      base := null;
    end;
  end if;

  if secret is null or base is null or btrim(base) = '' then
    raise notice 'followup digest was not rescheduled; set vault secret bph_function_key and supabase_url (or app.supabase_url)';
    return;
  end if;

  begin
    perform cron.unschedule('followup-digest');
  exception when others then
    null;
  end;

  base := regexp_replace(btrim(base), '/+$', '');
  job := format($job$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bph_function_key' limit 1)
      ),
      body := '{}'::jsonb
    );
  $job$, base || '/functions/v1/followup-digest');

  perform cron.schedule('followup-digest', '*/15 * * * *', job);
exception when others then
  raise notice 'followup digest was not rescheduled';
end $$;

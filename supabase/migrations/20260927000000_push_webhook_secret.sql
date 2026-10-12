-- Only the database may call the `push` edge function.
--
-- The dashboard webhook this replaces authenticated with the anon key, which
-- anyone holding the app has, and the function trusted sender/conversation/
-- content from the body. Now the trigger sends only the message id plus a
-- shared secret, and the function reads everything else back from the row.
--
-- Before applying (the secret never goes in git):
--
--   1. Generate one:           openssl rand -base64 32
--   2. Give it to the function: supabase secrets set PUSH_WEBHOOK_SECRET='<secret>'
--   3. Store it in Vault:       select vault.create_secret('<secret>', 'push_webhook_secret');
--   4. Deploy the function:     supabase functions deploy push
--
-- Then apply this straight away: between 4 and this, the old webhook has no
-- secret and its pushes are rejected.
--
-- To rotate: update both (vault.update_secret(id, '<new>') and
-- `supabase secrets set`) back to back.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'push_webhook_secret'
  limit 1;

  if secret is null then
    raise warning 'notify_push: vault secret push_webhook_secret is missing, no push sent';
    return new;
  end if;

  perform net.http_post(
    url := 'https://kblseanmnntpxqzgmsho.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'record', jsonb_build_object('id', new.id)
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke execute on function private.notify_push() from public, anon, authenticated;

-- The dashboard webhook used this name; replace it.
drop trigger if exists push_notification on public.messages;

create trigger push_notification
  after insert on public.messages
  for each row execute function private.notify_push();

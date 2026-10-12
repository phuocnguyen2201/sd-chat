-- Which push tokens can take a data-only push and decrypt it on the device.
--
-- The `push` function sends those tokens the message ciphertext with no
-- title/body; the app's background task decrypts it and shows the
-- notification. Every other token (iOS, Android builds without the task, which
-- would show nothing for a data-only push) gets a visible "New message".
--
-- Only the app sets this, on its own token rows. The existing
-- "Allow profile owner access" policy (ALL, profile_id = auth.uid()) already
-- covers that update.

alter table public.push_notification_tokens
  add column if not exists preview_capable boolean not null default false;

-- #13: profiles SELECT is open to every signed-in user, so profiles.fcm_token exposed
-- every user's push token. Nothing reads it: the push function uses
-- push_notification_tokens (owner-only RLS), and the only writer was the unused
-- components/Push.tsx (deleted). Dropping the column also drops the stale tokens in it.
--
-- Check before applying that nothing outside the repo reads it:
--   select count(*) from public.profiles where fcm_token is not null;

alter table public.profiles drop column if exists fcm_token;

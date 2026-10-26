-- #12: let an account be deleted while a group it created still has members.
-- Members' keys for a group were wrapped by its creator, and the app pins that
-- wrapping key under conversations.created_by. The foreign key to profiles forced
-- delete-account to clear created_by (locking members out on a new device) or to
-- refuse with a 409. Without it, created_by keeps the deleted creator's id.
--
-- Apply BEFORE deploying the matching delete-account, which no longer clears
-- created_by: with the key still in place, deleting a creator's profile fails.

alter table public.conversations drop constraint if exists conversations_created_by_fkey;

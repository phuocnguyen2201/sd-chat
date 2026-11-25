-- #176: group renames show live for every member.
-- Add public.conversations to the supabase_realtime publication so clients get
-- UPDATE events. Realtime checks the "Authenticated can view their
-- conversations" SELECT policy per subscriber, so only members receive a row.
-- Idempotent: the publication is managed in the dashboard and may already
-- include the table.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end
$$;

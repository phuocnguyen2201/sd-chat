-- Every table in public must have RLS on. With RLS off, policies are ignored and any
-- signed-in user can read and change every row, so a new table must not slip through.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select is_empty(
  $$select c.relname::text from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity$$,
  'RLS is enabled on every table in public'
);

select * from finish();
rollback;

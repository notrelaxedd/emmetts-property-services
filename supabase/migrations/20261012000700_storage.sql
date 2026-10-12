-- =============================================================================
-- 0700 — Storage: private `lead-photos` bucket
--
-- Quote-form photos are uploaded by the server action with the service role
-- (which bypasses RLS) and shown in /admin through signed URLs. Only the owner
-- may read objects through the API; crew and anon get nothing.
--
-- Skipped when the `storage` schema doesn't exist (plain Postgres in the local
-- test harness). All statements run through EXECUTE so the block still parses
-- without that schema.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage')
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise notice 'storage schema not found; skipping lead-photos bucket';
    return;
  end if;

  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('lead-photos', 'lead-photos', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
    on conflict (id) do update set public = false
  $sql$;

  execute 'drop policy if exists "lead-photos owner read" on storage.objects';
  execute $sql$
    create policy "lead-photos owner read" on storage.objects
      for select to authenticated
      using (bucket_id = 'lead-photos' and (select public.is_owner()))
  $sql$;

  execute 'drop policy if exists "lead-photos owner delete" on storage.objects';
  execute $sql$
    create policy "lead-photos owner delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'lead-photos' and (select public.is_owner()))
  $sql$;
  -- No insert/update policies: uploads go through the service role.
end;
$$;

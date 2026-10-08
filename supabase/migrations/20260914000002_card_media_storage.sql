-- =============================================================================
-- Card photos, banners and backgrounds: the card-media storage bucket
--
-- Images are resized and re-encoded in the browser (which also strips EXIF,
-- including GPS location from phone photos) before they are uploaded here,
-- because server-side image transforms are a paid Supabase feature. The bucket
-- is public so a card's images load for a stranger without a signed URL; what
-- makes that safe is that paths are unguessable and writes are tightly fenced:
--
--   * Every object lives at <member uuid>/<random uuid>.<ext>. A member can
--     write, replace or delete only inside the folder named after their own
--     id, and only once they have been let in (not pending) -- the same line
--     every other piece of member data draws since 20260911000001.
--   * The card row can only reference a path in its owner's folder (the
--     member_cards_media_paths CHECK in 20260914000001), so a member cannot
--     point their card at an image someone else uploaded either.
--   * The bucket refuses anything over 2 MB or that is not WebP, JPEG or PNG.
--     Uploads are resized well below that first; the limit is the backstop.
--   * A member can hold at most 30 objects, and a suspended member cannot
--     upload at all (private.card_media_upload_allowed). The bucket is public
--     and the free tier has about 1 GB, so without a cap one scripted loop
--     could fill it and break every other member's uploads -- or use the
--     chapter's bucket as free image hosting. A card shows three images; 30
--     leaves room for the uploads an abandoned edit leaves behind.
--
-- SELECT is granted on the member's own folder as well as DELETE. Supabase's
-- storage API reads an object before removing it, so delete-without-select
-- fails; and reads of other folders go through the public URL, never the
-- table, so nobody can list who has uploaded what.
--
-- Admins can read and delete objects in every folder. Deleting an account
-- removes the card but not its files -- storage.objects has no tie to
-- profiles -- so the admin delete flow lists and removes the member's folder
-- through the storage API (removeMemberCardMedia in src/services/cards.ts),
-- which needs exactly these two rights. Admin rather than officer: it pairs
-- with admin_delete_member(), which is admin-only. Not done in SQL, because
-- deleting a storage.objects row leaves the file itself in place.
--
-- Guarded on the storage schema existing, so the PGlite pgTAP harness -- which
-- has no storage schema unless it stubs one -- still applies every migration.
-- Dynamic SQL throughout, because a statement naming storage.objects would fail
-- to parse where that table does not exist, guard or no guard.
-- =============================================================================

do $migration$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not present; skipping the card-media bucket and its policies.';
    return;
  end if;

  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('card-media', 'card-media', true, 2097152,
            array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do update
      set public             = excluded.public,
          file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
  $sql$;

  -- Whether the caller may upload one more object: let in, not suspended, and
  -- fewer than 30 objects already in their folder. Definer, so counting the
  -- folder does not run back through this table's own policies. No argument:
  -- it only ever answers about the caller, so having EXECUTE (which policy
  -- evaluation needs) tells a member nothing about anyone else. Created here,
  -- inside the guard, because its body names storage.objects.
  execute $sql$
    create or replace function private.card_media_upload_allowed()
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $fn$
      select exists (
               select 1 from public.profiles p
                where p.id = (select auth.uid())
                  and p.membership_status not in ('pending', 'suspended'))
         and (select count(*)
                from storage.objects o
               where o.bucket_id = 'card-media'
                 and (storage.foldername(o.name))[1] = (select auth.uid())::text) < 30;
    $fn$
  $sql$;
  execute 'revoke execute on function private.card_media_upload_allowed() from public, anon';
  execute 'grant execute on function private.card_media_upload_allowed() to authenticated';

  -- Insert: own folder, a well-formed path, and room to upload. The path
  -- pattern is the same one the card's CHECK accepts, so nothing can be
  -- uploaded that a card could not then use -- no nested folders, no odd names.
  execute 'drop policy if exists card_media_insert_own on storage.objects';
  execute $sql$
    create policy card_media_insert_own on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'card-media'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
        and private.card_media_upload_allowed()
      )
  $sql$;

  execute 'drop policy if exists card_media_select_own on storage.objects';
  execute $sql$
    create policy card_media_select_own on storage.objects
      for select to authenticated
      using (
        bucket_id = 'card-media'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and private.is_approved_member((select auth.uid()))
      )
  $sql$;

  -- Update needs both halves: USING decides which rows can be touched, WITH
  -- CHECK what they may become -- without it, a member could rename their own
  -- object into someone else's folder.
  execute 'drop policy if exists card_media_update_own on storage.objects';
  execute $sql$
    create policy card_media_update_own on storage.objects
      for update to authenticated
      using (
        bucket_id = 'card-media'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and private.is_approved_member((select auth.uid()))
      )
      with check (
        bucket_id = 'card-media'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
        and private.is_approved_member((select auth.uid()))
      )
  $sql$;

  execute 'drop policy if exists card_media_delete_own on storage.objects';
  execute $sql$
    create policy card_media_delete_own on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'card-media'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and private.is_approved_member((select auth.uid()))
      )
  $sql$;

  -- Admins: read and delete in any folder, for cleaning up after a deleted
  -- account. No insert or update: an admin cannot put an image on anyone's
  -- card.
  execute 'drop policy if exists card_media_select_admin on storage.objects';
  execute $sql$
    create policy card_media_select_admin on storage.objects
      for select to authenticated
      using (
        bucket_id = 'card-media'
        and private.is_admin((select auth.uid()))
      )
  $sql$;

  execute 'drop policy if exists card_media_delete_admin on storage.objects';
  execute $sql$
    create policy card_media_delete_admin on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'card-media'
        and private.is_admin((select auth.uid()))
      )
  $sql$;

  raise notice 'card-media bucket and its policies are in place.';
end;
$migration$;

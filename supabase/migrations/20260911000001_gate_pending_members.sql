-- =============================================================================
-- A pending account gets no member data
--
-- Until now 'pending' only blocked check-in. A member waiting for the join code
-- could still read every non-draft event, every active announcement and every
-- member-visibility resource. The portal navigation was the only thing between
-- them and that data, and navigation is not a control: the same rows are one
-- REST call away from anyone holding a session, and a session is free while
-- email confirmation is off.
--
-- So the routing gate added alongside this migration is the convenience, and
-- this file is the control. A pending account now sees exactly what a signed-out
-- visitor sees -- no more -- and the client cannot widen that.
--
-- Scope is deliberately 'pending' and not "anything except active". Alumni,
-- inactive and suspended members keep the access they have today; changing that
-- is a chapter policy decision, not a security fix, and quietly locking out
-- alumni while fixing an unrelated hole would be the wrong way to make it.
-- =============================================================================


-- ── The predicate ───────────────────────────────────────────────────────────
--
-- In `private` for the same reason as the role predicates in 20260909000001:
-- policies can call it, PostgREST cannot expose it, so it never becomes an
-- endpoint that answers questions about other members.
--
-- Missing row means not approved. The only way to have a session without a
-- profile is for handle_new_user() to have failed, and that rolls the account
-- back -- but if it ever happens, failing closed is the answer.

create or replace function private.is_approved_member(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_member
       and p.membership_status <> 'pending'
  );
$$;

comment on function private.is_approved_member(uuid) is
  'True once a member has been let in, by join code or by an officer. False '
  'while pending. Used by the member read policies; not reachable from PostgREST.';

revoke execute on function private.is_approved_member(uuid) from public;
grant execute on function private.is_approved_member(uuid) to authenticated;


-- ── events ──────────────────────────────────────────────────────────────────
--
-- Parity with anon rather than a flat denial. events_select_public_anon allows
-- `status <> 'draft' and is_public`, and the public homepage is rendered for
-- signed-in visitors too. RLS picks policies by role, not by how the page was
-- reached, so a blanket denial here would blank the public events section for a
-- pending member while a logged-out stranger still saw it. Matching the anon
-- condition keeps the public site public and gives the pending member nothing
-- extra for having signed up.

drop policy if exists events_select_published on public.events;
create policy events_select_published on public.events
  for select to authenticated
  using (
    status <> 'draft'
    and (private.is_approved_member(auth.uid()) or is_public)
  );


-- ── announcements ───────────────────────────────────────────────────────────
--
-- No anon policy exists on this table, so announcements are member-only in
-- their entirety and there is no public subset to preserve. A pending account
-- sees none.

drop policy if exists announcements_select_active on public.announcements;
create policy announcements_select_active on public.announcements
  for select to authenticated
  using (
    private.is_approved_member(auth.uid())
    and not is_archived
    and published_at is not null
    and published_at <= now()
    and (expires_at is null or expires_at > now())
  );


-- ── resources ───────────────────────────────────────────────────────────────
--
-- 'public' resources stay readable, matching resources_select_public_anon.
-- 'member' resources are what the visibility column exists to protect, so they
-- now require having actually been admitted.

drop policy if exists resources_select_member on public.resources;
create policy resources_select_member on public.resources
  for select to authenticated
  using (
    not is_archived
    and published_at <= now()
    and (
      visibility = 'public'
      or (visibility = 'member' and private.is_approved_member(auth.uid()))
    )
  );


-- Officer policies are untouched throughout. events_select_officer,
-- announcements_select_officer and resources_select_officer are separate
-- permissive policies, so an officer still sees everything regardless of the
-- membership_status on their own profile -- which is what stops an officer
-- locking themselves out of the tools they would use to fix it.

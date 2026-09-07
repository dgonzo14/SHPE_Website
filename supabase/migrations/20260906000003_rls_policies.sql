-- =============================================================================
-- 20260906000003_rls_policies.sql
-- Row Level Security. This file — not the React router, and not which buttons
-- the UI renders — is what actually protects member data.
--
-- Two rules hold throughout:
--   1. Members may READ their own rows. They may WRITE almost nothing directly;
--      attendance, points and roles are only ever produced by a validated
--      SECURITY DEFINER function.
--   2. event_checkin_secrets gets RLS with no policies at all. There is no
--      grant, no policy, and therefore no query path from any client.
-- =============================================================================

alter table public.app_settings             enable row level security;
alter table public.profiles                 enable row level security;
alter table public.member_roles             enable row level security;
alter table public.academic_terms           enable row level security;
alter table public.event_categories         enable row level security;
alter table public.events                   enable row level security;
alter table public.event_checkin_secrets    enable row level security;
alter table public.event_attendance         enable row level security;
alter table public.point_transactions       enable row level security;
alter table public.announcements            enable row level security;
alter table public.resources                enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.checkin_attempts         enable row level security;
alter table public.admin_audit_log          enable row level security;


-- ── Baseline privileges ─────────────────────────────────────────────────────
-- Start from nothing, then grant only the verbs each role legitimately needs.
-- RLS narrows rows; these grants narrow operations. Both layers apply.

revoke all on all tables in schema public from anon, authenticated;


-- ── app_settings ────────────────────────────────────────────────────────────
-- Members never read this table directly; they call public.get_app_config(),
-- which returns only the keys that are safe to expose.

grant select on public.app_settings to authenticated;

create policy app_settings_select_officer on public.app_settings
  for select to authenticated
  using (public.is_officer(auth.uid()));

-- Writes go through public.admin_set_app_setting() so they are audited.


-- ── profiles ────────────────────────────────────────────────────────────────

grant select, update on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_officer on public.profiles
  for select to authenticated
  using (public.is_officer(auth.uid()));

-- Which *columns* survive this update is decided by
-- public.profiles_guard_protected_columns(); this only decides which rows.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_officer on public.profiles
  for update to authenticated
  using (public.is_officer(auth.uid()))
  with check (public.is_officer(auth.uid()));

-- No INSERT policy: profiles are created only by the auth.users trigger.
-- No DELETE policy: accounts are deactivated, not erased.


-- ── member_roles ────────────────────────────────────────────────────────────
-- Read-only to clients. There is no INSERT/UPDATE/DELETE policy, so
-- `update member_roles set role = 'admin'` fails for everyone, including
-- officers. Elevation happens only through public.admin_set_role().

grant select on public.member_roles to authenticated;

create policy member_roles_select_own on public.member_roles
  for select to authenticated
  using (member_id = auth.uid());

create policy member_roles_select_officer on public.member_roles
  for select to authenticated
  using (public.is_officer(auth.uid()));


-- ── academic_terms ──────────────────────────────────────────────────────────

grant select on public.academic_terms to authenticated;
grant insert, update, delete on public.academic_terms to authenticated;

create policy academic_terms_select_authenticated on public.academic_terms
  for select to authenticated
  using (true);

create policy academic_terms_write_admin on public.academic_terms
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));


-- ── event_categories ────────────────────────────────────────────────────────

grant select on public.event_categories to authenticated;
grant insert, update, delete on public.event_categories to authenticated;

create policy event_categories_select_authenticated on public.event_categories
  for select to authenticated
  using (true);

create policy event_categories_write_officer on public.event_categories
  for all to authenticated
  using (public.is_officer(auth.uid()))
  with check (public.is_officer(auth.uid()));


-- ── events ──────────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.events to authenticated;

-- Drafts are invisible to members: an unpublished event must not leak from a
-- member's event list just because the UI filters it out.
create policy events_select_published on public.events
  for select to authenticated
  using (status <> 'draft');

create policy events_select_officer on public.events
  for select to authenticated
  using (public.is_officer(auth.uid()));

create policy events_insert_officer on public.events
  for insert to authenticated
  with check (public.is_officer(auth.uid()));

create policy events_update_officer on public.events
  for update to authenticated
  using (public.is_officer(auth.uid()))
  with check (public.is_officer(auth.uid()));

-- Deletion is limited to admins and to drafts. Anything a member could have
-- attended is cancelled or completed, never destroyed — and the ON DELETE
-- RESTRICT foreign keys back this up even if this policy were widened.
create policy events_delete_admin_draft_only on public.events
  for delete to authenticated
  using (public.is_admin(auth.uid()) and status = 'draft');


-- ── event_checkin_secrets ───────────────────────────────────────────────────
-- No grants, no policies. Intentionally unreachable from anon and authenticated.
-- Only SECURITY DEFINER functions (which run as the table owner) can read it.

revoke all on public.event_checkin_secrets from anon, authenticated;


-- ── event_attendance ────────────────────────────────────────────────────────
-- SELECT only. There is no INSERT policy, so a member cannot mark themselves
-- present by calling the REST API directly — check_in_with_code() is the sole
-- path, and it validates the code, the window, and membership status first.

grant select on public.event_attendance to authenticated;

create policy event_attendance_select_own on public.event_attendance
  for select to authenticated
  using (member_id = auth.uid());

create policy event_attendance_select_officer on public.event_attendance
  for select to authenticated
  using (public.is_officer(auth.uid()));


-- ── point_transactions ──────────────────────────────────────────────────────
-- SELECT only, for the same reason. `insert into point_transactions
-- (member_id, amount) values (auth.uid(), 999999)` has no policy to satisfy.

grant select on public.point_transactions to authenticated;

create policy point_transactions_select_own on public.point_transactions
  for select to authenticated
  using (member_id = auth.uid());

create policy point_transactions_select_officer on public.point_transactions
  for select to authenticated
  using (public.is_officer(auth.uid()));


-- ── announcements ───────────────────────────────────────────────────────────

grant select, insert, update, delete on public.announcements to authenticated;

-- Expiry is enforced in the policy, not just in the query the client happens to
-- send, so an expired or unpublished announcement is unreachable either way.
create policy announcements_select_active on public.announcements
  for select to authenticated
  using (
    not is_archived
    and published_at is not null
    and published_at <= now()
    and (expires_at is null or expires_at > now())
  );

create policy announcements_select_officer on public.announcements
  for select to authenticated
  using (public.is_officer(auth.uid()));

create policy announcements_write_officer on public.announcements
  for all to authenticated
  using (public.is_officer(auth.uid()))
  with check (public.is_officer(auth.uid()));


-- ── resources ───────────────────────────────────────────────────────────────
-- Officer-only resources are filtered by the database. Hiding them in the UI
-- would leave them one REST call away.

grant select on public.resources to anon;
grant select, insert, update, delete on public.resources to authenticated;

create policy resources_select_public_anon on public.resources
  for select to anon
  using (not is_archived and visibility = 'public' and published_at <= now());

create policy resources_select_member on public.resources
  for select to authenticated
  using (
    not is_archived
    and published_at <= now()
    and visibility in ('public', 'member')
  );

create policy resources_select_officer on public.resources
  for select to authenticated
  using (public.is_officer(auth.uid()));

create policy resources_write_officer on public.resources
  for all to authenticated
  using (public.is_officer(auth.uid()))
  with check (public.is_officer(auth.uid()));


-- ── notification_preferences ────────────────────────────────────────────────

grant select, insert, update on public.notification_preferences to authenticated;

create policy notification_preferences_own on public.notification_preferences
  for all to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());


-- ── checkin_attempts ────────────────────────────────────────────────────────
-- Officers can investigate abuse; members cannot read the attempt log (it would
-- reveal which events currently have live codes). Nobody writes it from a client.

grant select on public.checkin_attempts to authenticated;

create policy checkin_attempts_select_officer on public.checkin_attempts
  for select to authenticated
  using (public.is_officer(auth.uid()));


-- ── admin_audit_log ─────────────────────────────────────────────────────────
-- Append-only from the application's point of view: written exclusively by
-- public.write_audit_log(), which clients cannot execute.

grant select on public.admin_audit_log to authenticated;

create policy admin_audit_log_select_officer on public.admin_audit_log
  for select to authenticated
  using (public.is_officer(auth.uid()));


-- =============================================================================
-- Derived views
--
-- security_invoker = true is essential: without it a view runs with its
-- owner's rights and would happily hand every member the whole chapter's point
-- ledger. With it, the same view returns one member's rows to a member and all
-- rows to an officer.
--
-- Chapter-wide aggregates that a member legitimately needs (their percentile)
-- are therefore NOT computed from these views on the client — see
-- public.get_member_points_summary(), which aggregates server-side and returns
-- only the requesting member's standing.
-- =============================================================================

create view public.member_point_totals
with (security_invoker = true) as
  select
    pt.member_id,
    pt.academic_term_id,
    sum(pt.amount)::integer   as total_points,
    count(*)::integer         as transaction_count
  from public.point_transactions pt
  group by pt.member_id, pt.academic_term_id;

create view public.member_event_counts
with (security_invoker = true) as
  select
    a.member_id,
    e.academic_term_id,
    count(*)::integer as events_attended
  from public.event_attendance a
  join public.events e on e.id = a.event_id
  group by a.member_id, e.academic_term_id;

-- These views are created after the blanket REVOKE above, so they inherit
-- Supabase's default grants. security_invoker already means anon resolves to
-- zero rows, but saying so explicitly beats relying on that.
revoke all on public.member_point_totals from anon;
revoke all on public.member_event_counts from anon;

grant select on public.member_point_totals to authenticated;
grant select on public.member_event_counts to authenticated;

-- =============================================================================
-- Move the role predicates out of the API-exposed schema
--
-- has_role, is_officer and is_admin were created in public with EXECUTE left on
-- PUBLIC, and public is the schema PostgREST exposes. So they were callable as
-- RPCs by anyone holding the anon key -- which ships in the browser bundle by
-- design. Verified against a running database, with no session at all:
--
--     POST /rest/v1/rpc/is_admin   {"p_member":"<uuid>"}  ->  true
--     POST /rest/v1/rpc/is_officer {"p_member":"<uuid>"}  ->  true
--
-- They are SECURITY DEFINER, so member_roles RLS never applies and the answer
-- is authoritative. Member UUIDs are not secret -- events.created_by and
-- point_transactions.created_by hand them out -- so this let an unauthenticated
-- visitor enumerate exactly who runs the chapter, which is the reconnaissance
-- step before a targeted phish.
--
-- Simply revoking EXECUTE does not work: 19 RLS policies call these functions,
-- and a policy expression is evaluated with the querying role's privileges, so
-- revoking from authenticated would deny every one of those policies and lock
-- members out of their own data.
--
-- The fix is to put the functions somewhere PostgREST does not look. A schema
-- outside db-schemas is invisible to the API but perfectly callable from a
-- policy, provided the role holds USAGE on the schema and EXECUTE on the
-- function. Everything that referenced them is repointed here in one migration,
-- because a policy holds a resolved reference and would block the drop.
-- =============================================================================

create schema if not exists private;

comment on schema private is
  'Not exposed through PostgREST. Holds helpers that RLS policies must call but '
  'that no client should be able to call directly.';

-- USAGE only. Without EXECUTE on a specific function, nothing here is reachable,
-- and nothing in this schema is ever added to the API''s exposed schema list.
grant usage on schema private to authenticated, service_role;


-- ── The predicates, unchanged except for where they live ────────────────────
-- Still SECURITY DEFINER: they read member_roles, which members cannot read for
-- anyone but themselves, and that is the whole point -- a policy has to be able
-- to answer "is this caller an officer" without granting the caller the ability
-- to ask it about someone else.

create or replace function private.has_role(p_member uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.member_roles r
     where r.member_id = p_member and r.role = p_role
  );
$$;

create or replace function private.is_officer(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.member_roles r
     where r.member_id = p_member and r.role in ('officer', 'admin')
  );
$$;

create or replace function private.is_admin(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.member_roles r
     where r.member_id = p_member and r.role = 'admin'
  );
$$;

revoke execute on function private.has_role(uuid, public.app_role) from public;
revoke execute on function private.is_officer(uuid) from public;
revoke execute on function private.is_admin(uuid) from public;

-- authenticated needs EXECUTE for policy evaluation. anon deliberately does
-- not: no anon-facing policy calls these (events_select_public_anon and
-- resources_select_public_anon test columns only), so anon loses the oracle
-- without losing any access it had.
grant execute on function private.has_role(uuid, public.app_role) to authenticated;
grant execute on function private.is_officer(uuid) to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;


-- ── Policies repointed ──────────────────────────────────────────────────────
-- Generated from the live catalogue rather than transcribed, so the set cannot
-- drift from what is actually installed.

drop policy if exists academic_terms_write_admin on public.academic_terms;
create policy academic_terms_write_admin on public.academic_terms
  for all to authenticated
  using (private.is_admin(auth.uid()))
  with check (private.is_admin(auth.uid()));
drop policy if exists admin_audit_log_select_officer on public.admin_audit_log;
create policy admin_audit_log_select_officer on public.admin_audit_log
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists announcements_select_officer on public.announcements;
create policy announcements_select_officer on public.announcements
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists announcements_write_officer on public.announcements;
create policy announcements_write_officer on public.announcements
  for all to authenticated
  using (private.is_officer(auth.uid()))
  with check (private.is_officer(auth.uid()));
drop policy if exists app_settings_select_officer on public.app_settings;
create policy app_settings_select_officer on public.app_settings
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists checkin_attempts_select_officer on public.checkin_attempts;
create policy checkin_attempts_select_officer on public.checkin_attempts
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists checkin_throttle_hits_select_officer on public.checkin_throttle_hits;
create policy checkin_throttle_hits_select_officer on public.checkin_throttle_hits
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists event_attendance_select_officer on public.event_attendance;
create policy event_attendance_select_officer on public.event_attendance
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists event_categories_write_officer on public.event_categories;
create policy event_categories_write_officer on public.event_categories
  for all to authenticated
  using (private.is_officer(auth.uid()))
  with check (private.is_officer(auth.uid()));
drop policy if exists events_delete_admin_draft_only on public.events;
create policy events_delete_admin_draft_only on public.events
  for delete to authenticated
  using ((private.is_admin(auth.uid()) AND (status = 'draft'::event_status)));
drop policy if exists events_insert_officer on public.events;
create policy events_insert_officer on public.events
  for insert to authenticated
  with check (private.is_officer(auth.uid()));
drop policy if exists events_select_officer on public.events;
create policy events_select_officer on public.events
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists events_update_officer on public.events;
create policy events_update_officer on public.events
  for update to authenticated
  using (private.is_officer(auth.uid()))
  with check (private.is_officer(auth.uid()));
drop policy if exists member_roles_select_officer on public.member_roles;
create policy member_roles_select_officer on public.member_roles
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists point_transactions_select_officer on public.point_transactions;
create policy point_transactions_select_officer on public.point_transactions
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists profiles_select_officer on public.profiles;
create policy profiles_select_officer on public.profiles
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists profiles_update_officer on public.profiles;
create policy profiles_update_officer on public.profiles
  for update to authenticated
  using (private.is_officer(auth.uid()))
  with check (private.is_officer(auth.uid()));
drop policy if exists resources_select_officer on public.resources;
create policy resources_select_officer on public.resources
  for select to authenticated
  using (private.is_officer(auth.uid()));
drop policy if exists resources_write_officer on public.resources;
create policy resources_write_officer on public.resources
  for all to authenticated
  using (private.is_officer(auth.uid()))
  with check (private.is_officer(auth.uid()));


-- ── Dependent functions repointed ───────────────────────────────────────────
-- Six functions call the predicates. Recreated from their live definitions with
-- the schema swapped, so nothing else about them changes.

CREATE OR REPLACE FUNCTION public.assert_email_change_allowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.email is distinct from old.email
     -- Officer remediation, when it happens through an authenticated session.
     and not (auth.uid() is not null and private.is_officer(auth.uid()))
     -- Deliberate console/migration override:
     --   set local app.allow_email_domain_change = 'on';
     and coalesce(
           nullif(current_setting('app.allow_email_domain_change', true), ''),
           'off'
         ) <> 'on'
  then
    perform public.assert_email_domain_allowed(new.email);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.evaluate_membership_requirements(p_member uuid, p_term uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller  uuid := auth.uid();
  v_enabled boolean;
  v_rules   jsonb;
  v_rule    jsonb;
  v_items   jsonb := '[]'::jsonb;
  v_current integer;
  v_target  integer;
  v_done    integer := 0;
  v_total   integer := 0;
begin
  -- SECURITY DEFINER with a member-id parameter: without this check, any
  -- signed-in member could read anyone else's membership progress.
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_member <> v_caller and not private.is_officer(v_caller) then
    raise exception 'Not authorised to read another member''s membership progress'
      using errcode = '42501';
  end if;

  select coalesce((s.value #>> '{}')::boolean, false)
    into v_enabled
    from public.app_settings s
   where s.key = 'membership_requirements_enabled';

  if not coalesce(v_enabled, false) then
    return null;
  end if;

  select coalesce(s.value, '[]'::jsonb)
    into v_rules
    from public.app_settings s
   where s.key = 'membership_requirements';

  if v_rules is null or jsonb_array_length(v_rules) = 0 then
    return null;
  end if;

  for v_rule in select * from jsonb_array_elements(v_rules)
  loop
    v_target  := greatest(coalesce((v_rule ->> 'target')::integer, 1), 1);
    v_current := 0;

    if (v_rule ->> 'type') = 'total_points' then
      select coalesce(sum(pt.amount), 0)::integer
        into v_current
        from public.point_transactions pt
       where pt.member_id = p_member
         and (p_term is null or pt.academic_term_id = p_term);

    elsif (v_rule ->> 'type') = 'category_events' then
      select count(*)::integer
        into v_current
        from public.event_attendance a
        join public.events e  on e.id = a.event_id
        join public.event_categories c on c.id = e.category_id
       where a.member_id = p_member
         and c.slug = (v_rule ->> 'category_slug')
         and (p_term is null or e.academic_term_id = p_term);

    elsif (v_rule ->> 'type') = 'total_events' then
      select count(*)::integer
        into v_current
        from public.event_attendance a
        join public.events e on e.id = a.event_id
       where a.member_id = p_member
         and (p_term is null or e.academic_term_id = p_term);
    end if;

    v_total := v_total + 1;
    if v_current >= v_target then
      v_done := v_done + 1;
    end if;

    v_items := v_items || jsonb_build_object(
      'id',       coalesce(v_rule ->> 'id', v_rule ->> 'label'),
      'label',    v_rule ->> 'label',
      'current',  v_current,
      'target',   v_target,
      'complete', v_current >= v_target
    );
  end loop;

  return jsonb_build_object(
    'enabled',   true,
    'completed', v_done,
    'total',     v_total,
    'items',     v_items
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_member_points_summary(p_member_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_academic_year text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_member uuid := coalesce(p_member_id, auth.uid());
  v_terms  uuid[] := public.term_ids_for_scope(p_term_id, p_academic_year);
  v_total  integer := 0;
  v_events integer := 0;
  v_cohort integer := 0;
  v_below  integer := 0;
  v_top    integer;
  v_cats   jsonb;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_member <> v_caller and not private.is_officer(v_caller) then
    raise exception 'Not authorised to read another member''s points'
      using errcode = '42501';
  end if;

  select coalesce(sum(pt.amount), 0)::integer
    into v_total
    from public.point_transactions pt
   where pt.member_id = v_member
     and (v_terms is null or pt.academic_term_id = any (v_terms));

  select count(*)::integer
    into v_events
    from public.event_attendance a
    join public.events e on e.id = a.event_id
   where a.member_id = v_member
     and (v_terms is null or e.academic_term_id = any (v_terms));

  -- "Active member" for ranking purposes: an active chapter membership *and*
  -- at least one point transaction in the period. Dormant accounts would
  -- otherwise inflate everyone's standing.
  with cohort as (
    select pt.member_id, sum(pt.amount)::integer as pts
      from public.point_transactions pt
      join public.profiles p on p.id = pt.member_id
     where p.membership_status = 'active'
       and (v_terms is null or pt.academic_term_id = any (v_terms))
     group by pt.member_id
  )
  select count(*)::integer,
         count(*) filter (where c.pts < v_total)::integer
    into v_cohort, v_below
    from cohort c;

  -- Below a handful of ranked members a percentile is noise, not information.
  if v_cohort >= 5 and v_total > 0 then
    v_top := greatest(1, 100 - floor((v_below::numeric / v_cohort) * 100)::integer);
  else
    v_top := null;
  end if;

  select coalesce(jsonb_agg(x order by x.points desc), '[]'::jsonb)
    into v_cats
    from (
      select coalesce(c.name, 'Adjustments')      as category,
             sum(pt.amount)::integer              as points,
             count(*) filter (where pt.event_id is not null)::integer as events
        from public.point_transactions pt
        left join public.events e            on e.id = pt.event_id
        left join public.event_categories c  on c.id = e.category_id
       where pt.member_id = v_member
         and (v_terms is null or pt.academic_term_id = any (v_terms))
       group by coalesce(c.name, 'Adjustments')
    ) x;

  return jsonb_build_object(
    'member_id',           v_member,
    'term_id',             p_term_id,
    'academic_year',       p_academic_year,
    'total_points',        v_total,
    'events_attended',     v_events,
    'top_percent',         v_top,
    'ranked_member_count', v_cohort,
    'by_category',         v_cats
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.profiles_guard_protected_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- No JWT means service_role or a direct migration/seed connection, which is
  -- trusted by definition. Members can never reach this branch: anon has no
  -- UPDATE policy on profiles at all.
  if auth.uid() is null then
    return new;
  end if;

  if private.is_officer(auth.uid()) then
    return new;
  end if;

  new.id                := old.id;
  new.email             := old.email;
  new.membership_status := old.membership_status;
  new.member_since      := old.member_since;
  new.created_at        := old.created_at;

  -- A member may say they hold a National membership; only an officer may
  -- confirm it. Self-service "verified" quietly degrades to "self_reported".
  if new.shpe_national_member = 'verified'
     and old.shpe_national_member is distinct from 'verified' then
    new.shpe_national_member := 'self_reported';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.require_admin()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if not private.is_admin(v_actor) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;
  return v_actor;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.require_officer()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if not private.is_officer(v_actor) then
    raise exception 'Officer role required' using errcode = '42501';
  end if;
  return v_actor;
end;
$function$
;



-- ── Remove the API-reachable copies ─────────────────────────────────────────
-- Not CASCADE: if anything still depends on these, this migration should fail
-- loudly rather than silently dropping a policy and opening a table up.

drop function if exists public.has_role(uuid, public.app_role);
drop function if exists public.is_officer(uuid);
drop function if exists public.is_admin(uuid);

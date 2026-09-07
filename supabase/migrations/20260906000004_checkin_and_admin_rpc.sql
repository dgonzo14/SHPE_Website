-- =============================================================================
-- 20260906000004_checkin_and_admin_rpc.sql
-- Trusted server-side operations.
--
-- Everything that changes a member's organisational standing lives here, behind
-- SECURITY DEFINER, because the client is not trusted to decide whether a code
-- is valid, whether a window is open, or who is an officer.
--
-- Check-in is the important one. Attendance and its point award are inserted in
-- a single function call, therefore a single transaction: it is not possible to
-- end up with attendance and no points, or points and no attendance.
-- =============================================================================


-- ── Safe subset of chapter configuration for signed-in clients ──────────────

create or replace function public.get_app_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
    from public.app_settings s
   where s.key in (
     'allowed_email_domains',
     'membership_requirements_enabled',
     'membership_requirements',
     'points_display_label'
   );
$$;

grant execute on function public.get_app_config() to authenticated, anon;


-- ── Membership requirement evaluation ───────────────────────────────────────
-- Requirements are data, not code. Each entry looks like:
--   { "id": "gbm", "label": "Attend 2 GBMs", "type": "category_events",
--     "category_slug": "general-body-meeting", "target": 2 }
--   { "id": "pts", "label": "Earn 30 points", "type": "total_points", "target": 30 }
--
-- The chapter has not defined official requirements yet, so the seeded config
-- ships DISABLED with an empty list. Turning it on is a configuration change,
-- not a deploy — and this function deliberately invents no policy of its own.

create or replace function public.evaluate_membership_requirements(
  p_member uuid,
  p_term   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  if p_member <> v_caller and not public.is_officer(v_caller) then
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
$$;

grant execute on function public.evaluate_membership_requirements(uuid, uuid) to authenticated;


-- ── Check-in: validation ────────────────────────────────────────────────────
-- Returns NULL when the check-in may proceed, otherwise a structured error.
--
-- The code is verified BEFORE the window is checked, on purpose. Someone
-- holding the right code at the wrong time gets a useful "check-in opens at
-- 6:45 PM"; someone guessing gets a flat INVALID_CODE that reveals nothing
-- about which events currently have live codes.

create or replace function public.checkin_validate(
  p_event_id uuid,
  p_code     text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event  public.events;
  v_secret public.event_checkin_secrets;
begin
  select * into v_event from public.events e where e.id = p_event_id;

  if not found or v_event.status = 'draft' then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND');
  end if;

  if v_event.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'EVENT_CANCELLED',
                              'event_title', v_event.title);
  end if;

  select * into v_secret
    from public.event_checkin_secrets s
   where s.event_id = p_event_id;

  if not found
     or v_secret.code_hash <> public.hash_checkin_code(v_secret.code_salt, p_code) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE');
  end if;

  -- Completed events are closed, not unpublished. Reported after the code
  -- check so a guess still gets a flat INVALID_CODE.
  if v_event.status = 'completed' then
    return jsonb_build_object('ok', false, 'code', 'CHECKIN_CLOSED',
                              'event_title', v_event.title,
                              'closed_at', v_event.check_in_closes_at);
  end if;

  if v_event.status <> 'published' then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_PUBLISHED',
                              'event_title', v_event.title);
  end if;

  if now() < v_event.check_in_opens_at then
    return jsonb_build_object('ok', false, 'code', 'CHECKIN_NOT_OPEN',
                              'event_title', v_event.title,
                              'opens_at', v_event.check_in_opens_at);
  end if;

  if now() > v_event.check_in_closes_at then
    return jsonb_build_object('ok', false, 'code', 'CHECKIN_CLOSED',
                              'event_title', v_event.title,
                              'closed_at', v_event.check_in_closes_at);
  end if;

  return null;
end;
$$;

revoke execute on function public.checkin_validate(uuid, text)
  from public, anon, authenticated;


-- ── Check-in: the transactional write ───────────────────────────────────────
-- Attendance first. If the UNIQUE(event_id, member_id) constraint rejects the
-- insert, ON CONFLICT DO NOTHING yields no row, we return ALREADY_CHECKED_IN,
-- and no point transaction is written. That is what makes a double-click,
-- a retried request, and two tabs racing each other all land on exactly one
-- award — the database decides, not the client.

create or replace function public.perform_check_in(
  p_member      uuid,
  p_event_id    uuid,
  p_method      public.checkin_method,
  p_verified_by uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event         public.events;
  v_attendance_id uuid;
  v_term          uuid;
  v_total         integer;
  v_checked_at    timestamptz;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND');
  end if;

  insert into public.event_attendance (event_id, member_id, check_in_method, verified_by)
  values (p_event_id, p_member, p_method, p_verified_by)
  on conflict (event_id, member_id) do nothing
  returning id, checked_in_at into v_attendance_id, v_checked_at;

  if v_attendance_id is null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CHECKED_IN',
                              'event_id', p_event_id,
                              'event_title', v_event.title);
  end if;

  v_term := coalesce(v_event.academic_term_id,
                     public.term_for_timestamp(v_event.start_at),
                     public.current_term_id());

  if v_event.points_value > 0 then
    insert into public.point_transactions (
      member_id, event_id, academic_term_id, amount,
      transaction_type, description, created_by
    )
    values (
      p_member, p_event_id, v_term, v_event.points_value,
      'event_attendance', v_event.title, coalesce(p_verified_by, p_member)
    );
  end if;

  select coalesce(sum(pt.amount), 0)::integer
    into v_total
    from public.point_transactions pt
   where pt.member_id = p_member
     and (v_term is null or pt.academic_term_id = v_term);

  return jsonb_build_object(
    'ok',             true,
    'event_id',       p_event_id,
    'event_title',    v_event.title,
    'event_slug',     v_event.slug,
    'attendance_id',  v_attendance_id,
    'checked_in_at',  v_checked_at,
    'points_awarded', v_event.points_value,
    'term_id',        v_term,
    'term_points',    v_total
  );
end;
$$;

revoke execute on function public.perform_check_in(uuid, uuid, public.checkin_method, uuid)
  from public, anon, authenticated;


-- ── Check-in: shared preconditions ──────────────────────────────────────────

create or replace function public.checkin_preflight(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status  public.membership_status;
  v_allowed text[];
  v_fails   integer;
begin
  if p_member is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;

  select p.membership_status into v_status
    from public.profiles p where p.id = p_member;

  if v_status is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;

  select array(select jsonb_array_elements_text(s.value))
    into v_allowed
    from public.app_settings s
   where s.key = 'checkin_allowed_statuses';

  if v_allowed is not null
     and cardinality(v_allowed) > 0
     and not (v_status::text = any (v_allowed)) then
    return jsonb_build_object('ok', false, 'code', 'MEMBER_NOT_ACTIVE',
                              'membership_status', v_status);
  end if;

  -- Durable brute-force throttle. Deliberately generous enough that a member
  -- fumbling a code at an event is never locked out, and tight enough that
  -- guessing one of ~320k codes is hopeless.
  select count(*)::integer into v_fails
    from public.checkin_attempts a
   where a.member_id = p_member
     and not a.succeeded
     and a.attempted_at > now() - interval '10 minutes';

  if v_fails >= 8 then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  return null;
end;
$$;

revoke execute on function public.checkin_preflight(uuid)
  from public, anon, authenticated;


-- ── Check-in: public entry points ───────────────────────────────────────────

create or replace function public.check_in_to_event(p_event_id uuid, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
  v_err    jsonb;
  v_result jsonb;
begin
  v_err := public.checkin_preflight(v_member);
  if v_err is not null then
    return v_err;
  end if;

  v_err := public.checkin_validate(p_event_id, p_code);
  if v_err is not null then
    insert into public.checkin_attempts (member_id, event_id, succeeded)
    values (v_member, p_event_id, false);
    return v_err;
  end if;

  v_result := public.perform_check_in(v_member, p_event_id, 'code', null);

  insert into public.checkin_attempts (member_id, event_id, succeeded)
  values (v_member, p_event_id, coalesce((v_result ->> 'ok')::boolean, false));

  return v_result;
end;
$$;

grant execute on function public.check_in_to_event(uuid, text) to authenticated;


-- Code-only check-in: the member types a code without picking an event first,
-- which is what actually happens in a room full of people.
--
-- Candidate events are hashed one at a time because every event has its own
-- salt. The candidate set is small (published events within a fortnight), and
-- currently-open events are tried first, so the common case is one comparison.

create or replace function public.check_in_with_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member   uuid := auth.uid();
  v_code     text := public.normalize_checkin_code(p_code);
  v_err      jsonb;
  v_rec      record;
  v_event_id uuid;
  v_result   jsonb;
begin
  v_err := public.checkin_preflight(v_member);
  if v_err is not null then
    return v_err;
  end if;

  if length(v_code) < 4 then
    insert into public.checkin_attempts (member_id, succeeded) values (v_member, false);
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE');
  end if;

  for v_rec in
    select e.id, s.code_salt, s.code_hash
      from public.events e
      join public.event_checkin_secrets s on s.event_id = e.id
     -- Anything but a draft is a candidate. Restricting this to 'published'
     -- meant a correct code for a cancelled event fell through to
     -- INVALID_CODE, which tells the member their code is wrong when it is
     -- not. checkin_validate below decides the real reason.
     where e.status <> 'draft'
       and e.start_at between now() - interval '14 days' and now() + interval '14 days'
     order by (now() between e.check_in_opens_at and e.check_in_closes_at) desc,
              abs(extract(epoch from (e.start_at - now())))
  loop
    if v_rec.code_hash = public.hash_checkin_code(v_rec.code_salt, v_code) then
      v_event_id := v_rec.id;
      exit;
    end if;
  end loop;

  if v_event_id is null then
    insert into public.checkin_attempts (member_id, succeeded) values (v_member, false);
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE');
  end if;

  -- Re-validate through the same path as the event-scoped RPC so that window
  -- and status rules are enforced in exactly one place.
  v_err := public.checkin_validate(v_event_id, v_code);
  if v_err is not null then
    insert into public.checkin_attempts (member_id, event_id, succeeded)
    values (v_member, v_event_id, false);
    return v_err;
  end if;

  v_result := public.perform_check_in(v_member, v_event_id, 'code', null);

  insert into public.checkin_attempts (member_id, event_id, succeeded)
  values (v_member, v_event_id, coalesce((v_result ->> 'ok')::boolean, false));

  return v_result;
end;
$$;

grant execute on function public.check_in_with_code(text) to authenticated;


-- ── Member statistics ───────────────────────────────────────────────────────
-- Percentile is computed here, in SQL, and only the requesting member's own
-- standing comes back. Shipping every member's total to the browser so it could
-- compute a rank would be both slow and a privacy leak.

create or replace function public.get_member_points_summary(
  p_member_id     uuid default null,
  p_term_id       uuid default null,
  p_academic_year text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  if v_member <> v_caller and not public.is_officer(v_caller) then
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
$$;

grant execute on function public.get_member_points_summary(uuid, uuid, text) to authenticated;


-- ── Member dashboard ────────────────────────────────────────────────────────
-- One round trip instead of eight. Everything the dashboard renders, resolved
-- server-side against the caller's own identity.

create or replace function public.get_member_dashboard(p_term_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member  uuid := auth.uid();
  v_term    uuid;
  v_term_row public.academic_terms;
  v_profile jsonb;
  v_next    jsonb;
  v_recent  jsonb;
  v_ann     jsonb;
  v_roles   text[];
begin
  if v_member is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_term := coalesce(p_term_id, public.current_term_id());
  select * into v_term_row from public.academic_terms t where t.id = v_term;

  select jsonb_build_object(
           'id', p.id,
           'first_name', p.first_name,
           'last_name', p.last_name,
           'email', p.email,
           'membership_status', p.membership_status,
           'member_since', p.member_since
         )
    into v_profile
    from public.profiles p
   where p.id = v_member;

  select array(select r.role::text from public.member_roles r where r.member_id = v_member)
    into v_roles;

  -- Next thing to show up to: the soonest event that has not finished yet.
  select jsonb_build_object(
           'id', e.id,
           'title', e.title,
           'slug', e.slug,
           'start_at', e.start_at,
           'end_at', e.end_at,
           'location', e.location,
           'points_value', e.points_value,
           'status', e.status,
           'check_in_opens_at', e.check_in_opens_at,
           'check_in_closes_at', e.check_in_closes_at,
           'category', c.name,
           'attended', exists (
             select 1 from public.event_attendance a
              where a.event_id = e.id and a.member_id = v_member
           )
         )
    into v_next
    from public.events e
    left join public.event_categories c on c.id = e.category_id
   where e.status = 'published'
     and e.end_at >= now()
   order by e.start_at
   limit 1;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
    into v_recent
    from (
      select pt.id,
             pt.amount,
             pt.transaction_type,
             coalesce(e.title, pt.description, 'Adjustment') as title,
             c.name as category,
             pt.created_at
        from public.point_transactions pt
        left join public.events e           on e.id = pt.event_id
        left join public.event_categories c on c.id = e.category_id
       where pt.member_id = v_member
       order by pt.created_at desc
       limit 5
    ) x;

  select coalesce(jsonb_agg(x order by
            case x.priority when 'urgent' then 0 when 'important' then 1 else 2 end,
            x.published_at desc), '[]'::jsonb)
    into v_ann
    from (
      select a.id, a.title, a.body, a.priority, a.published_at, a.external_url
        from public.announcements a
       where not a.is_archived
         and a.published_at is not null
         and a.published_at <= now()
         and (a.expires_at is null or a.expires_at > now())
       order by a.published_at desc
       limit 3
    ) x;

  return jsonb_build_object(
    'profile',       v_profile,
    'roles',         to_jsonb(coalesce(v_roles, array[]::text[])),
    'term',          case when v_term_row.id is null then null else jsonb_build_object(
                       'id', v_term_row.id,
                       'name', v_term_row.name,
                       'start_date', v_term_row.start_date,
                       'end_date', v_term_row.end_date
                     ) end,
    'points',        public.get_member_points_summary(v_member, v_term, null),
    'next_event',    v_next,
    'recent_points', v_recent,
    'announcements', v_ann,
    'membership',    public.evaluate_membership_requirements(v_member, v_term)
  );
end;
$$;

grant execute on function public.get_member_dashboard(uuid) to authenticated;

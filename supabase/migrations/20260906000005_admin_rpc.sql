-- =============================================================================
-- 20260906000005_admin_rpc.sql
-- Privileged officer/admin operations.
--
-- Each function re-checks the caller's role from member_roles. None of them
-- trust a claim from the client, and none of them are reachable just because a
-- menu item was rendered.
--
-- Historical rows are never edited or deleted to fix a mistake; a compensating
-- entry is written instead, so "who changed this, when, and why" stays
-- answerable months later.
-- =============================================================================


create or replace function public.require_officer()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_officer(v_actor) then
    raise exception 'Officer role required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_admin(v_actor) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke execute on function public.require_officer() from public, anon, authenticated;
revoke execute on function public.require_admin()   from public, anon, authenticated;


-- ── Check-in codes ──────────────────────────────────────────────────────────
-- Returns the plaintext exactly once, to the officer who asked for it. Nothing
-- afterwards can read it back: only the salted hash is stored, and the audit
-- entry deliberately records that a rotation happened, not what the code is.

create or replace function public.admin_rotate_event_code(p_event_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := public.require_officer();
  v_event      public.events;
  v_code       text;
  v_salt       text;
  v_collision  boolean := true;
  v_had_secret boolean;
  v_attempt    integer;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  -- Two events accepting check-ins at the same time must not share a code,
  -- otherwise a member could be checked into the wrong one.
  for v_attempt in 1..25 loop
    v_code := public.generate_checkin_code();

    select exists (
      select 1
        from public.events e2
        join public.event_checkin_secrets s2 on s2.event_id = e2.id
       where e2.id <> p_event_id
         and e2.status in ('draft', 'published')
         and e2.check_in_opens_at  <= v_event.check_in_closes_at
         and e2.check_in_closes_at >= v_event.check_in_opens_at
         and s2.code_hash = public.hash_checkin_code(s2.code_salt, v_code)
    ) into v_collision;

    exit when not v_collision;
  end loop;

  if v_collision then
    raise exception 'Could not generate a unique check-in code, please try again'
      using errcode = '55000';
  end if;

  select exists (select 1 from public.event_checkin_secrets s where s.event_id = p_event_id)
    into v_had_secret;

  v_salt := replace(gen_random_uuid()::text, '-', '');

  insert into public.event_checkin_secrets (event_id, code_salt, code_hash, rotated_by)
  values (p_event_id, v_salt, public.hash_checkin_code(v_salt, v_code), v_actor)
  on conflict (event_id) do update
     set code_salt  = excluded.code_salt,
         code_hash  = excluded.code_hash,
         rotated_by = excluded.rotated_by,
         updated_at = now();

  perform public.write_audit_log(
    v_actor,
    case when v_had_secret then 'event.code_rotated' else 'event.code_generated' end,
    'event', p_event_id,
    jsonb_build_object('title', v_event.title, 'invalidated_previous_code', v_had_secret)
  );

  return jsonb_build_object('ok', true, 'event_id', p_event_id, 'code', v_code);
end;
$$;

grant execute on function public.admin_rotate_event_code(uuid) to authenticated;


-- Does this event have a live code? Officers need to know without ever seeing
-- the code itself.
create or replace function public.admin_event_code_status(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret public.event_checkin_secrets;
begin
  perform public.require_officer();
  select * into v_secret from public.event_checkin_secrets s where s.event_id = p_event_id;
  return jsonb_build_object(
    'has_code',   found,
    'updated_at', v_secret.updated_at,
    'rotated_by', v_secret.rotated_by
  );
end;
$$;

grant execute on function public.admin_event_code_status(uuid) to authenticated;


-- ── Attendance management ───────────────────────────────────────────────────

create or replace function public.admin_add_attendance(
  p_event_id  uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.require_officer();
  v_result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = p_member_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  -- Same transactional path as a member check-in, so a manual entry earns
  -- points identically and cannot drift from the automatic behaviour.
  v_result := public.perform_check_in(p_member_id, p_event_id, 'manual', v_actor);

  if coalesce((v_result ->> 'ok')::boolean, false) then
    perform public.write_audit_log(
      v_actor, 'attendance.added', 'event', p_event_id,
      jsonb_build_object(
        'member_id', p_member_id,
        'event_title', v_result ->> 'event_title',
        'points_awarded', (v_result ->> 'points_awarded')::integer
      )
    );
  end if;

  return v_result;
end;
$$;

grant execute on function public.admin_add_attendance(uuid, uuid) to authenticated;


-- Removing attendance also reconciles points. The original award row stays in
-- the ledger; a compensating 'correction' row cancels it out. Deleting the
-- award instead would leave no trace that it ever happened.

create or replace function public.admin_remove_attendance(
  p_attendance_id uuid,
  p_reason        text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := public.require_officer();
  v_att        public.event_attendance;
  v_event      public.events;
  v_net        integer;
  v_term       uuid;
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'A reason is required to remove attendance'
      using errcode = '22023';
  end if;

  select * into v_att from public.event_attendance a where a.id = p_attendance_id;
  if not found then
    raise exception 'Attendance record not found' using errcode = 'P0002';
  end if;

  select * into v_event from public.events e where e.id = v_att.event_id;

  select coalesce(sum(pt.amount), 0)::integer
    into v_net
    from public.point_transactions pt
   where pt.member_id = v_att.member_id
     and pt.event_id  = v_att.event_id;

  delete from public.event_attendance a where a.id = p_attendance_id;

  if v_net <> 0 then
    v_term := coalesce(v_event.academic_term_id, public.current_term_id());
    insert into public.point_transactions (
      member_id, event_id, academic_term_id, amount,
      transaction_type, description, created_by
    )
    values (
      v_att.member_id, v_att.event_id, v_term, -v_net,
      'correction',
      format('Attendance removed: %s', v_reason),
      v_actor
    );
  end if;

  perform public.write_audit_log(
    v_actor, 'attendance.removed', 'event', v_att.event_id,
    jsonb_build_object(
      'member_id', v_att.member_id,
      'event_title', v_event.title,
      'reversed_points', v_net,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'event_id', v_att.event_id,
    'member_id', v_att.member_id,
    'reversed_points', v_net
  );
end;
$$;

grant execute on function public.admin_remove_attendance(uuid, text) to authenticated;


-- ── Manual point adjustments ────────────────────────────────────────────────

create or replace function public.admin_adjust_points(
  p_member_id uuid,
  p_amount    integer,
  p_reason    text,
  p_term_id   uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.require_officer();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_term   uuid := coalesce(p_term_id, public.current_term_id());
  v_before integer;
  v_after  integer;
  v_id     uuid;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'Adjustment amount must be a non-zero whole number'
      using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required for a point adjustment'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_member_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(pt.amount), 0)::integer into v_before
    from public.point_transactions pt
   where pt.member_id = p_member_id
     and (v_term is null or pt.academic_term_id = v_term);

  insert into public.point_transactions (
    member_id, event_id, academic_term_id, amount,
    transaction_type, description, created_by
  )
  values (p_member_id, null, v_term, p_amount, 'manual_adjustment', v_reason, v_actor)
  returning id into v_id;

  v_after := v_before + p_amount;

  perform public.write_audit_log(
    v_actor, 'points.adjusted', 'member', p_member_id,
    jsonb_build_object(
      'transaction_id', v_id,
      'previousAmount', v_before,
      'adjustment', p_amount,
      'newAmount', v_after,
      'reason', v_reason,
      'term_id', v_term
    )
  );

  return jsonb_build_object('ok', true, 'transaction_id', v_id,
                            'previous_total', v_before, 'new_total', v_after);
end;
$$;

grant execute on function public.admin_adjust_points(uuid, integer, text, uuid) to authenticated;


-- ── Role management ─────────────────────────────────────────────────────────
-- Admin-only, and an admin cannot revoke their own admin role — locking the
-- chapter out of its own portal is not a recoverable mistake from the UI.

create or replace function public.admin_set_role(
  p_member_id uuid,
  p_role      public.app_role,
  p_granted   boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_admin();
begin
  if not exists (select 1 from public.profiles p where p.id = p_member_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if p_role = 'member' and not p_granted then
    raise exception 'The member role cannot be removed' using errcode = '22023';
  end if;

  if p_role = 'admin' and not p_granted and p_member_id = v_actor then
    raise exception 'You cannot remove your own administrator role'
      using errcode = '22023';
  end if;

  if p_granted then
    insert into public.member_roles (member_id, role, granted_by)
    values (p_member_id, p_role, v_actor)
    on conflict (member_id, role) do nothing;
  else
    delete from public.member_roles r
     where r.member_id = p_member_id and r.role = p_role;
  end if;

  perform public.write_audit_log(
    v_actor,
    case when p_granted then 'role.granted' else 'role.revoked' end,
    'member', p_member_id,
    jsonb_build_object('role', p_role)
  );

  return jsonb_build_object('ok', true, 'member_id', p_member_id,
                            'role', p_role, 'granted', p_granted);
end;
$$;

grant execute on function public.admin_set_role(uuid, public.app_role, boolean) to authenticated;


-- ── Membership status ───────────────────────────────────────────────────────
-- Deactivation preserves every attendance and ledger row; it only changes what
-- the member may do next.

create or replace function public.admin_set_membership_status(
  p_member_id uuid,
  p_status    public.membership_status,
  p_reason    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.require_officer();
  v_before public.membership_status;
begin
  select p.membership_status into v_before
    from public.profiles p where p.id = p_member_id;

  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  update public.profiles p
     set membership_status = p_status
   where p.id = p_member_id;

  perform public.write_audit_log(
    v_actor, 'membership.status_changed', 'member', p_member_id,
    jsonb_build_object('from', v_before, 'to', p_status,
                       'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('ok', true, 'member_id', p_member_id, 'status', p_status);
end;
$$;

grant execute on function public.admin_set_membership_status(uuid, public.membership_status, text)
  to authenticated;


-- National SHPE membership is verified by a human against the National roster.
-- There is no automated integration, so nothing here ever sets 'verified' by
-- itself.
create or replace function public.admin_set_national_status(
  p_member_id uuid,
  p_status    public.national_member_status
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.require_officer();
  v_before public.national_member_status;
begin
  select p.shpe_national_member into v_before
    from public.profiles p where p.id = p_member_id;

  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  update public.profiles p
     set shpe_national_member = p_status
   where p.id = p_member_id;

  perform public.write_audit_log(
    v_actor, 'membership.national_status_changed', 'member', p_member_id,
    jsonb_build_object('from', v_before, 'to', p_status)
  );

  return jsonb_build_object('ok', true, 'member_id', p_member_id, 'status', p_status);
end;
$$;

grant execute on function public.admin_set_national_status(uuid, public.national_member_status)
  to authenticated;


-- ── Chapter configuration ───────────────────────────────────────────────────

create or replace function public.admin_set_app_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_admin();
  v_before jsonb;
begin
  select s.value into v_before from public.app_settings s where s.key = p_key;

  insert into public.app_settings (key, value, updated_by)
  values (p_key, p_value, v_actor)
  on conflict (key) do update
     set value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = now();

  perform public.write_audit_log(
    v_actor, 'settings.changed', 'setting', null,
    jsonb_build_object('key', p_key, 'from', v_before, 'to', p_value)
  );

  return jsonb_build_object('ok', true, 'key', p_key);
end;
$$;

grant execute on function public.admin_set_app_setting(text, jsonb) to authenticated;


-- ── Analytics ───────────────────────────────────────────────────────────────
-- Aggregated in SQL. Downloading the attendance table to the browser to count
-- rows would be slow and would hand every officer's laptop the full ledger.

create or replace function public.admin_analytics(p_term_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term            uuid;
  v_total_members   integer;
  v_active_members  integer;
  v_events_total    integer;
  v_events_upcoming integer;
  v_attendance      integer;
  v_points          integer;
  v_avg             numeric;
  v_top             jsonb;
  v_low             jsonb;
  v_by_category     jsonb;
  v_buckets         jsonb;
begin
  perform public.require_officer();
  v_term := coalesce(p_term_id, public.current_term_id());

  select count(*)::integer,
         count(*) filter (where p.membership_status = 'active')::integer
    into v_total_members, v_active_members
    from public.profiles p;

  select count(*)::integer,
         count(*) filter (where e.start_at > now() and e.status = 'published')::integer
    into v_events_total, v_events_upcoming
    from public.events e
   where e.status <> 'draft'
     and (v_term is null or e.academic_term_id = v_term);

  select count(*)::integer
    into v_attendance
    from public.event_attendance a
    join public.events e on e.id = a.event_id
   where v_term is null or e.academic_term_id = v_term;

  select coalesce(sum(pt.amount), 0)::integer
    into v_points
    from public.point_transactions pt
   where v_term is null or pt.academic_term_id = v_term;

  select case when count(*) = 0 then 0
              else round(avg(cnt), 1) end
    into v_avg
    from (
      select count(a.id) as cnt
        from public.events e
        left join public.event_attendance a on a.event_id = e.id
       where e.status in ('published', 'completed')
         and e.start_at <= now()
         and (v_term is null or e.academic_term_id = v_term)
       group by e.id
    ) s;

  with event_counts as (
    select e.id, e.title, e.start_at, c.name as category,
           count(a.id)::integer as attendee_count
      from public.events e
      left join public.event_attendance a  on a.event_id = e.id
      left join public.event_categories c  on c.id = e.category_id
     where e.status in ('published', 'completed')
       and e.start_at <= now()
       and (v_term is null or e.academic_term_id = v_term)
     group by e.id, e.title, e.start_at, c.name
  )
  select
    coalesce((select jsonb_agg(to_jsonb(t)) from (
       select * from event_counts order by attendee_count desc, start_at desc limit 5
     ) t), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(t)) from (
       select * from event_counts order by attendee_count asc, start_at desc limit 5
     ) t), '[]'::jsonb)
    into v_top, v_low;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.attendee_count desc), '[]'::jsonb)
    into v_by_category
    from (
      select coalesce(c.name, 'Uncategorised') as category,
             count(a.id)::integer             as attendee_count,
             count(distinct e.id)::integer    as event_count
        from public.events e
        left join public.event_attendance a  on a.event_id = e.id
        left join public.event_categories c  on c.id = e.category_id
       where e.status in ('published', 'completed')
         and (v_term is null or e.academic_term_id = v_term)
       group by coalesce(c.name, 'Uncategorised')
    ) t;

  -- Coarse buckets rather than a per-member ranking: officers need the shape of
  -- engagement, not a leaderboard.
  select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]'::jsonb)
    into v_buckets
    from (
      select b.label, b.sort, count(x.member_id)::integer as member_count
        from (values ('1-10', 1, 1, 10),
                     ('11-25', 2, 11, 25),
                     ('26-50', 3, 26, 50),
                     ('51-100', 4, 51, 100),
                     ('100+', 5, 101, 1000000)) as b(label, sort, lo, hi)
        left join (
          select pt.member_id, sum(pt.amount)::integer as pts
            from public.point_transactions pt
           where v_term is null or pt.academic_term_id = v_term
           group by pt.member_id
        ) x on x.pts between b.lo and b.hi
       group by b.label, b.sort
    ) t;

  return jsonb_build_object(
    'term_id',             v_term,
    'total_members',       v_total_members,
    'active_members',      v_active_members,
    'events_total',        v_events_total,
    'events_upcoming',     v_events_upcoming,
    'attendance_total',    v_attendance,
    'points_awarded',      v_points,
    'avg_attendance',      v_avg,
    'most_attended',       v_top,
    'least_attended',      v_low,
    'attendance_by_category', v_by_category,
    'engagement_buckets',  v_buckets
  );
end;
$$;

grant execute on function public.admin_analytics(uuid) to authenticated;

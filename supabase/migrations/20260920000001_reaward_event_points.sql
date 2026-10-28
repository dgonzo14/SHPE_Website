-- =============================================================================
-- Changing an event's points changes what its attendees earned
--
-- perform_check_in() copies the event's points_value into the ledger at the
-- moment someone checks in. Until now, editing points_value afterwards changed
-- only the number shown on the event: everyone already checked in kept the old
-- award, and the only trace was an event.points_changed row in the audit log.
-- An officer who noticed mid-event that a meeting had been created with 0
-- points, fixed it, and saw "50" on the event had every reason to think the
-- room had been paid -- and the room had every reason to think My SHPE was
-- wrong.
--
-- Now an UPDATE that changes points_value brings every attendee's net for that
-- event to the new value:
--
--   * The ledger stays append-only. Each attendee whose net differs gets one
--     'correction' row for the difference, on the event, in the event's term,
--     created by the officer who made the edit, so their Points page shows the
--     event and why it moved. Nothing is edited or deleted.
--   * "Net for that event" is every ledger row on (member, event), not just
--     the original award. An attendee removed and re-added, or one whose award
--     an earlier change already corrected, ends at exactly the new value rather
--     than having the old-to-new difference applied on top of whatever drift
--     there was.
--   * Only people on the roster are touched. Someone whose attendance was
--     removed already had their award reversed by admin_remove_attendance(),
--     and stays at zero.
--   * One event.points_reawarded audit row says how many members moved and the
--     net change, next to the event.points_changed row events_audit() already
--     writes. A change on an event nobody has attended writes no extra row.
--
-- It is a trigger rather than an RPC because officers edit events with an
-- ordinary RLS-guarded UPDATE (the event form, the status buttons), the same
-- reason events_audit() is a trigger: there is no other path to cover.
--
-- Also here:
--
--   * perform_check_in() now reads the event FOR SHARE. Without it, a check-in
--     that read the old points_value could commit just after the trigger had
--     looked at the roster, and that member would keep the old award -- the
--     exact case of an officer fixing points while the room is checking in.
--     With it, the edit waits for in-flight check-ins and then corrects them,
--     and a check-in that starts during the edit waits and awards the new
--     value. Share locks don't conflict with each other, so check-ins still
--     run side by side.
--   * get_member_points_summary() counted ledger rows as "events" in the
--     category breakdown, so an award plus its correction read as two events,
--     and a removed attendance still counted as one. It now counts the events
--     the member is on the roster for.
-- =============================================================================


-- ── 1. Re-award on a points change ──────────────────────────────────────────

create or replace function private.reaward_event_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Where perform_check_in() puts the award, so the correction lands in the
  -- same term total.
  v_term    uuid := coalesce(new.academic_term_id,
                             public.term_for_timestamp(new.start_at),
                             public.current_term_id());
  v_actor   uuid := auth.uid();
  v_members integer;
  v_net     integer;
begin
  with owed as (
    select a.member_id,
           new.points_value - coalesce((
             select sum(pt.amount)
               from public.point_transactions pt
              where pt.member_id = a.member_id
                and pt.event_id  = a.event_id
           ), 0)::integer as delta
      from public.event_attendance a
     where a.event_id = new.id
  ),
  written as (
    insert into public.point_transactions (
      member_id, event_id, academic_term_id, amount,
      transaction_type, description, created_by
    )
    select o.member_id, new.id, v_term, o.delta,
           'correction',
           format('Event points changed from %s to %s', old.points_value, new.points_value),
           v_actor
      from owed o
     where o.delta <> 0
    returning amount
  )
  select count(*)::integer, coalesce(sum(w.amount), 0)::integer
    into v_members, v_net
    from written w;

  if v_members > 0 then
    perform public.write_audit_log(
      v_actor, 'event.points_reawarded', 'event', new.id,
      jsonb_build_object(
        'title',      new.title,
        'from',       old.points_value,
        'to',         new.points_value,
        'members',    v_members,
        'net_change', v_net
      )
    );
  end if;

  return null;
end;
$$;

revoke execute on function private.reaward_event_points()
  from public, anon, authenticated;

drop trigger if exists events_reaward_points_trg on public.events;
create trigger events_reaward_points_trg
  after update of points_value on public.events
  for each row
  when (old.points_value is distinct from new.points_value)
  execute function private.reaward_event_points();


-- ── 2. Check-in holds the event steady while it awards ──────────────────────
--
-- Unchanged from 20260906000004 apart from FOR SHARE on the event read; see
-- the header for why.

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
  select * into v_event from public.events e where e.id = p_event_id for share;
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


-- ── 3. Category breakdown counts events, not ledger rows ────────────────────
--
-- Unchanged from 20260909000001 apart from the `events` column of by_category.

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

  -- An event's award and any corrections to it are several ledger rows but one
  -- event, and an event whose attendance was removed isn't one they attended.
  select coalesce(jsonb_agg(x order by x.points desc), '[]'::jsonb)
    into v_cats
    from (
      select coalesce(c.name, 'Adjustments')      as category,
             sum(pt.amount)::integer              as points,
             count(distinct a.event_id)::integer  as events
        from public.point_transactions pt
        left join public.events e            on e.id = pt.event_id
        left join public.event_categories c  on c.id = e.category_id
        left join public.event_attendance a  on a.event_id  = pt.event_id
                                            and a.member_id = pt.member_id
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

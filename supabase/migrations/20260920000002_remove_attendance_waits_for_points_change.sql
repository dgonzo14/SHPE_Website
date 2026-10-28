-- =============================================================================
-- Removing attendance waits for a points change, and happens once
--
-- admin_remove_attendance() reverses everything the member has on the event:
-- it sums their ledger rows for it, deletes the attendance and posts the
-- negative of that sum. Since 20260920000001, changing an event's points also
-- posts to everyone on the roster, and the two could interleave:
--
--   * Points change first. Saving 0 -> 50 posts +50 to Ana but hasn't
--     committed when an officer removes her. The removal can't see the +50,
--     so it reverses 0, and once the change commits Ana has 50 points from
--     an event she isn't on the roster for.
--   * Removal first. The removal has deleted Ana's attendance but hasn't
--     committed when the points change runs. The change still sees her on the
--     roster and posts +50, and once the removal commits she keeps it.
--
-- Now the removal reads the event FOR SHARE, as perform_check_in() does. That
-- conflicts with the lock an UPDATE of the event takes, so a removal waits for
-- a points change in progress and then reverses what it posted, and a points
-- change waits for a removal in progress and then no longer finds them on the
-- roster. Removals don't wait for each other or for check-ins: share locks
-- don't conflict.
--
-- The same function could also reverse twice. Two officers removing the same
-- check-in at once both summed the ledger before either deleted, so both
-- posted the reversal and the member ended at minus the award. The delete now
-- says whether it removed the row, and the one that finds it already gone
-- stops with "Attendance record not found", as a second removal made later
-- always has. The sum is read after the delete, so it includes anything that
-- committed while the removal waited.
--
-- Otherwise unchanged from 20260906000005.
-- =============================================================================

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

  -- Waits for a points change on this event to commit; holds one off until
  -- this removal does. See the header.
  select * into v_event from public.events e where e.id = v_att.event_id for share;

  delete from public.event_attendance a where a.id = p_attendance_id;
  if not found then
    raise exception 'Attendance record not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(pt.amount), 0)::integer
    into v_net
    from public.point_transactions pt
   where pt.member_id = v_att.member_id
     and pt.event_id  = v_att.event_id;

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

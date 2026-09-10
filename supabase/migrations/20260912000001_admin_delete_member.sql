-- =============================================================================
-- Deleting a member
--
-- Until now the only way to get rid of an account was to mark it inactive, and
-- that is the right answer for someone who has left the chapter -- their
-- attendance and points should survive them. It is the wrong answer for the
-- accounts this exists for: duplicates, typos, and the junk signups that became
-- possible the moment email confirmation was turned off. Marking those inactive
-- leaves them in the roster forever.
--
-- This is a hard delete and it is not recoverable. profiles.id references
-- auth.users on delete cascade, and event_attendance, point_transactions,
-- member_roles, notification_preferences, checkin_attempts and
-- join_code_attempts all cascade from profiles.
--
-- Which creates a conflict worth being explicit about. "GBM #1 had 47 people"
-- should stay 47 forever, but deleting an attendee silently rewrites it to 46
-- and nothing in the app will ever say it changed. Hard deletion cannot both
-- preserve history and remove a person; the usual way out is to anonymise
-- rather than delete, and that is not available here, because profiles.id IS
-- the foreign key to auth.users -- a profile cannot outlive its account without
-- a schema change.
--
-- So the compromise is: refuse by default, and require the caller to say
-- "anyway". An account with no history -- which is every account this feature
-- was built for -- deletes without ceremony. An account with attendance or a
-- point ledger stops and reports what deleting it would cost, and only proceeds
-- when p_force is passed. When it does proceed, the individual rows are copied
-- into the audit log first, so a deletion made in error can be reconstructed
-- rather than merely regretted.
-- =============================================================================

-- The signature gained p_force. `create or replace` with a different argument
-- list creates an overload rather than replacing, which would leave the old
-- two-argument version callable and unguarded.
drop function if exists public.admin_delete_member(uuid, text);

create or replace function public.admin_delete_member(
  p_member_id uuid,
  p_reason    text default null,
  p_force     boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- First statement, before any work. A guard that runs after the delete is
  -- decoration. require_admin(), not require_officer(): officers run the
  -- chapter day to day, and this is the one action with no undo.
  v_actor       uuid := public.require_admin();
  v_profile     public.profiles;
  v_admins      integer;
  v_attendance  integer;
  v_txns        integer;
  v_net_points  integer;
  v_roles       text[];
  v_att_detail  jsonb;
  v_txn_detail  jsonb;
begin
  select * into v_profile from public.profiles p where p.id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if p_member_id = v_actor then
    raise exception 'You cannot delete your own account' using errcode = '22023';
  end if;

  /*
   * Keeps the chapter from ending up with no administrator, which it could not
   * recover from without a manual visit to the database. admin_set_role()
   * refuses to let an admin revoke their own admin role for the same reason.
   *
   * Unreachable as written, and deliberately kept anyway. The caller is always
   * an admin, so the admin count is at least one; for the target to be the only
   * admin they would have to be the caller, and the self-deletion check above
   * has already refused that. It stays because the invariant it protects is not
   * the caller's identity but "at least one admin exists" -- if the check above
   * is ever relaxed, or a future path deletes members without going through it,
   * this is what still holds the line. There is no test asserting it fires,
   * because nothing can currently make it fire.
   */
  if private.is_admin(p_member_id) then
    select count(distinct r.member_id)::integer into v_admins
      from public.member_roles r where r.role = 'admin';

    if v_admins <= 1 then
      raise exception
        'This is the only administrator. Grant admin to someone else first.'
        using errcode = '22023';
    end if;
  end if;

  -- Measured before the delete, because these rows are about to stop existing
  -- and the audit entry is the only record that will remain of them.
  select count(*)::integer into v_attendance
    from public.event_attendance a where a.member_id = p_member_id;

  select count(*)::integer, coalesce(sum(t.amount), 0)::integer
    into v_txns, v_net_points
    from public.point_transactions t where t.member_id = p_member_id;

  /*
   * The refusal, and the reason this function is worth having rather than a
   * plain DELETE.
   *
   * Returned rather than raised: a member having history is an ordinary answer
   * the screen is expected to handle and offer to override, not a failure. The
   * raises above are different -- an officer calling this, or a member id that
   * does not exist, are bugs or attacks, and neither has a sensible next step
   * in the UI.
   */
  if not p_force and (v_attendance > 0 or v_txns > 0) then
    return jsonb_build_object(
      'ok', false,
      'code', 'HAS_HISTORY',
      'member_id', p_member_id,
      'email', v_profile.email,
      'attendance', v_attendance,
      'point_transactions', v_txns,
      'net_points', v_net_points
    );
  end if;

  select coalesce(array_agg(r.role::text order by r.role), '{}')
    into v_roles
    from public.member_roles r where r.member_id = p_member_id;

  /*
   * Row-level snapshots, not just counts, so a deletion made in error can be
   * put back. Capped at 500 each: a member cannot realistically attend more
   * events than the chapter holds, but an unbounded array in a jsonb column is
   * the kind of thing that is fine until it is not.
   */
  select coalesce(jsonb_agg(x order by x->>'checked_in_at'), '[]'::jsonb)
    into v_att_detail
    from (
      select jsonb_build_object(
               'event_id', a.event_id,
               'event_title', e.title,
               'checked_in_at', a.checked_in_at,
               'method', a.check_in_method
             ) as x
        from public.event_attendance a
        join public.events e on e.id = a.event_id
       where a.member_id = p_member_id
       limit 500
    ) s;

  select coalesce(jsonb_agg(y order by y->>'created_at'), '[]'::jsonb)
    into v_txn_detail
    from (
      select jsonb_build_object(
               'amount', t.amount,
               'type', t.transaction_type,
               'description', t.description,
               'event_id', t.event_id,
               'created_at', t.created_at
             ) as y
        from public.point_transactions t
       where t.member_id = p_member_id
       limit 500
    ) s;

  /*
   * Written before the delete for two reasons: the rows above are still there
   * to be copied, and admin_audit_log.actor_id is ON DELETE SET NULL -- which
   * does not matter for the actor (an admin, who survives) but does mean the
   * entry has to stand on its own. entity_id carries no foreign key, so the
   * deleted member's id survives in the log as a plain value.
   */
  perform public.write_audit_log(
    v_actor, 'member.deleted', 'member', p_member_id,
    jsonb_build_object(
      'email', v_profile.email,
      'name', btrim(v_profile.first_name || ' ' || v_profile.last_name),
      'membership_status', v_profile.membership_status,
      'graduation_year', v_profile.graduation_year,
      'major', v_profile.major,
      'roles', to_jsonb(v_roles),
      'forced', p_force,
      'attendance_destroyed', v_attendance,
      'point_transactions_destroyed', v_txns,
      'net_points_destroyed', v_net_points,
      'attendance_detail', v_att_detail,
      'point_transaction_detail', v_txn_detail,
      'reason', p_reason
    )
  );

  -- The auth user, not the profile. Deleting the profile alone would leave a
  -- working session attached to an account the app cannot describe, and
  -- loadProfile() would retry four times and then give up on every page load.
  delete from auth.users u where u.id = p_member_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'DELETED',
    'member_id', p_member_id,
    'email', v_profile.email,
    'attendance_removed', v_attendance,
    'point_transactions_removed', v_txns,
    'net_points_removed', v_net_points
  );
end;
$$;

comment on function public.admin_delete_member(uuid, text, boolean) is
  'Permanently removes a member and everything cascading from their profile. '
  'Admin only. Refuses self-deletion, refuses to remove the last admin, and '
  'refuses a member with attendance or point history unless p_force is true -- '
  'in which case the individual rows are copied into the audit log first.';

revoke execute on function public.admin_delete_member(uuid, text, boolean)
  from public, anon;
grant execute on function public.admin_delete_member(uuid, text, boolean)
  to authenticated;

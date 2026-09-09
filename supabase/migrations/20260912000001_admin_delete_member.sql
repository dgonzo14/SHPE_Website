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
-- join_code_attempts all cascade from profiles. So removing a member who has
-- attended events retroactively lowers those events' attendance counts and
-- removes their point ledger. That is a real consequence, not a footnote, which
-- is why the counts are measured before the delete and written to the audit log
-- -- afterwards there is nothing left to count.
-- =============================================================================

create or replace function public.admin_delete_member(
  p_member_id uuid,
  p_reason    text default null
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
  v_actor      uuid := public.require_admin();
  v_profile    public.profiles;
  v_admins     integer;
  v_attendance integer;
  v_txns       integer;
  v_net_points integer;
  v_roles      text[];
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

  select coalesce(array_agg(r.role::text order by r.role), '{}')
    into v_roles
    from public.member_roles r where r.member_id = p_member_id;

  /*
   * Written before the delete for two reasons: the counts above are still true
   * here, and admin_audit_log.actor_id is ON DELETE SET NULL -- which does not
   * matter for the actor (an admin, who survives) but does mean the entry has
   * to stand on its own. entity_id carries no foreign key, so the deleted
   * member's id survives in the log as a plain value.
   */
  perform public.write_audit_log(
    v_actor, 'member.deleted', 'member', p_member_id,
    jsonb_build_object(
      'email', v_profile.email,
      'name', btrim(v_profile.first_name || ' ' || v_profile.last_name),
      'membership_status', v_profile.membership_status,
      'roles', to_jsonb(v_roles),
      'attendance_destroyed', v_attendance,
      'point_transactions_destroyed', v_txns,
      'net_points_destroyed', v_net_points,
      'reason', p_reason
    )
  );

  -- The auth user, not the profile. Deleting the profile alone would leave a
  -- working session attached to an account the app cannot describe, and
  -- loadProfile() would retry four times and then give up on every page load.
  delete from auth.users u where u.id = p_member_id;

  return jsonb_build_object(
    'ok', true,
    'member_id', p_member_id,
    'email', v_profile.email,
    'attendance_removed', v_attendance,
    'point_transactions_removed', v_txns,
    'net_points_removed', v_net_points
  );
end;
$$;

comment on function public.admin_delete_member(uuid, text) is
  'Permanently removes a member and everything cascading from their profile. '
  'Admin only. Refuses self-deletion and refuses to remove the last admin.';

revoke execute on function public.admin_delete_member(uuid, text) from public, anon;
grant execute on function public.admin_delete_member(uuid, text) to authenticated;

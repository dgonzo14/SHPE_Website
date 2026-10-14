-- =============================================================================
-- Admins: copy a password reset link for a member
--
-- The emailed reset link fails often enough to matter here: WashU's mail
-- filtering quarantines or pre-opens it (the reason email confirmation is off,
-- see 20260910000001), and a PKCE link only works in the browser that asked
-- for it. So an admin can instead create a single-use reset link and hand it
-- over however works -- a text, Slack, in person.
--
-- Creating the link needs the service role key, which must never reach a
-- browser, so it happens in a Netlify function (netlify/functions/
-- admin-password-reset-link.ts). These two functions are the database's half.
-- The function calls both with the admin's own session, not the service key,
-- so the database decides who is an admin exactly as it does everywhere else:
--
--   1. admin_password_reset_target() first. It refuses anyone who is not an
--      admin before anything is created, and returns the address the link is
--      for, read from auth.users (the address that signs in) rather than
--      profiles.
--   2. The function asks Supabase Auth for the link.
--   3. admin_log_password_reset_link() records it in the audit log. The
--      function returns the link only if this succeeds, so every link an
--      admin has ever seen has an audit row.
--
-- Admin rather than officer: whoever holds the link can set the member's
-- password and sign in as them, which is the same class of power as
-- admin_delete_member() and admin_set_role().
--
-- An admin can't make one for themselves. They are signed in, so Settings
-- changes their password, and refusing it keeps every row in the log about
-- someone else's account.
--
-- The link itself never reaches the database: not as an argument, not in the
-- audit metadata.
-- =============================================================================

create or replace function public.admin_password_reset_target(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.require_admin();
  v_email   text;
  v_profile public.profiles;
begin
  if p_member_id = v_actor then
    raise exception 'Change your own password from Settings instead' using errcode = '22023';
  end if;

  select u.email into v_email from auth.users u where u.id = p_member_id;
  select * into v_profile from public.profiles p where p.id = p_member_id;

  if v_email is null or v_profile.id is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'member_id',    p_member_id,
    'email',        v_email,
    'display_name', btrim(v_profile.first_name || ' ' || v_profile.last_name)
  );
end;
$$;

revoke execute on function public.admin_password_reset_target(uuid) from public, anon;
grant execute on function public.admin_password_reset_target(uuid) to authenticated;


create or replace function public.admin_log_password_reset_link(p_member_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.require_admin();
  v_email   text;
  v_profile public.profiles;
begin
  if p_member_id = v_actor then
    raise exception 'Change your own password from Settings instead' using errcode = '22023';
  end if;

  select u.email into v_email from auth.users u where u.id = p_member_id;
  select * into v_profile from public.profiles p where p.id = p_member_id;

  if v_email is null or v_profile.id is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  perform public.write_audit_log(
    v_actor, 'member.password_reset_link_created', 'member', p_member_id,
    jsonb_build_object(
      'display_name', btrim(v_profile.first_name || ' ' || v_profile.last_name),
      'email',        v_email
    )
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.admin_log_password_reset_link(uuid) from public, anon;
grant execute on function public.admin_log_password_reset_link(uuid) to authenticated;

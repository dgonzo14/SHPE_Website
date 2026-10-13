-- =============================================================================
-- password_reset_links.test.sql — admins creating a reset link for a member
--
-- Run with:  supabase test db
--
-- The link itself is made by a Netlify function holding the service role key
-- (netlify/functions/admin-password-reset-link.ts). The database's half is
-- the two functions in 20260918000003, which that function calls with the
-- admin's own session, and they are what decide whether anyone gets a link at
-- all:
--
--   1. Admins only. Not anon, not a member, not an officer: whoever holds the
--      link can set the member's password and sign in as them.
--   2. Never for yourself, and never for an account that doesn't exist.
--   3. The address is the one that signs in (auth.users), not the copy kept
--      in profiles.
--   4. Each link is audited once, by the logging call alone, and the audit row
--      says whose account it was and who asked -- never the link.
--
-- Like every suite, this runs in one transaction and is rolled back.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

-- ── Fixtures (fictional people only) ────────────────────────────────────────

create or replace function public.test_create_user(
  p_id uuid, p_email text, p_first text, p_last text
) returns uuid language plpgsql as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'test-not-a-real-hash', now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('first_name', p_first, 'last_name', p_last)::jsonb,
    '', '', '', ''
  );
  return p_id;
end;
$$;

-- Who the next statements run as. null means no session.
create or replace function public.test_login(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    case when p_sub is null then ''
         else json_build_object('sub', p_sub, 'role', 'authenticated')::text end,
    true);
end;
$$;

-- Audit rows for one action about this suite's people, read past RLS. null
-- counts every action, so "wrote nothing at all" is one assertion.
create or replace function public.test_audits(p_action text, p_member uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.admin_audit_log l
   where (p_action is null or l.action = p_action)
     and l.entity_id = p_member;
$$;

-- Every reset link logged against this suite's fixtures, including ids that
-- don't belong to anyone.
create or replace function public.test_reset_links() returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.admin_audit_log l
   where l.action = 'member.password_reset_link_created'
     and l.entity_id::text like 'a5a50000-%';
$$;

grant execute on function public.test_login(uuid)          to anon, authenticated;
grant execute on function public.test_audits(text, uuid)   to anon, authenticated;
grant execute on function public.test_reset_links()        to anon, authenticated;

select public.test_login(null);

select public.test_create_user('a5a50000-0000-4000-8000-000000000001', 'ada.alvarado@wustl.edu', 'Ada',  'Alvarado');
select public.test_create_user('a5a50000-0000-4000-8000-000000000002', 'omar.olmos@wustl.edu',   'Omar', 'Olmos');
select public.test_create_user('a5a50000-0000-4000-8000-000000000003', 'mara.molina@wustl.edu',  'Mara', 'Molina');
select public.test_create_user('a5a50000-0000-4000-8000-000000000004', 'tess.torres@wustl.edu',  'Tess', 'Torres');

update public.profiles set membership_status = 'active'
 where id::text like 'a5a50000-0000-4000-8000-00000000000%';

insert into public.member_roles (member_id, role) values
  ('a5a50000-0000-4000-8000-000000000001', 'admin'),
  ('a5a50000-0000-4000-8000-000000000002', 'officer')
on conflict do nothing;

-- Tess's profile has drifted from the address she signs in with (an officer
-- edited it, or an email change was only half applied). The link has to go to
-- the address Auth knows.
update public.profiles set email = 'tess.torres@example.com'
 where id = 'a5a50000-0000-4000-8000-000000000004';


-- =============================================================================
-- 1. ADMINS ONLY
-- =============================================================================

select ok(
  not has_function_privilege('anon', 'public.admin_password_reset_target(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_log_password_reset_link(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_password_reset_target(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_log_password_reset_link(uuid)', 'execute'),
  'signed-in callers can reach both (each checks for an admin itself); anon cannot');

set local role anon;
select public.test_login(null);

select throws_ok(
  $$select public.admin_password_reset_target('a5a50000-0000-4000-8000-000000000004')$$,
  '42501', null,
  'anon cannot look up whose link it would be');

select throws_ok(
  $$select public.admin_log_password_reset_link('a5a50000-0000-4000-8000-000000000004')$$,
  '42501', null,
  'nor record one');

set local role authenticated;
select public.test_login('a5a50000-0000-4000-8000-000000000003');

select throws_ok(
  $$select public.admin_password_reset_target('a5a50000-0000-4000-8000-000000000004')$$,
  '42501', null,
  'a member cannot get a reset link for someone else');

select throws_ok(
  $$select public.admin_log_password_reset_link('a5a50000-0000-4000-8000-000000000004')$$,
  '42501', null,
  'nor record one');

select public.test_login('a5a50000-0000-4000-8000-000000000002');

select throws_ok(
  $$select public.admin_password_reset_target('a5a50000-0000-4000-8000-000000000004')$$,
  '42501', null,
  'an officer cannot either: a reset link is a way into someone''s account');

select throws_ok(
  $$select public.admin_log_password_reset_link('a5a50000-0000-4000-8000-000000000004')$$,
  '42501', null,
  'nor record one');


-- =============================================================================
-- 2. NOT FOR YOURSELF, NOT FOR NOBODY
-- =============================================================================

select public.test_login('a5a50000-0000-4000-8000-000000000001');

select throws_ok(
  $$select public.admin_password_reset_target('a5a50000-0000-4000-8000-000000000001')$$,
  '22023', 'Change your own password from Settings instead',
  'an admin can''t make a reset link for their own account');

select throws_ok(
  $$select public.admin_log_password_reset_link('a5a50000-0000-4000-8000-000000000001')$$,
  '22023', 'Change your own password from Settings instead',
  'nor record one');

select throws_ok(
  $$select public.admin_password_reset_target('a5a50000-0000-4000-8000-0000000000ff')$$,
  'P0002', 'Member not found',
  'an id with no account behind it is not found');

select throws_ok(
  $$select public.admin_log_password_reset_link('a5a50000-0000-4000-8000-0000000000ff')$$,
  'P0002', 'Member not found',
  'and can''t be recorded');

select is(public.test_reset_links(), 0,
  'none of the refused calls recorded a link');


-- =============================================================================
-- 3. THE ADDRESS THAT SIGNS IN
-- =============================================================================

select is(
  (select p.email from public.profiles p where p.id = 'a5a50000-0000-4000-8000-000000000004'),
  'tess.torres@example.com',
  'Tess''s profile shows a different address from the one she signs in with');

select is(
  public.admin_password_reset_target('a5a50000-0000-4000-8000-000000000004'),
  '{"member_id":    "a5a50000-0000-4000-8000-000000000004",
    "email":        "tess.torres@wustl.edu",
    "display_name": "Tess Torres"}'::jsonb,
  'an admin gets the member''s sign-in address from Auth, not the one on their profile');

-- Nothing about Tess, and nothing by the admin about anyone: a lookup that
-- logged itself under some other entity would still be a row too many.
select is(
  (select count(*)::int from public.admin_audit_log l
    where l.entity_id = 'a5a50000-0000-4000-8000-000000000004'
       or l.actor_id  = 'a5a50000-0000-4000-8000-000000000001'),
  0,
  'looking it up records nothing: no link exists yet');


-- =============================================================================
-- 4. EVERY LINK IS AUDITED, NEVER THE LINK ITSELF
-- =============================================================================

select is(
  public.admin_log_password_reset_link('a5a50000-0000-4000-8000-000000000004'),
  '{"ok": true}'::jsonb,
  'an admin records the link they were given');

select is(public.test_audits('member.password_reset_link_created', 'a5a50000-0000-4000-8000-000000000004'), 1,
  'which writes exactly one audit row');

select ok(
  exists (select 1 from public.admin_audit_log l
           where l.action = 'member.password_reset_link_created'
             and l.entity_type = 'member'
             and l.entity_id = 'a5a50000-0000-4000-8000-000000000004'
             and l.actor_id = 'a5a50000-0000-4000-8000-000000000001'),
  'the row is about the member and names the admin who asked');

select is(
  (select l.metadata ->> 'display_name' from public.admin_audit_log l
    where l.action = 'member.password_reset_link_created'
      and l.entity_id = 'a5a50000-0000-4000-8000-000000000004'),
  'Tess Torres',
  'it says whose account it was by name');

select is(
  (select l.metadata ->> 'email' from public.admin_audit_log l
    where l.action = 'member.password_reset_link_created'
      and l.entity_id = 'a5a50000-0000-4000-8000-000000000004'),
  'tess.torres@wustl.edu',
  'and by the address the link was for');

select ok(
  not exists (select 1 from public.admin_audit_log l, jsonb_object_keys(l.metadata) k
               where l.action = 'member.password_reset_link_created'
                 and l.entity_id = 'a5a50000-0000-4000-8000-000000000004'
                 and (k ilike '%link%' or k ilike '%token%')),
  'and carries nothing that could be the link: no link or token key at all');

-- A second link replaces the first on Supabase's side, but it is still a link
-- an admin was handed, so it gets its own row.
select public.admin_log_password_reset_link('a5a50000-0000-4000-8000-000000000004');

select is(public.test_audits('member.password_reset_link_created', 'a5a50000-0000-4000-8000-000000000004'), 2,
  'every link gets its own row');

reset role;

select * from finish();
rollback;

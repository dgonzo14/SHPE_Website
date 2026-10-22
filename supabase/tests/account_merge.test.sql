-- =============================================================================
-- Two accounts for one person: merging them, and moving the address
--
-- private.merge_member_accounts() and private.change_member_email(), from
-- 20260919000002. The case they exist for: a member's first account was left
-- unconfirmed, they registered again under another address, and their real
-- address stayed on the account nobody could open.
--
--   1. Neither is reachable from any client role.
--   2. A merge moves attendance, points, form responses, roles and the
--      position onto the kept account, counts each event once, and deletes
--      the duplicate, with its history copied into the audit log.
--   3. A merge refuses, changing nothing, when the duplicate has a business
--      card or has done officer work. Its own rows -- the created_by on its
--      own awards, an audit entry about itself -- are not officer work.
--   4. Changing the address moves it everywhere it is kept, confirms it,
--      clears a pending change, checks in form responses waiting under it,
--      and refuses an address another account holds or the domain policy
--      forbids.
--
-- Like every suite, this runs in one transaction and is rolled back.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

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

grant execute on function public.test_login(uuid) to anon, authenticated;

-- Audit rows for one action on one entity.
create or replace function public.test_audits(p_action text, p_entity uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.admin_audit_log l
   where l.action = p_action and l.entity_id = p_entity;
$$;

-- A member's attendance at one event and what it earned, as one string.
create or replace function public.test_attendance(p_member uuid, p_event uuid) returns text
language sql security definer set search_path = '' as $$
  select format('rows=%s method=%s awards=%s points=%s',
    (select count(*) from public.event_attendance a
      where a.member_id = p_member and a.event_id = p_event),
    (select coalesce(string_agg(a.check_in_method::text, ','), 'none') from public.event_attendance a
      where a.member_id = p_member and a.event_id = p_event),
    (select count(*) from public.point_transactions t
      where t.member_id = p_member and t.event_id = p_event),
    (select coalesce(sum(t.amount), 0) from public.point_transactions t
      where t.member_id = p_member and t.event_id = p_event));
$$;

-- A member's whole point total.
create or replace function public.test_points(p_member uuid) returns integer
language sql security definer set search_path = '' as $$
  select coalesce(sum(t.amount), 0)::integer
    from public.point_transactions t where t.member_id = p_member;
$$;

-- Where the response from one address to one event stands: waiting, or
-- claimed by a member and pointing at that member's attendance there.
create or replace function public.test_response(p_event uuid, p_email text) returns text
language sql security definer set search_path = '' as $$
  select case
           when s.id is null                          then 'no response'
           when s.member_id is null                   then 'waiting'
           when s.attendance_id is null               then 'on a member but no attendance'
           when s.attendance_id is distinct from a.id then 'pointing at the wrong attendance row'
           else 'claimed by ' || s.member_id::text
         end
    from (select 1) as one
    left join public.event_attendance_submissions s
           on s.event_id = p_event and s.email_normalized = p_email
    left join public.event_attendance a
           on a.event_id = s.event_id and a.member_id = s.member_id;
$$;

-- What a merge refused with, or 'merged' if it didn't. The exception block is
-- a subtransaction, so a refusal leaves nothing behind -- which is the claim
-- being tested.
create or replace function public.test_merge_error(p_keep uuid, p_duplicate uuid) returns text
language plpgsql as $$
begin
  perform private.merge_member_accounts(p_keep, p_duplicate, 'test');
  return 'merged';
exception when others then
  return sqlerrm;
end;
$$;

select public.test_login(null);

-- Olga is an officer. Mara's first account (...02) was left unconfirmed, so
-- she registered again as mara.merced1@ (...03), the account she uses.
select public.test_create_user('dede0000-0000-4000-8000-000000000001', 'olga.ortiz@wustl.edu',   'Olga', 'Ortiz');
select public.test_create_user('dede0000-0000-4000-8000-000000000002', 'mara.merced@wustl.edu',  'Mara', 'Merced');
select public.test_create_user('dede0000-0000-4000-8000-000000000003', 'mara.merced1@wustl.edu', 'Mara', 'Merced');
-- Accounts a merge has to refuse: one with a card, one that created an event,
-- one that changed someone else's membership.
select public.test_create_user('dede0000-0000-4000-8000-000000000004', 'cata.card@wustl.edu',    'Cata', 'Card');
select public.test_create_user('dede0000-0000-4000-8000-000000000005', 'evo.event@wustl.edu',    'Evo',  'Event');
select public.test_create_user('dede0000-0000-4000-8000-000000000006', 'aldo.audit@wustl.edu',   'Aldo', 'Audit');
-- Teo registered with a typo and filled in the form with his real address.
select public.test_create_user('dede0000-0000-4000-8000-000000000007', 'teo.tapai@wustl.edu',    'Teo',  'Tapia');

update public.profiles set membership_status = 'active'
 where id::text like 'dede0000-0000-4000-8000-00000000000%';

insert into public.member_roles (member_id, role)
values ('dede0000-0000-4000-8000-000000000001', 'officer')
on conflict do nothing;

update auth.users set email_confirmed_at = null
 where id in ('dede0000-0000-4000-8000-000000000002', 'dede0000-0000-4000-8000-000000000007');

-- The account Mara uses has an email identity, its address copied into its
-- metadata as Supabase Auth does, and a change it once asked for and never
-- confirmed.
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values ('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000003',
        '{"sub": "dede0000-0000-4000-8000-000000000003", "email": "mara.merced1@wustl.edu", "email_verified": true}',
        'email', now(), now());

update auth.users
   set raw_user_meta_data     = raw_user_meta_data || '{"email": "mara.merced1@wustl.edu"}'::jsonb,
       email_change           = 'mmerced@wustl.edu',
       email_change_token_new = 'stale-token'
 where id = 'dede0000-0000-4000-8000-000000000003';

insert into public.event_categories (id, name, slug, sort_order)
values ('dede0000-0000-4000-8000-0000000c0001', 'Merge Test Category', 'merge-test-category', 1);

insert into public.events (id, title, category_id, start_at, end_at, points_value, status, created_by)
values
  ('dede0000-0000-4000-8000-000000000101', 'Kickoff GBM',     'dede0000-0000-4000-8000-0000000c0001',
   now() - interval '20 days', now() - interval '20 days' + interval '2 hours', 10, 'completed', 'dede0000-0000-4000-8000-000000000001'),
  ('dede0000-0000-4000-8000-000000000102', 'Resume Workshop', 'dede0000-0000-4000-8000-0000000c0001',
   now() - interval '13 days', now() - interval '13 days' + interval '2 hours', 10, 'completed', 'dede0000-0000-4000-8000-000000000001'),
  ('dede0000-0000-4000-8000-000000000103', 'Study Night',     'dede0000-0000-4000-8000-0000000c0001',
   now() - interval '6 days', now() - interval '6 days' + interval '2 hours', 5, 'completed', 'dede0000-0000-4000-8000-000000000001'),
  ('dede0000-0000-4000-8000-000000000104', 'Fall Social',     'dede0000-0000-4000-8000-0000000c0001',
   now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 5, 'completed', 'dede0000-0000-4000-8000-000000000001'),
  ('dede0000-0000-4000-8000-000000000105', 'Evo''s Mixer',    'dede0000-0000-4000-8000-0000000c0001',
   now() - interval '1 day', now() - interval '1 day' + interval '2 hours', 5, 'completed', 'dede0000-0000-4000-8000-000000000005');

-- Both of Mara's accounts were at the Kickoff: she checked in with a code on
-- the one she uses, and the form matched her real address to the other.
select public.perform_check_in('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000101', 'code', null);
select public.perform_check_in('dede0000-0000-4000-8000-000000000002', 'dede0000-0000-4000-8000-000000000101', 'form', null);
-- Only the old account has the Resume Workshop, also through the form, and
-- only the one she uses has Study Night.
select public.perform_check_in('dede0000-0000-4000-8000-000000000002', 'dede0000-0000-4000-8000-000000000102', 'form', null);
select public.perform_check_in('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000103', 'code', null);

-- The form responses behind the old account's two check-ins.
insert into public.event_attendance_submissions
  (event_id, first_name, last_name, email, member_id, attendance_id, claimed_at)
select a.event_id, 'Mara', 'Merced', 'mara.merced@wustl.edu', a.member_id, a.id, now()
  from public.event_attendance a
 where a.member_id = 'dede0000-0000-4000-8000-000000000002';

-- An officer gave the old account a bonus, the officer role and a position --
-- picking the wrong one of two Mara Merceds.
insert into public.point_transactions (member_id, amount, transaction_type, description, created_by)
values ('dede0000-0000-4000-8000-000000000002', 3, 'manual_adjustment', 'Helped at tabling',
        'dede0000-0000-4000-8000-000000000001');

insert into public.member_roles (member_id, role, granted_by)
values ('dede0000-0000-4000-8000-000000000002', 'officer', 'dede0000-0000-4000-8000-000000000001');

insert into public.chapter_positions (member_id, title, granted_by)
values ('dede0000-0000-4000-8000-000000000002', 'Treasurer', 'dede0000-0000-4000-8000-000000000001');

-- An account is the actor on a few entries about itself, redeeming the join
-- code among them. That is not officer work.
select public.write_audit_log('dede0000-0000-4000-8000-000000000002', 'membership.join_code_redeemed',
                              'member', 'dede0000-0000-4000-8000-000000000002', '{}'::jsonb);

-- Cata has a card. Evo created an event (above). Aldo changed Teo's
-- membership.
select private.insert_officer_card('dede0000-0000-4000-8000-000000000004', 'cata-card',
                                   'dede0000-0000-4000-8000-000000000001', false);
select public.write_audit_log('dede0000-0000-4000-8000-000000000006', 'membership.status_changed',
                              'member', 'dede0000-0000-4000-8000-000000000007',
                              '{"from": "pending", "to": "active"}'::jsonb);

-- Teo's response to the Fall Social waits under his real address.
insert into public.event_attendance_submissions (event_id, first_name, last_name, email)
values ('dede0000-0000-4000-8000-000000000104', 'Teo', 'Tapia', 'teo.tapia@wustl.edu');


-- ── 1. Console only ─────────────────────────────────────────────────────────

select ok(
  not has_function_privilege('anon', 'private.merge_member_accounts(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.merge_member_accounts(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'private.change_member_email(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.change_member_email(uuid, text, text)', 'execute'),
  'no client role can merge accounts or change an address');

set local role authenticated;
select public.test_login('dede0000-0000-4000-8000-000000000001');

select throws_ok(
  $$select private.merge_member_accounts('dede0000-0000-4000-8000-000000000001', 'dede0000-0000-4000-8000-000000000003')$$,
  '42501', null,
  'not even an officer can merge one account into another');

select throws_ok(
  $$select private.change_member_email('dede0000-0000-4000-8000-000000000001', 'olga@wustl.edu')$$,
  '42501', null,
  'or change an address');

reset role;
select public.test_login(null);


-- ── 2. A merge ──────────────────────────────────────────────────────────────

create temp table merge_result as
select private.merge_member_accounts(
  'dede0000-0000-4000-8000-000000000003',
  'dede0000-0000-4000-8000-000000000002',
  'First account was never confirmed') as r;

select is(
  (select r from merge_result),
  '{"ok": true,
    "kept": "dede0000-0000-4000-8000-000000000003",
    "kept_email": "mara.merced1@wustl.edu",
    "deleted": "dede0000-0000-4000-8000-000000000002",
    "deleted_email": "mara.merced@wustl.edu",
    "attendance_moved": 1,
    "attendance_dropped": 1,
    "point_transactions_moved": 2,
    "point_transactions_dropped": 1,
    "points_moved": 13,
    "points_dropped": 10,
    "responses_moved": 2,
    "roles_added": ["officer"],
    "position_moved": "Treasurer",
    "position_dropped": null,
    "kept_membership_status": "active",
    "duplicate_membership_status": "active"}'::jsonb,
  'the merge reports what it moved and what it dropped');

select is(
  (select count(*)::integer from auth.users where id = 'dede0000-0000-4000-8000-000000000002'),
  0,
  'the duplicate''s sign-in is gone');

select is(
  (select count(*)::integer from public.profiles where id = 'dede0000-0000-4000-8000-000000000002'),
  0,
  'and so is its profile');

select is(
  public.test_attendance('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000101'),
  'rows=1 method=code awards=1 points=10',
  'an event both attended counts once, and her own check-in stands');

select is(
  public.test_attendance('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000102'),
  'rows=1 method=form awards=1 points=10',
  'an event only the duplicate had moves over with its award');

select is(
  public.test_attendance('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000103'),
  'rows=1 method=code awards=1 points=5',
  'her own attendance is untouched');

select is(
  public.test_points('dede0000-0000-4000-8000-000000000003'),
  28,
  'her total is 10 + 10 + 5 and the 3-point bonus: nothing counted twice, nothing lost');

select is(
  public.test_response('dede0000-0000-4000-8000-000000000101', 'mara.merced@wustl.edu'),
  'claimed by dede0000-0000-4000-8000-000000000003',
  'a response for an event both attended now points at her check-in');

select is(
  public.test_response('dede0000-0000-4000-8000-000000000102', 'mara.merced@wustl.edu'),
  'claimed by dede0000-0000-4000-8000-000000000003',
  'and one for the moved check-in follows it');

select is(
  (select t.created_by from public.point_transactions t
    where t.member_id = 'dede0000-0000-4000-8000-000000000003'
      and t.event_id = 'dede0000-0000-4000-8000-000000000102'),
  'dede0000-0000-4000-8000-000000000003'::uuid,
  'an award the duplicate earned itself now names her, not a blank');

select is(
  (select t.created_by from public.point_transactions t
    where t.member_id = 'dede0000-0000-4000-8000-000000000003'
      and t.transaction_type = 'manual_adjustment'),
  'dede0000-0000-4000-8000-000000000001'::uuid,
  'the officer''s bonus still names the officer');

select ok(
  private.is_officer('dede0000-0000-4000-8000-000000000003'),
  'the role granted to the wrong account is now on hers');

select is(
  (select cp.title from public.chapter_positions cp
    where cp.member_id = 'dede0000-0000-4000-8000-000000000003'),
  'Treasurer',
  'and so is the position');

select is(
  public.test_audits('member.merged', 'dede0000-0000-4000-8000-000000000003'),
  1,
  'the merge is in the audit log, on the kept account');

select is(
  (select format('%s|%s|%s|%s|%s',
                 l.metadata ->> 'duplicate_email',
                 jsonb_array_length(l.metadata -> 'attendance_detail'),
                 jsonb_array_length(l.metadata -> 'point_transaction_detail'),
                 l.metadata ->> 'points_dropped',
                 l.metadata ->> 'reason')
     from public.admin_audit_log l
    where l.action = 'member.merged'
      and l.entity_id = 'dede0000-0000-4000-8000-000000000003'),
  'mara.merced@wustl.edu|2|3|10|First account was never confirmed',
  'with the duplicate''s attendance and ledger copied in, so it can be put back');


-- ── 3. What a merge refuses ─────────────────────────────────────────────────

select matches(
  public.test_merge_error('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000004'),
  'business card',
  'a duplicate with a business card is refused');

select matches(
  public.test_merge_error('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000005'),
  'public\.events\.created_by',
  'so is one that created an event, naming where it is recorded');

select matches(
  public.test_merge_error('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000006'),
  'audit log entries about others',
  'and one that acted on someone else''s membership');

select throws_ok(
  $$select private.merge_member_accounts('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000003')$$,
  '22023', null,
  'an account cannot be merged into itself');

select throws_ok(
  $$select private.merge_member_accounts('dede0000-0000-4000-8000-000000000003', null)$$,
  '22023', null,
  'both accounts have to be named');

select throws_ok(
  $$select private.merge_member_accounts('dede0000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-0000000000ff')$$,
  'P0002', null,
  'an account that does not exist is reported, not skipped');

select is(
  (select count(*)::integer from public.profiles
    where id in ('dede0000-0000-4000-8000-000000000004',
                 'dede0000-0000-4000-8000-000000000005',
                 'dede0000-0000-4000-8000-000000000006')),
  3,
  'every refused duplicate is still there');

select is(
  public.test_points('dede0000-0000-4000-8000-000000000003'),
  28,
  'and the kept account gained nothing from them');


-- ── 4. Changing the address ─────────────────────────────────────────────────

create temp table change_result as
select private.change_member_email(
  'dede0000-0000-4000-8000-000000000003',
  '  Mara.Merced@WUSTL.edu ',
  'Back to her real address') as r;

select is(
  (select r from change_result),
  '{"ok": true, "changed": true,
    "member_id": "dede0000-0000-4000-8000-000000000003",
    "old_email": "mara.merced1@wustl.edu",
    "email": "mara.merced@wustl.edu",
    "responses_claimed": 0}'::jsonb,
  'the freed address moves to the account she uses, trimmed and lowercased');

select is(
  (select format('%s|%s|%s|%s', u.email, p.email, i.identity_data ->> 'email', u.raw_user_meta_data ->> 'email')
     from auth.users u
     join public.profiles p on p.id = u.id
     join auth.identities i on i.user_id = u.id and i.provider = 'email'
    where u.id = 'dede0000-0000-4000-8000-000000000003'),
  'mara.merced@wustl.edu|mara.merced@wustl.edu|mara.merced@wustl.edu|mara.merced@wustl.edu',
  'in every place the address is kept: sign-in, profile, identity and metadata');

select is(
  (select format('[%s][%s]', u.email_change, u.email_change_token_new)
     from auth.users u where u.id = 'dede0000-0000-4000-8000-000000000003'),
  '[][]',
  'the change she once asked for is cleared, so its link cannot move the address again');

select is(
  (select format('%s -> %s', l.metadata ->> 'previous_email', l.metadata ->> 'email')
     from public.admin_audit_log l
    where l.action = 'member.email_changed'
      and l.entity_id = 'dede0000-0000-4000-8000-000000000003'),
  'mara.merced1@wustl.edu -> mara.merced@wustl.edu',
  'the change is in the audit log');

select is(
  private.change_member_email('dede0000-0000-4000-8000-000000000003', 'mara.merced@wustl.edu') ->> 'changed',
  'false',
  'asking for the address it already has changes nothing');

select throws_ok(
  $$select private.change_member_email('dede0000-0000-4000-8000-000000000003', 'olga.ortiz@wustl.edu')$$,
  '23505', null,
  'an address another account holds is refused');

select throws_ok(
  $$select private.change_member_email('dede0000-0000-4000-8000-000000000003', 'olga.ortiz+shpe@wustl.edu')$$,
  '23505', null,
  'including the same mailbox with a +tag');

select throws_ok(
  $$select private.change_member_email('dede0000-0000-4000-8000-000000000003', 'not an address')$$,
  '22023', null,
  'something that is not an address is refused');

select is(
  (select u.email from auth.users u where u.id = 'dede0000-0000-4000-8000-000000000003'),
  'mara.merced@wustl.edu',
  'and none of the refusals touched her address');

select throws_ok(
  $$select private.change_member_email('dede0000-0000-4000-8000-000000000003', 'mara.merced@gmail.com')$$,
  '23514', null,
  'the chapter''s domain policy still applies');

set local app.allow_email_domain_change = 'on';

select is(
  private.change_member_email('dede0000-0000-4000-8000-000000000003', 'mara.merced@gmail.com') ->> 'email',
  'mara.merced@gmail.com',
  'unless the console session says so on purpose');

set local app.allow_email_domain_change = 'off';

create temp table teo_result as
select private.change_member_email('dede0000-0000-4000-8000-000000000007', 'teo.tapia@wustl.edu') as r;

select is(
  (select r ->> 'responses_claimed' from teo_result),
  '1',
  'fixing a typo picks up the form response waiting under the real address');

select is(
  public.test_attendance('dede0000-0000-4000-8000-000000000007', 'dede0000-0000-4000-8000-000000000104'),
  'rows=1 method=form awards=1 points=5',
  'and checks him in to that event, points included');

select is(
  public.test_response('dede0000-0000-4000-8000-000000000104', 'teo.tapia@wustl.edu'),
  'claimed by dede0000-0000-4000-8000-000000000007',
  'with the response pointing at that check-in');

select ok(
  (select u.email_confirmed_at is not null from auth.users u
    where u.id = 'dede0000-0000-4000-8000-000000000007'),
  'and his unconfirmed account is confirmed, so the new address can sign in');


select * from finish();
rollback;

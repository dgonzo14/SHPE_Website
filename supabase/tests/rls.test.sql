-- =============================================================================
-- rls.test.sql — the authorisation matrix
--
-- Run with:  supabase test db
--
-- Everything here is attempted the way an attacker would: not by clicking a
-- button the UI does not render, but by issuing the query directly against
-- PostgREST's `authenticated` role with a member's JWT. If any of these pass
-- when they should fail, hiding the corresponding UI is worthless.
--
-- `supabase test db` runs against the live local database, which has already
-- been seeded with development data. Count assertions are therefore scoped to
-- this suite's own fixture rows by id prefix. Assertions about what a member
-- can see of *their own* data need no scoping: RLS already limits those to the
-- fixture member, and that is precisely what is being tested.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

-- ── Fixtures (fictional people only) ────────────────────────────────────────

create or replace function public.test_create_user(
  p_id uuid, p_email text, p_first text, p_last text
) returns uuid language plpgsql as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    -- GoTrue scans these into Go strings, not pointers, so a NULL here makes
    -- every sign-in fail with an opaque 500 ("Database error querying
    -- schema"). They have no column default, so seeding auth.users by hand
    -- means setting them explicitly.
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

select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000001', 'ana.rivera@wustl.edu',   'Ana',   'Rivera');
select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000002', 'luis.mendez@wustl.edu',  'Luis',  'Mendez');
select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000003', 'sofia.castro@wustl.edu', 'Sofia', 'Castro');
select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000004', 'diego.paz@wustl.edu',    'Diego', 'Paz');

insert into public.member_roles (member_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000003', 'officer'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'admin');

insert into public.event_categories (id, name, slug, sort_order)
values ('cccccccc-0000-4000-8000-000000000001', 'Test Category', 'test-category', 1);

insert into public.events (id, title, category_id, start_at, end_at, points_value, status, created_by)
values
  ('dddddddd-0000-4000-8000-000000000001', 'Published Event',
   'cccccccc-0000-4000-8000-000000000001',
   now() + interval '1 day', now() + interval '1 day 2 hours', 10, 'published',
   'aaaaaaaa-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000004', 'Secret Draft',
   'cccccccc-0000-4000-8000-000000000001',
   now() + interval '2 days', now() + interval '2 days 2 hours', 10, 'draft',
   'aaaaaaaa-0000-4000-8000-000000000003');

-- Published, but internal: members see it, the public website must not.
insert into public.events
  (id, title, category_id, start_at, end_at, points_value, status, is_public, created_by)
values
  ('dddddddd-0000-4000-8000-000000000007', 'Exec Board Sync',
   'cccccccc-0000-4000-8000-000000000001',
   now() + interval '1 day', now() + interval '1 day 1 hour', 0, 'published', false,
   'aaaaaaaa-0000-4000-8000-000000000003');

insert into public.event_checkin_secrets (event_id, code_salt, code_hash)
values ('dddddddd-0000-4000-8000-000000000001', 'salt', public.hash_checkin_code('salt', 'SECRET99'));

-- One ledger row and one attendance row per member, so "can I see someone
-- else's?" has something to fail to see.
insert into public.event_attendance (event_id, member_id) values
  ('dddddddd-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('dddddddd-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002');

insert into public.point_transactions (member_id, event_id, amount, transaction_type, description) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 10, 'event_attendance', 'Published Event'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001', 10, 'event_attendance', 'Published Event');

insert into public.announcements (id, title, body, published_at, expires_at) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'Live announcement',    'Visible',  now() - interval '1 hour', null),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Expired announcement', 'Hidden',   now() - interval '2 days', now() - interval '1 day'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'Unpublished draft',    'Hidden',   null, null);

insert into public.resources (id, title, category, url, visibility) values
  ('ffffffff-0000-4000-8000-000000000001', 'Public doc',  'Career', 'https://example.test/p', 'public'),
  ('ffffffff-0000-4000-8000-000000000002', 'Member doc',  'Career', 'https://example.test/m', 'member'),
  ('ffffffff-0000-4000-8000-000000000003', 'Officer doc', 'Career', 'https://example.test/o', 'officer');


-- =============================================================================
-- AS A PLAIN MEMBER
-- =============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',
                  true);

-- ── Can read their own things ───────────────────────────────────────────────

select is(
  (select count(*)::int from public.profiles),
  1,
  'a member sees exactly one profile: their own'
);

select is(
  (select id from public.profiles),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'and it is theirs'
);

select is(
  (select count(*)::int from public.event_attendance),
  1,
  'a member sees only their own attendance'
);

select is(
  (select count(*)::int from public.point_transactions),
  1,
  'a member sees only their own point ledger'
);

select is(
  (select count(*)::int from public.events where id::text like 'dddddddd-%'),
  2,
  'a member sees published events, including internal ones, but not drafts'
);

select is(
  (select count(*)::int from public.events where title = 'Secret Draft'),
  0,
  'the draft is invisible, not merely filtered by the client'
);

select is(
  (select count(*)::int from public.announcements where id::text like 'eeeeeeee-%'),
  1,
  'a member sees live announcements only, not expired or unpublished ones'
);

select is(
  (select title from public.announcements where id::text like 'eeeeeeee-%'),
  'Live announcement',
  'and it is the live one'
);

-- Scoped to this suite's rows: the reference-data migration seeds real
-- chapter documents, and counting those too would make this assertion brittle.
select is(
  (select count(*)::int from public.resources where id::text like 'ffffffff-%'),
  2,
  'a member sees public and member resources, not officer-only ones'
);

select is(
  (select count(*)::int from public.resources where visibility = 'officer'),
  0,
  'officer-only resources are unreachable, not just hidden in the UI'
);

select is(
  (select count(*)::int from public.member_roles),
  1,
  'a member sees only their own role assignment'
);

-- ── Cannot read what is not theirs ──────────────────────────────────────────

select throws_ok(
  $$select code_hash from public.event_checkin_secrets$$,
  '42501',
  null,
  'check-in secrets are unreachable: no grant, no policy, no query path'
);

select is(
  (select count(*)::int from public.admin_audit_log),
  0,
  'a member cannot read the administrative audit log'
);

select is(
  (select count(*)::int from public.checkin_attempts),
  0,
  'a member cannot read the check-in attempt log'
);

select is(
  (select count(*)::int from public.app_settings),
  0,
  'a member cannot read chapter configuration directly'
);

select throws_ok(
  $$select public.get_member_points_summary('aaaaaaaa-0000-4000-8000-000000000002', null)$$,
  '42501',
  null,
  'a member cannot ask for another member''s point summary'
);

select throws_ok(
  $$select public.evaluate_membership_requirements(
      'aaaaaaaa-0000-4000-8000-000000000002', null)$$,
  '42501',
  null,
  'a member cannot ask for another member''s membership progress'
);

-- ── Cannot write anything that affects standing ─────────────────────────────

select throws_ok(
  $$insert into public.point_transactions (member_id, amount, transaction_type)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 999999, 'bonus')$$,
  '42501',
  null,
  'a member cannot award themselves points'
);

select throws_ok(
  $$update public.point_transactions set amount = 999999$$,
  '42501',
  null,
  'a member cannot edit the point ledger'
);

select throws_ok(
  $$delete from public.point_transactions$$,
  '42501',
  null,
  'a member cannot delete point history'
);

select throws_ok(
  $$insert into public.event_attendance (event_id, member_id)
    values ('dddddddd-0000-4000-8000-000000000004',
            'aaaaaaaa-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'a member cannot mark themselves present'
);

select throws_ok(
  $$insert into public.member_roles (member_id, role)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'admin')$$,
  '42501',
  null,
  'a member cannot grant themselves the admin role'
);

select throws_ok(
  $$select public.admin_set_role('aaaaaaaa-0000-4000-8000-000000000001', 'admin', true)$$,
  '42501',
  null,
  'and cannot do it through the role RPC either'
);

select throws_ok(
  $$insert into public.events (title, category_id, start_at, end_at, points_value)
    values ('Fake', 'cccccccc-0000-4000-8000-000000000001',
            now(), now() + interval '1 hour', 100)$$,
  '42501',
  null,
  'a member cannot create events'
);

select throws_ok(
  $$select public.admin_adjust_points('aaaaaaaa-0000-4000-8000-000000000001', 500, 'nice try')$$,
  '42501',
  null,
  'a member cannot adjust points'
);

select throws_ok(
  $$select public.admin_rotate_event_code('dddddddd-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'a member cannot mint a check-in code'
);

-- ── Profile self-edit is column-limited ─────────────────────────────────────

update public.profiles
   set major = 'Mechanical Engineering',
       membership_status = 'active',
       shpe_national_member = 'verified'
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select is(
  (select major from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'Mechanical Engineering',
  'a member can update their own safe fields'
);

select is(
  (select shpe_national_member::text from public.profiles
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'self_reported',
  'a self-set "verified" National membership is downgraded to self-reported'
);

-- Suspend them the way it actually happens: an officer calling the RPC that
-- the admin portal calls.
--
-- The earlier version of this test suspended the member with a raw UPDATE
-- after `reset role`, which quietly did nothing: the JWT claims were still set
-- from the previous statement, so profiles_guard_protected_columns saw a
-- non-officer caller and restored membership_status — the guard defeated the
-- setup for the test of the guard.
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);

select public.admin_set_membership_status(
  'aaaaaaaa-0000-4000-8000-000000000001', 'suspended', 'Suspended for a test');

-- Back to the member, who tries to undo it.
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',
                  true);

update public.profiles
   set membership_status = 'active'
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select is(
  (select membership_status::text from public.profiles
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'suspended',
  'a member cannot reinstate their own suspended membership'
);

reset role;


-- =============================================================================
-- AS AN ANONYMOUS VISITOR
--
-- The public chapter calendar replaced an embedded Outlook calendar, so `anon`
-- can now read events. These assertions pin down exactly how far that goes.
-- =============================================================================

set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.events where id::text like 'dddddddd-%'),
  1,
  'the public calendar shows published, public events only'
);

select is(
  (select title from public.events where id::text like 'dddddddd-%'),
  'Published Event',
  'and it is the public one'
);

select is(
  (select count(*)::int from public.events where title = 'Exec Board Sync'),
  0,
  'an internal event never reaches the public calendar'
);

-- Row filtering is only half of it: the column-level GRANT is what keeps
-- organiser contact details and check-in windows off the public site.
select throws_ok(
  $$select organizer_email from public.events$$,
  '42501',
  null,
  'the public cannot read organiser contact details'
);

select throws_ok(
  $$select check_in_opens_at from public.events$$,
  '42501',
  null,
  'the public cannot read check-in windows'
);

select throws_ok(
  $$select * from public.profiles$$,
  '42501',
  null,
  'the public cannot read member profiles'
);

reset role;


-- =============================================================================
-- AS AN OFFICER
-- =============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);

select cmp_ok(
  (select count(*)::int from public.profiles), '>=', 4,
  'an officer can read the member roster'
);

select is(
  (select count(*)::int from public.point_transactions
    where member_id::text like 'aaaaaaaa-%'),
  2,
  'an officer can read every member''s ledger, not just their own'
);

select throws_ok(
  $$select code_hash from public.event_checkin_secrets$$,
  '42501',
  null,
  'even an officer cannot read a stored code hash directly'
);

select throws_ok(
  $$select public.admin_set_role('aaaaaaaa-0000-4000-8000-000000000001', 'officer', true)$$,
  '42501',
  null,
  'an officer cannot grant roles: that is admin-only'
);

reset role;


-- =============================================================================
-- AS AN ADMIN
-- =============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000004","role":"authenticated"}',
                  true);

select lives_ok(
  $$select public.admin_set_role('aaaaaaaa-0000-4000-8000-000000000001', 'officer', true)$$,
  'an admin can grant the officer role'
);

select is(
  (select count(*)::int from public.member_roles
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001' and role = 'officer'),
  1,
  'the grant is recorded'
);

select throws_ok(
  $$select public.admin_set_role('aaaaaaaa-0000-4000-8000-000000000004', 'admin', false)$$,
  '22023',
  null,
  'an admin cannot revoke their own admin role and lock the chapter out'
);

reset role;

select * from finish();
rollback;

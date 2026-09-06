-- =============================================================================
-- checkin.test.sql — the transactional check-in path
--
-- Run with:  supabase test db
--
-- These are the tests that matter most. Attendance and its point award are
-- written by one function inside one transaction, so the properties asserted
-- here ("exactly one award", "no attendance outside the window", "no points
-- without attendance") are guarantees of the database, not of the UI.
--
-- Roles are switched with plain SET LOCAL ROLE statements rather than helper
-- functions, because a SET inside a function body has subtle save/restore
-- semantics and these tests must be unambiguous about who is acting.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

-- ── Fixtures (fictional people only) ────────────────────────────────────────

create or replace function public.test_create_user(
  p_id uuid, p_email text, p_first text, p_last text
) returns uuid language plpgsql as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'test-not-a-real-hash', now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('first_name', p_first, 'last_name', p_last)::jsonb
  );
  -- on_auth_user_created has now created the profile, the member role and the
  -- notification preferences row.
  return p_id;
end;
$$;

select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000001', 'ana.rivera@wustl.edu',   'Ana',   'Rivera');
select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000003', 'sofia.castro@wustl.edu', 'Sofia', 'Castro');
select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000005', 'mateo.solis@wustl.edu',  'Mateo', 'Solis');

insert into public.member_roles (member_id, role)
values ('aaaaaaaa-0000-4000-8000-000000000003', 'officer');

update public.profiles
   set membership_status = 'inactive'
 where id = 'aaaaaaaa-0000-4000-8000-000000000005';

insert into public.event_categories (id, name, slug, sort_order)
values ('cccccccc-0000-4000-8000-000000000001', 'Test Category', 'test-category', 1);

insert into public.events (id, title, category_id, start_at, end_at, points_value, status, created_by)
values
  ('dddddddd-0000-4000-8000-000000000001', 'Open Event',
   'cccccccc-0000-4000-8000-000000000001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'published',
   'aaaaaaaa-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000002', 'Future Event',
   'cccccccc-0000-4000-8000-000000000001',
   now() + interval '3 days', now() + interval '3 days 2 hours', 5, 'published',
   'aaaaaaaa-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000003', 'Past Event',
   'cccccccc-0000-4000-8000-000000000001',
   now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 5, 'published',
   'aaaaaaaa-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000004', 'Draft Event',
   'cccccccc-0000-4000-8000-000000000001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'draft',
   'aaaaaaaa-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000005', 'Cancelled Event',
   'cccccccc-0000-4000-8000-000000000001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'cancelled',
   'aaaaaaaa-0000-4000-8000-000000000003'),
  -- Same window as Open Event, so its code must be forced to differ.
  ('dddddddd-0000-4000-8000-000000000006', 'Overlapping Event',
   'cccccccc-0000-4000-8000-000000000001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'published',
   'aaaaaaaa-0000-4000-8000-000000000003');

-- Codes are issued through the officer-only RPC, exactly as the app does it.
set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);

create temporary table issued_codes (event_id uuid primary key, code text not null);

insert into issued_codes
select id, public.admin_rotate_event_code(id) ->> 'code'
  from (values
    ('dddddddd-0000-4000-8000-000000000001'::uuid),
    ('dddddddd-0000-4000-8000-000000000002'::uuid),
    ('dddddddd-0000-4000-8000-000000000003'::uuid),
    ('dddddddd-0000-4000-8000-000000000005'::uuid),
    ('dddddddd-0000-4000-8000-000000000006'::uuid)
  ) as e(id);

reset role;


-- ── Code generation ─────────────────────────────────────────────────────────

select isnt(
  (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000001'),
  null,
  'rotating a code returns the plaintext to the officer once'
);

select matches(
  (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000001'),
  '^[A-Z]+[0-9]{4}$',
  'generated codes are human-enterable word+digits, not sequential'
);

select isnt(
  (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000001'),
  (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000006'),
  'two events whose check-in windows overlap never share a code'
);

select is(
  (select count(*)::int from public.event_checkin_secrets s
    where s.code_hash = (select code from issued_codes
                          where event_id = 'dddddddd-0000-4000-8000-000000000001')),
  0,
  'the plaintext code is never what gets stored'
);

select ok(
  (select s.code_hash = public.hash_checkin_code(
            s.code_salt,
            (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000001'))
     from public.event_checkin_secrets s
    where s.event_id = 'dddddddd-0000-4000-8000-000000000001'),
  'what is stored is the salted hash of the issued code'
);

select is(
  (select count(*)::int from public.admin_audit_log
    where action in ('event.code_generated', 'event.code_rotated')
      and metadata::text like '%' ||
          (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000001')
          || '%'),
  0,
  'the audit log records that a code was issued but never the code itself'
);


-- ── A member checks in ──────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',
                  true);

select is(
  (public.check_in_with_code('not-a-real-code') ->> 'code'),
  'INVALID_CODE',
  'a wrong code is rejected'
);

select is(
  (select count(*)::int from public.event_attendance
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0,
  'a rejected code creates no attendance'
);

select is(
  (public.check_in_with_code(
     (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000002')
   ) ->> 'code'),
  'CHECKIN_NOT_OPEN',
  'the right code before the window says check-in has not opened'
);

select is(
  (public.check_in_with_code(
     (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000003')
   ) ->> 'code'),
  'CHECKIN_CLOSED',
  'the right code after the window says check-in has closed'
);

select is(
  (public.check_in_with_code(
     (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000005')
   ) ->> 'code'),
  'EVENT_CANCELLED',
  'a cancelled event refuses check-in even inside its window'
);

select is(
  (public.check_in_to_event('dddddddd-0000-4000-8000-000000000004', 'ANYCODE1234') ->> 'code'),
  'EVENT_NOT_FOUND',
  'a draft event is indistinguishable from a missing one'
);

select ok(
  (public.check_in_with_code(
     (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000001')
   ) ->> 'ok')::boolean,
  'a valid code inside the window checks the member in'
);

select is(
  (select count(*)::int from public.event_attendance
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000001'),
  1,
  'exactly one attendance row is created'
);

select is(
  (select coalesce(sum(amount), 0)::int from public.point_transactions
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000001'),
  10,
  'the event point value is awarded exactly once'
);

select is(
  (select transaction_type::text from public.point_transactions
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000001'),
  'event_attendance',
  'the award is recorded as event attendance in the ledger'
);

select is(
  (select check_in_method::text from public.event_attendance
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000001'),
  'code',
  'the check-in method is recorded'
);


-- ── Duplicate check-in: the mandatory case ──────────────────────────────────

select is(
  (public.check_in_with_code(
     (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000001')
   ) ->> 'code'),
  'ALREADY_CHECKED_IN',
  'a second check-in with the same code is refused'
);

select is(
  (select count(*)::int from public.event_attendance
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000001'),
  1,
  'a duplicate attempt still leaves exactly one attendance row'
);

select is(
  (select coalesce(sum(amount), 0)::int from public.point_transactions
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000001'),
  10,
  'a duplicate attempt awards no additional points'
);

select throws_ok(
  $$insert into public.event_attendance (event_id, member_id)
    values ('dddddddd-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'a member cannot insert attendance directly, even for an event they attended'
);

reset role;

-- The constraint, not the function, is what makes this impossible.
select throws_ok(
  $$insert into public.event_attendance (event_id, member_id)
    values ('dddddddd-0000-4000-8000-000000000001',
            'aaaaaaaa-0000-4000-8000-000000000001')$$,
  '23505',
  null,
  'the unique constraint rejects a duplicate even for a privileged writer'
);


-- ── Membership status gate ──────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000005","role":"authenticated"}',
                  true);

select is(
  (public.check_in_with_code(
     (select code from issued_codes where event_id = 'dddddddd-0000-4000-8000-000000000001')
   ) ->> 'code'),
  'MEMBER_NOT_ACTIVE',
  'an inactive member cannot check in'
);

select is(
  (select count(*)::int from public.event_attendance
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000005'),
  0,
  'a blocked check-in creates no attendance'
);

reset role;


-- ── Officer correction reconciles points ────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);

select ok(
  (public.admin_remove_attendance(
     (select id from public.event_attendance
       where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
         and event_id = 'dddddddd-0000-4000-8000-000000000001'),
     'Checked in by mistake'
   ) ->> 'ok')::boolean,
  'an officer can remove attendance, with a reason'
);

select is(
  (select coalesce(sum(amount), 0)::int from public.point_transactions
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000001'),
  0,
  'removing attendance nets the points back to zero via a correction'
);

select is(
  (select count(*)::int from public.point_transactions
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000001'),
  2,
  'the original award is preserved alongside the correction, not deleted'
);

reset role;

select * from finish();
rollback;

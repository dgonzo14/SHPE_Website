-- =============================================================================
-- event_points_reaward.test.sql — changing an event's points re-awards its roster
--
-- Run with:  supabase test db
--
-- An officer edits points_value with a plain UPDATE, exactly as the event form
-- does, and every attendee's net for that event must end at the new value:
-- through appended 'correction' rows, never by editing the original award, and
-- only for people still on the roster.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

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

-- What one member has, net, from one event. Read as the table owner, so call
-- it with the role reset.
create or replace function public.test_event_net(p_member uuid, p_event uuid)
returns integer language sql as $$
  select coalesce(sum(pt.amount), 0)::integer
    from public.point_transactions pt
   where pt.member_id = p_member and pt.event_id = p_event;
$$;

select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000001', 'ana.rivera@wustl.edu',   'Ana',   'Rivera');
select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000003', 'sofia.castro@wustl.edu', 'Sofia', 'Castro');
select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000005', 'mateo.solis@wustl.edu',  'Mateo', 'Solis');
select public.test_create_user('aaaaaaaa-0000-4000-8000-000000000007', 'lucia.mora@wustl.edu',   'Lucia', 'Mora');

update public.profiles
   set membership_status = 'active'
 where id in (
   'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000003',
   'aaaaaaaa-0000-4000-8000-000000000005',
   'aaaaaaaa-0000-4000-8000-000000000007'
 );

insert into public.member_roles (member_id, role)
values ('aaaaaaaa-0000-4000-8000-000000000003', 'officer');

-- A term of its own, set on the events explicitly, so where a correction lands
-- doesn't depend on today's date or the reference data's terms.
insert into public.academic_terms (id, name, term_type, start_date, end_date, academic_year, is_active)
values ('eeeeeeee-0000-4000-8000-000000000001', 'Test Reaward Term', 'spring',
        '2031-01-13', '2031-05-09', '2030-2031', false);

insert into public.event_categories (id, name, slug, sort_order)
values ('cccccccc-0000-4000-8000-000000000001', 'Test Category', 'test-category', 1);

insert into public.events (id, title, category_id, academic_term_id, start_at, end_at, points_value, status, created_by)
values
  -- Created at 0 by mistake: the case that prompted this.
  ('dddddddd-0000-4000-8000-000000000001', 'Zero Point Meeting',
   'cccccccc-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',
   now() - interval '1 hour', now() + interval '1 hour', 0, 'published',
   'aaaaaaaa-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000002', 'Fifty Point Meeting',
   'cccccccc-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',
   now() - interval '1 hour', now() + interval '1 hour', 50, 'published',
   'aaaaaaaa-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000003', 'Nobody Came',
   'cccccccc-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',
   now() - interval '1 hour', now() + interval '1 hour', 10, 'published',
   'aaaaaaaa-0000-4000-8000-000000000003');

-- The roster, built the way the app builds it. Lucia is added to the fifty
-- point meeting and then removed, so she has an award and its reversal.
set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);

select public.admin_add_attendance('dddddddd-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');
select public.admin_add_attendance('dddddddd-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000005');
select public.admin_add_attendance('dddddddd-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001');
select public.admin_add_attendance('dddddddd-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000005');
select public.admin_add_attendance('dddddddd-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000007');
select public.admin_remove_attendance(
  (select id from public.event_attendance
    where event_id = 'dddddddd-0000-4000-8000-000000000002'
      and member_id = 'aaaaaaaa-0000-4000-8000-000000000007'),
  'Added to the wrong event'
);

reset role;

select is(
  (select count(*)::int from public.point_transactions
    where event_id = 'dddddddd-0000-4000-8000-000000000001'),
  0,
  'a 0-point event puts nothing in the ledger at check-in'
);


-- ── Raising the points: 0 -> 50 ─────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);

select lives_ok(
  $$update public.events set points_value = 50
     where id = 'dddddddd-0000-4000-8000-000000000001'$$,
  'an officer raises an event''s points with an ordinary update'
);

reset role;

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001'),
  50,
  'an attendee checked in at 0 points now has the new 50'
);

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000005', 'dddddddd-0000-4000-8000-000000000001'),
  50,
  'so does every other attendee'
);

select is(
  (select array_agg(distinct transaction_type::text) from public.point_transactions
    where event_id = 'dddddddd-0000-4000-8000-000000000001'),
  array['correction'],
  'the difference is posted as a correction'
);

select is(
  (select array_agg(distinct created_by) from public.point_transactions
    where event_id = 'dddddddd-0000-4000-8000-000000000001'),
  array['aaaaaaaa-0000-4000-8000-000000000003'::uuid],
  'the correction is attributed to the officer who changed the points'
);

select is(
  (select array_agg(distinct academic_term_id) from public.point_transactions
    where event_id = 'dddddddd-0000-4000-8000-000000000001'),
  array['eeeeeeee-0000-4000-8000-000000000001'::uuid],
  'the correction lands in the event''s term, where the award would have'
);

select is(
  (select array_agg(distinct description) from public.point_transactions
    where event_id = 'dddddddd-0000-4000-8000-000000000001'),
  array['Event points changed from 0 to 50'],
  'the member''s history says why their points moved'
);

select is(
  (select metadata from public.admin_audit_log
    where action = 'event.points_reawarded'
      and entity_id = 'dddddddd-0000-4000-8000-000000000001'),
  jsonb_build_object('title', 'Zero Point Meeting', 'from', 0, 'to', 50,
                     'members', 2, 'net_change', 100),
  'one audit row records how many members moved and by how much in total'
);

select is(
  (select actor_id from public.admin_audit_log
    where action = 'event.points_reawarded'
      and entity_id = 'dddddddd-0000-4000-8000-000000000001'),
  'aaaaaaaa-0000-4000-8000-000000000003'::uuid,
  'the audit row names the officer'
);


-- ── Lowering the points: 50 -> 30, with a removed attendee ──────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);
update public.events set points_value = 30 where id = 'dddddddd-0000-4000-8000-000000000002';
reset role;

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002'),
  30,
  'lowering the points takes the difference back'
);

select is(
  (select count(*)::int from public.point_transactions
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000002'),
  2,
  'the original award stays in the ledger beside its correction'
);

select is(
  (select amount from public.point_transactions
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and event_id = 'dddddddd-0000-4000-8000-000000000002'
      and transaction_type = 'event_attendance'),
  50,
  'and is not edited'
);

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000007', 'dddddddd-0000-4000-8000-000000000002'),
  0,
  'someone whose attendance was removed stays at zero'
);

select is(
  (select count(*)::int from public.point_transactions
    where member_id = 'aaaaaaaa-0000-4000-8000-000000000007'
      and event_id = 'dddddddd-0000-4000-8000-000000000002'),
  2,
  'and gets no new ledger row'
);

select is(
  (select metadata ->> 'net_change' from public.admin_audit_log
    where action = 'event.points_reawarded'
      and entity_id = 'dddddddd-0000-4000-8000-000000000002'),
  '-40',
  'the audit row counts only the members still on the roster'
);


-- ── Edits that don't change the points ──────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);
update public.events set title = 'Thirty Point Meeting' where id = 'dddddddd-0000-4000-8000-000000000002';
update public.events set points_value = 30, location = 'Lopata 101'
 where id = 'dddddddd-0000-4000-8000-000000000002';
reset role;

select is(
  (select count(*)::int from public.point_transactions
    where event_id = 'dddddddd-0000-4000-8000-000000000002'),
  -- Three awards, Lucia's reversal, and the two corrections from 50 -> 30.
  6,
  'saving an event without changing its points writes nothing to the ledger'
);

select is(
  (select count(*)::int from public.admin_audit_log
    where action = 'event.points_reawarded'
      and entity_id = 'dddddddd-0000-4000-8000-000000000002'),
  1,
  'nor to the audit log'
);

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);
update public.events set points_value = 25 where id = 'dddddddd-0000-4000-8000-000000000003';
reset role;

select is(
  (select count(*)::int from public.admin_audit_log
    where action = 'event.points_reawarded'
      and entity_id = 'dddddddd-0000-4000-8000-000000000003'),
  0,
  'changing the points of an event nobody attended re-awards no one'
);

select is(
  (select count(*)::int from public.admin_audit_log
    where action = 'event.points_changed'
      and entity_id = 'dddddddd-0000-4000-8000-000000000003'),
  1,
  'though the change itself is still audited as before'
);


-- ── Several changes in a row end at the latest value ────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);
update public.events set points_value = 0  where id = 'dddddddd-0000-4000-8000-000000000001';
reset role;

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001'),
  0,
  'setting the points back to 0 takes the whole award back'
);

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);
update public.events set points_value = 40 where id = 'dddddddd-0000-4000-8000-000000000001';
reset role;

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001'),
  40,
  'after several changes the attendee has exactly the current value'
);


-- ── Check-ins after a change, and who can make one ──────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);
select public.admin_add_attendance('dddddddd-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000007');
reset role;

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000007', 'dddddddd-0000-4000-8000-000000000001'),
  40,
  'someone checked in after the change is awarded the new value once'
);

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',
                  true);
update public.events set points_value = 999 where id = 'dddddddd-0000-4000-8000-000000000001';
reset role;

select is(
  (select points_value from public.events where id = 'dddddddd-0000-4000-8000-000000000001'),
  40,
  'a member cannot change an event''s points'
);

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001'),
  40,
  'so cannot award themselves anything through this'
);

select ok(
  not has_function_privilege('authenticated', 'private.reaward_event_points()', 'execute'),
  'the re-award function is not callable by members'
);

select ok(
  not has_function_privilege('authenticated',
                             'public.perform_check_in(uuid, uuid, public.checkin_method, uuid)',
                             'execute'),
  'perform_check_in is still internal'
);

-- A second session can't be opened from here to race a check-in against an
-- edit, so this guards the lock that prevents that race from being dropped by
-- a later redefinition of perform_check_in.
select ok(
  pg_get_functiondef('public.perform_check_in(uuid, uuid, public.checkin_method, uuid)'::regprocedure)
    ~* 'from public\.events e where e\.id = p_event_id for share',
  'perform_check_in reads the event FOR SHARE, so an edit waits for in-flight check-ins'
);


-- ── Removing someone after a change ─────────────────────────────────────────
--
-- Mateo checked in when the meeting was worth 0, so everything he has from it
-- is corrections: +50, -50, +40.

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);

create temporary table mateo_checkin as
select id from public.event_attendance
 where event_id = 'dddddddd-0000-4000-8000-000000000001'
   and member_id = 'aaaaaaaa-0000-4000-8000-000000000005';

select is(
  (public.admin_remove_attendance((select id from mateo_checkin), 'Left before it started')
     ->> 'reversed_points')::int,
  40,
  'removing an attendee reverses the corrections a points change posted, not just an award'
);

select throws_ok(
  $$select public.admin_remove_attendance((select id from mateo_checkin), 'Removed twice')$$,
  'P0002',
  'Attendance record not found',
  'a check-in that was already removed can''t be removed, and reversed, again'
);

reset role;

select is(
  public.test_event_net('aaaaaaaa-0000-4000-8000-000000000005', 'dddddddd-0000-4000-8000-000000000001'),
  0,
  'so the member ends at zero for the event, not below it'
);

-- As with perform_check_in, the races these prevent need a second session, so
-- the locks themselves are guarded here.
select ok(
  pg_get_functiondef('public.admin_remove_attendance(uuid, text)'::regprocedure)
    ~* 'from public\.events e where e\.id = v_att\.event_id for share',
  'admin_remove_attendance reads the event FOR SHARE, so it and a points change wait for each other'
);

select ok(
  pg_get_functiondef('public.admin_remove_attendance(uuid, text)'::regprocedure)
    ~* 'delete from public\.event_attendance a where a\.id = p_attendance_id;\s+if not found then',
  'admin_remove_attendance stops when a removal running alongside it deleted the check-in first'
);

select ok(
  position('delete from public.event_attendance'
           in pg_get_functiondef('public.admin_remove_attendance(uuid, text)'::regprocedure))
  < position('sum(pt.amount)'
             in pg_get_functiondef('public.admin_remove_attendance(uuid, text)'::regprocedure)),
  'admin_remove_attendance sums the ledger after the delete, so it sees what committed while it waited'
);


-- ── What the member sees ────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',
                  true);

create temporary table ana_summary as
select public.get_member_points_summary(null, 'eeeeeeee-0000-4000-8000-000000000001', null) as body;

select is(
  (select (body ->> 'total_points')::int from ana_summary),
  70,
  'the member''s total is the two events at their current values'
);

select is(
  (select (body ->> 'events_attended')::int from ana_summary),
  2,
  'and they attended two events'
);

select is(
  (select body -> 'by_category' -> 0 ->> 'events' from ana_summary),
  '2',
  'the category breakdown counts two events, not the five ledger rows behind them'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-4000-8000-000000000007","role":"authenticated"}',
                  true);

select is(
  public.get_member_points_summary(null, 'eeeeeeee-0000-4000-8000-000000000001', null)
    -> 'by_category' -> 0 ->> 'events',
  '1',
  'an event whose attendance was removed is not counted in the breakdown'
);

reset role;

select * from finish();
rollback;

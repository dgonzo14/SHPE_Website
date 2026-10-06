-- =============================================================================
-- leaderboard.test.sql — the points leaderboard
--
-- Run with:  supabase test db
--
-- Three properties are asserted here, each the way an attacker or a confused
-- client would hit them rather than the way the UI does:
--
--   1. Visibility is enforced by the database. With the switch off, a member
--      gets the switch position and nothing else, however they ask.
--   2. The board is a daily snapshot. Points earned after it was built do not
--      appear until the next day's rebuild (or an officer forcing one).
--   3. Only a name, a rank, a total and an event count leave the database.
--
-- The seeded development data has its own members and points, which would make
-- every rank below depend on seed.sql. So the suite starts by setting every
-- non-fixture profile inactive and installing its own active term -- inside
-- this transaction, which is rolled back at the end like every other suite.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

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

-- Everyone already in the database steps off the board for the duration.
update public.profiles set membership_status = 'inactive';

select public.test_create_user('bbbbbbbb-0000-4000-8000-000000000001', 'ana.rivera@wustl.edu',   'Ana',   'Rivera');
select public.test_create_user('bbbbbbbb-0000-4000-8000-000000000002', 'luis.mendez@wustl.edu',  'Luis',  'Mendez');
select public.test_create_user('bbbbbbbb-0000-4000-8000-000000000003', 'sofia.castro@wustl.edu', 'Sofia', 'Castro');
select public.test_create_user('bbbbbbbb-0000-4000-8000-000000000004', 'pat.pending@wustl.edu',  'Pat',   'Pending');
select public.test_create_user('bbbbbbbb-0000-4000-8000-000000000005', 'ivan.idle@wustl.edu',    'Ivan',  'Idle');
select public.test_create_user('bbbbbbbb-0000-4000-8000-000000000006', 'zoe.zero@wustl.edu',     'Zoe',   'Zero');

update public.profiles set membership_status = 'active'
 where id in ('bbbbbbbb-0000-4000-8000-000000000001',
              'bbbbbbbb-0000-4000-8000-000000000002',
              'bbbbbbbb-0000-4000-8000-000000000003',
              'bbbbbbbb-0000-4000-8000-000000000006');
update public.profiles set membership_status = 'inactive'
 where id = 'bbbbbbbb-0000-4000-8000-000000000005';
-- ...000004 stays pending, which is the registration default.

insert into public.member_roles (member_id, role)
values ('bbbbbbbb-0000-4000-8000-000000000003', 'officer');

-- One academic year of two terms, the first active, plus an older year.
update public.academic_terms set is_active = false;
insert into public.academic_terms (id, name, term_type, start_date, end_date, academic_year, is_active) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'Test Fall',   'fall',   '2090-08-20', '2090-12-15', 'TEST-YEAR', true),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Test Spring', 'spring', '2091-01-10', '2091-05-10', 'TEST-YEAR', false),
  ('eeeeeeee-0000-4000-8000-000000000003', 'Test Past',   'fall',   '2089-08-20', '2089-12-15', 'OLD-YEAR',  false);

insert into public.event_categories (id, name, slug, sort_order)
values ('cccccccc-0000-4000-8000-000000000009', 'Leaderboard Test', 'leaderboard-test', 1);

insert into public.events (id, title, category_id, academic_term_id, start_at, end_at, points_value, status)
values ('dddddddd-0000-4000-8000-000000000009', 'Leaderboard GBM',
        'cccccccc-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-000000000001',
        '2090-09-01 18:00-05', '2090-09-01 19:00-05', 30, 'published');

insert into public.event_attendance (event_id, member_id)
values ('dddddddd-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000001');

/*
 *                 Test Fall   Test Spring   Test Past   ->  term   year   all
 *   Ana               30           10           -           30     40     40
 *   Luis              30            -          50           30     30     80
 *   Sofia (officer)   10            -           -           10     10     10
 *   Pat (pending)    100            -           -           not ranked
 *   Ivan (inactive)   90            -           -           not ranked
 *   Zoe              +5 / -5        -           -           net 0, not ranked
 */
insert into public.point_transactions (member_id, academic_term_id, amount, transaction_type) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',  30, 'bonus'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002',  10, 'bonus'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001',  30, 'bonus'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000003',  50, 'bonus'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000001',  10, 'bonus'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'eeeeeeee-0000-4000-8000-000000000001', 100, 'bonus'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'eeeeeeee-0000-4000-8000-000000000001',  90, 'bonus'),
  ('bbbbbbbb-0000-4000-8000-000000000006', 'eeeeeeee-0000-4000-8000-000000000001',   5, 'bonus'),
  ('bbbbbbbb-0000-4000-8000-000000000006', 'eeeeeeee-0000-4000-8000-000000000001',  -5, 'correction');

-- Start from "never built", whatever the database had before.
delete from public.points_leaderboard where true;
delete from public.points_leaderboard_meta where true;

-- Readable by every role this suite switches to; the superuser reads it anyway.
create temporary table lb (label text primary key, body jsonb not null);
grant all on lb to anon, authenticated;


-- =============================================================================
-- NO SESSION
-- =============================================================================

set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$select public.get_points_leaderboard('term')$$,
  '42501', null,
  'anon cannot call the leaderboard at all'
);


-- =============================================================================
-- AS A PLAIN MEMBER (Ana)
-- =============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ── No back doors ───────────────────────────────────────────────────────────

select throws_ok(
  $$select * from public.points_leaderboard$$,
  '42501', null,
  'the snapshot table is unreachable directly: no grant, no policy'
);

select throws_ok(
  $$select * from public.points_leaderboard_meta$$,
  '42501', null,
  'the snapshot metadata is unreachable directly'
);

select throws_ok(
  $$select public.refresh_points_leaderboard()$$,
  '42501', null,
  'a member cannot call the unguarded rebuild'
);

select throws_ok(
  $$select public.admin_refresh_points_leaderboard()$$,
  '42501', null,
  'a member cannot force a rebuild'
);

select throws_ok(
  $$select public.admin_set_leaderboard_enabled(false)$$,
  '42501', null,
  'a member cannot hide the leaderboard'
);

select throws_ok(
  $$select public.get_points_leaderboard('everyone')$$,
  '22023', null,
  'an unknown scope is refused rather than widened'
);

-- ── Off until an officer turns it on ────────────────────────────────────────

select is(
  public.get_points_leaderboard('term'),
  '{"enabled": false}'::jsonb,
  'the leaderboard ships hidden: a member gets nothing until an officer turns it on'
);

select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.admin_set_leaderboard_enabled(true);
select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ── The first read builds the snapshot ──────────────────────────────────────

insert into lb values ('term',  public.get_points_leaderboard('term'));
insert into lb values ('year',  public.get_points_leaderboard('academic_year'));
insert into lb values ('all',   public.get_points_leaderboard('all_time'));

select isnt(
  (select body->>'refreshed_at' from lb where label = 'term'),
  null,
  'once it is on, the first read of the day builds the snapshot'
);

select is(
  (select body->>'term_name' from lb where label = 'term'),
  'Test Fall',
  'the term board is for the active term'
);

select is(
  (select jsonb_path_query_array(body, '$.entries[*].display_name') from lb where label = 'term'),
  '["Ana Rivera", "Luis Mendez", "Sofia Castro"]'::jsonb,
  'pending, inactive and net-zero members are not ranked'
);

select is(
  (select jsonb_path_query_array(body, '$.entries[*].rank') from lb where label = 'term'),
  '[1, 1, 3]'::jsonb,
  'a tie shares a place and the next place is skipped'
);

select is(
  (select (body->>'ranked_member_count')::int from lb where label = 'term'),
  3,
  'the ranked count matches the board'
);

select is(
  (select jsonb_path_query_array(body, '$.entries[*] ? (@.is_me == true).display_name')
     from lb where label = 'term'),
  '["Ana Rivera"]'::jsonb,
  'only the caller''s own row is marked as theirs'
);

select is(
  (select body->'me' from lb where label = 'term'),
  '{"rank": 1, "display_name": "Ana Rivera", "total_points": 30,
    "events_attended": 1, "is_me": true}'::jsonb,
  'the caller gets their own standing, with events attended this term'
);

select ok(
  not exists (
    select 1
      from lb, jsonb_array_elements(lb.body->'entries') e
     where e ? 'member_id' or e ? 'email' or e ? 'id'
  ),
  'no member id or email leaves the database'
);

select is(
  (select jsonb_path_query_array(body, '$.entries[*].total_points') from lb where label = 'year'),
  '[40, 30, 10]'::jsonb,
  'the academic-year board adds up every term in the active term''s year'
);

select is(
  (select jsonb_path_query_array(body, '$.entries[*].display_name') from lb where label = 'all'),
  '["Luis Mendez", "Ana Rivera", "Sofia Castro"]'::jsonb,
  'the all-time board includes past years'
);

-- ── It is a snapshot, not a live query ──────────────────────────────────────

reset role;
insert into public.point_transactions (member_id, academic_term_id, amount, transaction_type)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 100, 'bonus');
set local role authenticated;

select is(
  (public.get_points_leaderboard('term'))->'me'->'total_points',
  '30'::jsonb,
  'points earned after today''s build do not appear until the next one'
);

select is(
  (public.get_points_leaderboard('term'))->>'refreshed_at',
  (select body->>'refreshed_at' from lb where label = 'term'),
  'a second read the same day does not rebuild'
);

-- Wind the snapshot back to yesterday, as if midnight had passed.
reset role;
update public.points_leaderboard_meta set refreshed_at = now() - interval '1 day' where id;
set local role authenticated;

select is(
  (public.get_points_leaderboard('term'))->'entries'->0,
  '{"rank": 1, "display_name": "Ana Rivera", "total_points": 130,
    "events_attended": 1, "is_me": true}'::jsonb,
  'the first read after midnight rebuilds the board'
);


-- =============================================================================
-- MEMBERS WHO ARE NOT RANKED
-- =============================================================================

select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000004","role":"authenticated"}', true);

select throws_ok(
  $$select public.get_points_leaderboard('term')$$,
  '42501', null,
  'a pending account sees no other member, including on the leaderboard'
);

select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000005","role":"authenticated"}', true);

select is(
  (public.get_points_leaderboard('term'))->'me',
  'null'::jsonb,
  'an inactive member can look but is not on the board'
);


-- =============================================================================
-- THE SWITCH (Sofia, officer)
-- =============================================================================

select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$select public.admin_set_leaderboard_enabled(null)$$,
  '22023', null,
  'the switch only takes on or off'
);

select is(
  (public.admin_set_leaderboard_enabled(false))->>'enabled',
  'false',
  'an officer can hide the leaderboard'
);

select ok(
  exists (select 1 from public.admin_audit_log l
           where l.action = 'leaderboard.disabled'
             and l.actor_id = 'bbbbbbbb-0000-4000-8000-000000000003'),
  'hiding it is audited with the officer who did it'
);

select ok(
  jsonb_array_length((public.get_points_leaderboard('term'))->'entries') > 0,
  'an officer can still preview a hidden board'
);

select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.get_points_leaderboard('term'),
  '{"enabled": false}'::jsonb,
  'with the board hidden, a member gets the switch position and nothing else'
);

set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (public.get_app_config())->'leaderboard_enabled',
  'false'::jsonb,
  'the app config tells the portal the board is hidden'
);

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.admin_set_leaderboard_enabled(true);

select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  ((public.get_points_leaderboard('term'))->>'enabled')::boolean,
  true,
  'switching it back on shows it to members again'
);


-- =============================================================================
-- THE TOP OF THE BOARD
-- =============================================================================

-- 25 members who all outscore Ana's 130, on distinct totals 1000..1024.
reset role;
select set_config('request.jwt.claims', '', true);
select public.test_create_user(
         ('bbbbbbbb-0000-4000-8000-1000000000' || lpad(i::text, 2, '0'))::uuid,
         'filler' || i || '@wustl.edu', 'Filler', 'Number ' || lpad(i::text, 2, '0'))
  from generate_series(1, 25) as i;
update public.profiles set membership_status = 'active'
 where id::text like 'bbbbbbbb-0000-4000-8000-1000000000%';
insert into public.point_transactions (member_id, academic_term_id, amount, transaction_type)
select ('bbbbbbbb-0000-4000-8000-1000000000' || lpad(i::text, 2, '0'))::uuid,
       'eeeeeeee-0000-4000-8000-000000000001', 999 + i, 'bonus'
  from generate_series(1, 25) as i;

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000003","role":"authenticated"}', true);

select isnt(
  (public.admin_refresh_points_leaderboard())->>'refreshed_at',
  null,
  'an officer can force a rebuild'
);

select ok(
  exists (select 1 from public.admin_audit_log l
           where l.action = 'leaderboard.refreshed'
             and l.actor_id = 'bbbbbbbb-0000-4000-8000-000000000003'),
  'a forced rebuild is audited'
);

select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}', true);

delete from lb where label = 'top';
insert into lb values ('top', public.get_points_leaderboard('term'));

select is(
  (select jsonb_array_length(body->'entries') from lb where label = 'top'),
  25,
  'the board shows the top 25'
);

select is(
  (select jsonb_path_query_array(body, '$.entries[*] ? (@.is_me == true)') from lb where label = 'top'),
  '[]'::jsonb,
  'a member below the top 25 is not on the shared board...'
);

select is(
  (select (body->'me'->>'rank')::int from lb where label = 'top'),
  26,
  '...but still sees their own place'
);

-- A 26th filler tied with the 25th place. Claims cleared, or the profile
-- guard would see Ana's session and quietly keep this account pending.
reset role;
select set_config('request.jwt.claims', '', true);
select public.test_create_user('bbbbbbbb-0000-4000-8000-100000000026', 'filler26@wustl.edu', 'Filler', 'Number 26');
update public.profiles set membership_status = 'active'
 where id = 'bbbbbbbb-0000-4000-8000-100000000026';
insert into public.point_transactions (member_id, academic_term_id, amount, transaction_type)
values ('bbbbbbbb-0000-4000-8000-100000000026', 'eeeeeeee-0000-4000-8000-000000000001', 1000, 'bonus');

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.admin_refresh_points_leaderboard();

select is(
  jsonb_array_length((public.get_points_leaderboard('term'))->'entries'),
  26,
  'a tie at 25th place is shown whole rather than cut alphabetically'
);


-- =============================================================================
-- DELETION
-- =============================================================================

reset role;
select set_config('request.jwt.claims', '', true);
delete from auth.users where id = 'bbbbbbbb-0000-4000-8000-000000000002';

select is(
  (select count(*)::int from public.points_leaderboard
    where member_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0,
  'a deleted member leaves the board at once, not at the next rebuild'
);

select * from finish();
rollback;

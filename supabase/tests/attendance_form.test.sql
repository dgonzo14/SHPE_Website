-- =============================================================================
-- attendance_form.test.sql — checking in through the public attendance form
--
-- Run with:  supabase test db
--
-- 20260918000002 lets anyone holding an event's attendance link check in with
-- a name and an email address, no account. The link is the only credential,
-- so what this suite asserts is everything that keeps it from being more than
-- that:
--
--   1. Nobody reaches the tables directly. The form is two functions anon can
--      call; the link and the responses are officers' business.
--   2. The link is an officer's to create, read back and replace. Creating
--      never replaces a link that exists, so a second officer can't kill the
--      QR code the first is projecting; a replaced link stops working at once.
--      The audit log records that it happened, never the token.
--   3. The form takes responses only inside the event's check-in window, and a
--      response becomes attendance through perform_check_in(): one row, one
--      award, however often it is sent and whatever checked the member in
--      first.
--   4. Every accepted response gets the same answer, matched to an account or
--      not, so the link can't be used to find out who has one.
--   5. A waiting response is picked up when an account appears with that
--      address, at signup or on an email change, and a claim that fails never
--      costs anyone their signup. A response that is on nobody's roster --
--      its attendance removed, or left waiting by a signup in the same instant
--      -- is checked in when the address sends the form again, so "you're
--      checked in" is never said over nothing.
--   6. Officers sort out the rest by hand: entering someone themselves,
--      linking, deleting, and clearing out what a leaked link let in. A link
--      can only write so much, and replacing it brings the form back.
--
-- Like every suite, this runs in one transaction and is rolled back.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(178);

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

-- Audit rows for one action on one entity.
create or replace function public.test_audits(p_action text, p_entity uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.admin_audit_log l
   where l.action = p_action and l.entity_id = p_entity;
$$;

-- A member's attendance at one event and what it earned, read past RLS. One
-- string, so "exactly one row, one award, through the form" is one assertion.
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

-- Everyone checked in to an event, by any method.
create or replace function public.test_attendees(p_event uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.event_attendance a where a.event_id = p_event;
$$;

-- Every response to an event, waiting or not.
create or replace function public.test_responses(p_event uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.event_attendance_submissions s where s.event_id = p_event;
$$;

-- Where the response from one (normalised) address to one event stands. A
-- claimed response has to point at that member's attendance at that event and
-- say when it was claimed; anything short of that is spelled out, so a failure
-- says what is wrong rather than just "not equal".
create or replace function public.test_response(p_event uuid, p_email text) returns text
language sql security definer set search_path = '' as $$
  select case
           when s.id is null                       then 'no response'
           when s.member_id is null
            and s.attendance_id is null            then 'waiting'
           when s.member_id is null                then 'waiting, but still pointing at attendance'
           when s.attendance_id is null            then 'on a member but no attendance'
           when s.attendance_id is distinct from a.id then 'pointing at the wrong attendance row'
           when s.claimed_at is null               then 'claimed without claimed_at'
           else 'claimed by ' || s.member_id::text
         end
    from (select 1) as one
    left join public.event_attendance_submissions s
           on s.event_id = p_event and s.email_normalized = p_email
    left join public.event_attendance a
           on a.event_id = s.event_id and a.member_id = s.member_id;
$$;

-- A response's id, which a member couldn't read for themselves, so that the
-- officer functions can be called with a real one whoever is signed in.
create or replace function public.test_response_id(p_event uuid, p_email text) returns uuid
language sql security definer set search_path = '' as $$
  select s.id from public.event_attendance_submissions s
   where s.event_id = p_event and s.email_normalized = p_email;
$$;

-- A member's attendance row at one event, so an officer can remove it.
create or replace function public.test_attendance_id(p_member uuid, p_event uuid) returns uuid
language sql security definer set search_path = '' as $$
  select a.id from public.event_attendance a
   where a.member_id = p_member and a.event_id = p_event;
$$;

-- Who verified a member's attendance at one event: the officer, for attendance
-- an officer entered; null for a check-in the member made themselves.
create or replace function public.test_verified_by(p_member uuid, p_event uuid) returns uuid
language sql security definer set search_path = '' as $$
  select a.verified_by from public.event_attendance a
   where a.member_id = p_member and a.event_id = p_event;
$$;

-- The officer who typed a response in, or null for one that came through the
-- form.
create or replace function public.test_added_by(p_event uuid, p_email text) returns uuid
language sql security definer set search_path = '' as $$
  select s.added_by from public.event_attendance_submissions s
   where s.event_id = p_event and s.email_normalized = p_email;
$$;

-- A member's point rows for one event, each as "type amount", so a removal and
-- a second check-in read as the awards and the correction they are. Ordered by
-- type then amount: inside one transaction every row has the same timestamp.
create or replace function public.test_ledger(p_member uuid, p_event uuid) returns text
language sql security definer set search_path = '' as $$
  select coalesce(string_agg(format('%s %s', t.transaction_type, t.amount), ', '
                             order by t.transaction_type, t.amount), 'none')
    from public.point_transactions t
   where t.member_id = p_member and t.event_id = p_event;
$$;

grant execute on function public.test_login(uuid)               to anon, authenticated;
grant execute on function public.test_audits(text, uuid)        to anon, authenticated;
grant execute on function public.test_attendance(uuid, uuid)    to anon, authenticated;
grant execute on function public.test_attendees(uuid)           to anon, authenticated;
grant execute on function public.test_responses(uuid)           to anon, authenticated;
grant execute on function public.test_response(uuid, text)      to anon, authenticated;
grant execute on function public.test_response_id(uuid, text)   to anon, authenticated;
grant execute on function public.test_attendance_id(uuid, uuid) to anon, authenticated;
grant execute on function public.test_verified_by(uuid, uuid)   to anon, authenticated;
grant execute on function public.test_added_by(uuid, text)      to anon, authenticated;
grant execute on function public.test_ledger(uuid, uuid)        to anon, authenticated;

select public.test_login(null);

select public.test_create_user('adad0000-0000-4000-8000-000000000001', 'otilia.ortega@wustl.edu', 'Otilia', 'Ortega');
select public.test_create_user('adad0000-0000-4000-8000-000000000002', 'amalia.arce@wustl.edu',   'Amalia', 'Arce');
select public.test_create_user('adad0000-0000-4000-8000-000000000003', 'bruno.blanco@wustl.edu',  'Bruno',  'Blanco');
select public.test_create_user('adad0000-0000-4000-8000-000000000004', 'carla.cruz@wustl.edu',    'Carla',  'Cruz');
select public.test_create_user('adad0000-0000-4000-8000-000000000005', 'elsa.vieja@wustl.edu',    'Elsa',   'Estrada');
select public.test_create_user('adad0000-0000-4000-8000-000000000006', 'dora.duran@wustl.edu',    'Dora',   'Durán');
select public.test_create_user('adad0000-0000-4000-8000-00000000000a', 'ramona.reyes@wustl.edu',  'Ramona', 'Reyes');
-- A second officer, for two people pressing the same button.
select public.test_create_user('adad0000-0000-4000-8000-00000000000b', 'olga.osorio@wustl.edu',   'Olga',   'Osorio');
-- ...07 (Nuria), ...08 (Tito), ...09 (Dora's second account), ...0c (Quique)
-- and ...0d (Paco) sign up partway through, and stay pending: that is the
-- registration default, and the form is meant to work for people who aren't
-- members yet.

update public.profiles set membership_status = 'active'
 where id::text like 'adad0000-0000-4000-8000-00000000000%';

insert into public.member_roles (member_id, role)
values ('adad0000-0000-4000-8000-000000000001', 'officer'),
       ('adad0000-0000-4000-8000-00000000000b', 'officer')
on conflict do nothing;

insert into public.event_categories (id, name, slug, sort_order)
values ('adad0000-0000-4000-8000-0000000c0001', 'Form Test Category', 'form-test-category', 1);

-- Check-in opens 30 minutes before start_at and closes 30 minutes after
-- end_at, so "open" below means now is inside that window.
insert into public.events (id, title, category_id, start_at, end_at, points_value, status, created_by)
values
  ('adad0000-0000-4000-8000-000000000101', 'Open GBM',           'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'published', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000102', 'Future Workshop',    'adad0000-0000-4000-8000-0000000c0001',
   now() + interval '6 hours', now() + interval '8 hours', 5, 'published', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000103', 'Past Social',        'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 5, 'published', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000104', 'Draft Meeting',      'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'draft', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000105', 'Cancelled Tabling',  'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'cancelled', 'adad0000-0000-4000-8000-000000000001'),
  -- Marked completed while its window would still be open.
  ('adad0000-0000-4000-8000-000000000106', 'Completed Panel',    'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'completed', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000107', 'Broken Claim Night', 'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'published', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000108', 'Crowded Mixer',      'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'published', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000110', 'Second Chance Night', 'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'published', 'adad0000-0000-4000-8000-000000000001'),
  -- Over, its window closed days ago: officers enter responses after the fact.
  ('adad0000-0000-4000-8000-000000000111', 'Late Sign-in Social', 'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 5, 'published', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000113', 'Leaked Link Mixer',  'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 10, 'published', 'adad0000-0000-4000-8000-000000000001'),
  -- Never given a link.
  ('adad0000-0000-4000-8000-000000000109', 'Study Hall',         'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 5, 'published', 'adad0000-0000-4000-8000-000000000001'),
  ('adad0000-0000-4000-8000-000000000112', 'Rotation Clinic',    'adad0000-0000-4000-8000-0000000c0001',
   now() - interval '10 minutes', now() + interval '1 hour', 5, 'published', 'adad0000-0000-4000-8000-000000000001');

create temporary table links (label text primary key, token text not null);
create temporary table answers (label text primary key, body jsonb not null);
grant all on links, answers to anon, authenticated;

-- Links are issued through the officer RPC, exactly as the app does it.
set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');

insert into links (label, token)
select e.label, public.admin_rotate_attendance_link(e.id) ->> 'token'
  from (values
    ('open',      'adad0000-0000-4000-8000-000000000101'::uuid),
    ('future',    'adad0000-0000-4000-8000-000000000102'::uuid),
    ('past',      'adad0000-0000-4000-8000-000000000103'::uuid),
    ('draft',     'adad0000-0000-4000-8000-000000000104'::uuid),
    ('cancelled', 'adad0000-0000-4000-8000-000000000105'::uuid),
    ('completed', 'adad0000-0000-4000-8000-000000000106'::uuid),
    ('broken',    'adad0000-0000-4000-8000-000000000107'::uuid),
    ('crowded',   'adad0000-0000-4000-8000-000000000108'::uuid),
    ('second',    'adad0000-0000-4000-8000-000000000110'::uuid),
    ('leaked',    'adad0000-0000-4000-8000-000000000113'::uuid)
  ) as e(label, id);

reset role;
select public.test_login(null);


-- =============================================================================
-- 1. NOBODY REACHES THE TABLES DIRECTLY
-- =============================================================================

select ok(
  not has_table_privilege('anon', 'public.event_attendance_links',
                          'select, insert, update, delete, truncate, references, trigger'),
  'anon holds no privilege at all on attendance links');

select ok(
  not has_table_privilege('anon', 'public.event_attendance_submissions',
                          'select, insert, update, delete, truncate, references, trigger'),
  'nor on the responses');

select ok(
  not has_table_privilege('authenticated', 'public.event_attendance_links',
                          'select, insert, update, delete, truncate, references, trigger'),
  'signed in, the links table is still out of reach: officers read a token through admin_attendance_link()');

select ok(
  has_table_privilege('authenticated', 'public.event_attendance_submissions', 'select')
  and not has_table_privilege('authenticated', 'public.event_attendance_submissions',
                              'insert, update, delete, truncate, references, trigger'),
  'signed-in callers may only select responses (RLS narrows that to officers); every write goes through a function');

select ok(
  has_function_privilege('anon', 'public.get_attendance_form(text)', 'execute')
  and has_function_privilege('anon', 'public.submit_event_attendance(text, text, text, text)', 'execute'),
  'the form itself is open to anyone holding the link');

select ok(
  not has_function_privilege('anon', 'public.admin_rotate_attendance_link(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_attendance_link(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_link_attendance_submission(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_delete_attendance_submission(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_rotate_attendance_link(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_attendance_link(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_link_attendance_submission(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_delete_attendance_submission(uuid)', 'execute'),
  'signed-in callers can reach the officer functions (each checks for an officer itself); anon cannot');

select ok(
  not has_function_privilege('anon', 'public.admin_create_attendance_link(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_add_attendance_submission(uuid, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_delete_waiting_submissions(uuid, timestamptz)', 'execute'),
  'anon cannot create a link, enter a response or clear waiting ones');

select ok(
  has_function_privilege('authenticated', 'public.admin_create_attendance_link(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_add_attendance_submission(uuid, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_delete_waiting_submissions(uuid, timestamptz)', 'execute'),
  'signed-in callers can reach all three, and each checks for an officer itself');

select ok(
  not has_function_privilege('anon', 'private.claim_attendance_submission(uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.claim_attendance_submission(uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'private.claim_pending_attendance()', 'execute')
  and not has_function_privilege('authenticated', 'private.claim_pending_attendance()', 'execute'),
  'the claim helpers are internal: no client can put a response on someone''s record');


-- =============================================================================
-- 2. THE LINK IS AN OFFICER'S TO CREATE, READ AND REPLACE
-- =============================================================================

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');

select matches(
  (select token from links where label = 'open'),
  '^[0-9a-f]{32}$',
  'a new link''s token is 32 lowercase hex characters');

select is(public.test_audits('event.attendance_link_created', 'adad0000-0000-4000-8000-000000000101'), 1,
  'creating a link is audited');

select is(
  public.admin_attendance_link('adad0000-0000-4000-8000-000000000101') ->> 'token',
  (select token from links where label = 'open'),
  'an officer can read the link back whenever they need it, not only once');

select is(
  public.admin_attendance_link('adad0000-0000-4000-8000-000000000109'),
  '{"has_link": false, "token": null, "updated_at": null}'::jsonb,
  'an event without a link says so');

select throws_ok(
  $$select public.admin_rotate_attendance_link('adad0000-0000-4000-8000-0000000001ff')$$,
  'P0002', 'Event not found',
  'there is no link for an event that doesn''t exist');

select throws_ok(
  $$select * from public.event_attendance_links$$,
  '42501', null,
  'not even an officer selects tokens from the table directly');

-- A plain member.
select public.test_login('adad0000-0000-4000-8000-000000000004');

select throws_ok(
  $$select public.admin_rotate_attendance_link('adad0000-0000-4000-8000-000000000101')$$,
  '42501', null,
  'a member cannot create or replace a link');

select throws_ok(
  $$select public.admin_attendance_link('adad0000-0000-4000-8000-000000000101')$$,
  '42501', null,
  'nor read one back');

-- The officer replaces the link, as they would after it leaked.
select public.test_login('adad0000-0000-4000-8000-000000000001');

insert into links (label, token) select 'replaced', token from links where label = 'open';
update links
   set token = public.admin_rotate_attendance_link('adad0000-0000-4000-8000-000000000101') ->> 'token'
 where label = 'open';

select isnt(
  (select token from links where label = 'open'),
  (select token from links where label = 'replaced'),
  'replacing a link issues a new token');

select is(public.test_audits('event.attendance_link_rotated', 'adad0000-0000-4000-8000-000000000101'), 1,
  'which is audited as a replacement, not a second creation');

select is(
  public.admin_attendance_link('adad0000-0000-4000-8000-000000000101') ->> 'token',
  (select token from links where label = 'open'),
  'reading the link back now gives the replacement');

-- Creating never replaces. Two officers open the roster before a meeting, both
-- see no link and both press Create: the second has to get the first one's
-- link back, not a new one that kills the QR code already on the screen.
insert into answers (label, body)
values ('created', public.admin_create_attendance_link('adad0000-0000-4000-8000-000000000109'));
insert into links (label, token)
select 'study', body ->> 'token' from answers where label = 'created';

select is(
  (select body - 'token' - 'updated_at' from answers where label = 'created'),
  '{"has_link": true, "created": true}'::jsonb,
  'creating a link where there is none makes one, and says it did');

select matches((select token from links where label = 'study'), '^[0-9a-f]{32}$',
  'with a token like any other');

select is(public.test_audits('event.attendance_link_created', 'adad0000-0000-4000-8000-000000000109'), 1,
  'and is audited once');

-- The second officer presses Create ten minutes later. now() stands still
-- inside a test's transaction, so the link is made ten minutes older instead.
reset role;
update public.event_attendance_links
   set created_at = created_at - interval '10 minutes',
       updated_at = updated_at - interval '10 minutes'
 where event_id = 'adad0000-0000-4000-8000-000000000109';
set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-00000000000b');

insert into answers (label, body)
values ('created_again', public.admin_create_attendance_link('adad0000-0000-4000-8000-000000000109'));

select is(
  (select body ->> 'token' from answers where label = 'created_again'),
  (select token from links where label = 'study'),
  'a second officer pressing Create gets the same link back, not a new one');

select is((select body ->> 'created' from answers where label = 'created_again'), 'false',
  'and is told it already existed, so the page can say so');

select is(
  (select (body ->> 'updated_at')::timestamptz from answers where label = 'created_again'),
  now() - interval '10 minutes',
  'with the time it was made, which a second Create leaves alone (the cap counts from it)');

select is(
  public.admin_attendance_link('adad0000-0000-4000-8000-000000000109') ->> 'token',
  (select token from links where label = 'study'),
  'the link on file is still the one the first officer made');

select is(
  public.test_audits('event.attendance_link_created', 'adad0000-0000-4000-8000-000000000109')
  + public.test_audits('event.attendance_link_rotated', 'adad0000-0000-4000-8000-000000000109'),
  1,
  'and nothing more is audited, since nothing happened');

select throws_ok(
  $$select public.admin_create_attendance_link('adad0000-0000-4000-8000-0000000001ff')$$,
  'P0002', 'Event not found',
  'there is no link to create for an event that doesn''t exist');

select public.test_login('adad0000-0000-4000-8000-000000000004');

select throws_ok(
  $$select public.admin_create_attendance_link('adad0000-0000-4000-8000-000000000109')$$,
  '42501', null,
  'a member cannot create a link either');

-- Replacing says whether there was a link to replace.
select public.test_login('adad0000-0000-4000-8000-000000000001');

insert into answers (label, body)
values ('clinic_first', public.admin_rotate_attendance_link('adad0000-0000-4000-8000-000000000112'));
insert into answers (label, body)
values ('clinic_second', public.admin_rotate_attendance_link('adad0000-0000-4000-8000-000000000112'));
insert into links (label, token)
select label, body ->> 'token' from answers where label in ('clinic_first', 'clinic_second');

select is(
  (select string_agg(body ->> 'created', ', ' order by label) from answers
    where label in ('clinic_first', 'clinic_second')),
  'true, false',
  'replacing where there is no link reports a creation; replacing one that exists doesn''t');

select is(
  format('created=%s rotated=%s',
    public.test_audits('event.attendance_link_created', 'adad0000-0000-4000-8000-000000000112'),
    public.test_audits('event.attendance_link_rotated', 'adad0000-0000-4000-8000-000000000112')),
  'created=1 rotated=1',
  'and the audit log agrees: one creation, one replacement');

select is(
  public.admin_attendance_link('adad0000-0000-4000-8000-000000000112') ->> 'token',
  (select token from links where label = 'clinic_second'),
  'the second press replaced the first one''s link');

select is(
  (select count(*)::int from public.admin_audit_log l, links k
    where l.metadata::text like '%' || k.token || '%'),
  0,
  'no audit row carries a token, old or new');

set local role anon;
select public.test_login(null);

select is(
  public.get_attendance_form((select token from links where label = 'replaced')),
  '{"status": "not_found"}'::jsonb,
  'the replaced link stops working at once');

select is(
  public.submit_event_attendance((select token from links where label = 'replaced'),
                                 'Rita', 'Ruiz', 'rita.ruiz@wustl.edu') ->> 'code',
  'FORM_NOT_FOUND',
  'and takes no responses');


-- =============================================================================
-- 3. WHAT THE FORM SHOWS (no session)
-- =============================================================================

select is(public.get_attendance_form('not-a-token'), '{"status": "not_found"}'::jsonb,
  'a malformed token finds nothing');

select is(public.get_attendance_form(repeat('0', 32)), '{"status": "not_found"}'::jsonb,
  'nor does a well-formed token nobody issued');

select is(
  public.get_attendance_form((select token from links where label = 'draft')),
  '{"status": "not_found"}'::jsonb,
  'a draft event''s link looks exactly like a link that doesn''t exist');

select is(public.get_attendance_form((select token from links where label = 'open')) ->> 'status', 'open',
  'inside the check-in window the form is open');

select is(public.get_attendance_form((select token from links where label = 'open')) -> 'event' ->> 'title',
  'Open GBM',
  'and names the event');

select is(public.get_attendance_form((select token from links where label = 'future')) ->> 'status', 'not_open',
  'before the window it says not yet');

select is(
  (public.get_attendance_form((select token from links where label = 'future')) ->> 'opens_at')::timestamptz,
  now() + interval '6 hours' - interval '30 minutes',
  'with when it opens, so the page can say so before anyone types anything');

select is(public.get_attendance_form((select token from links where label = 'past')) ->> 'status', 'closed',
  'after the window it says closed');

select is(public.get_attendance_form((select token from links where label = 'completed')) ->> 'status', 'closed',
  'a completed event is closed even inside its window');

select is(public.get_attendance_form((select token from links where label = 'cancelled')) ->> 'status', 'cancelled',
  'a cancelled event says so');

select is(
  public.get_attendance_form('  ' || upper((select token from links where label = 'open')) || ' ') ->> 'status',
  'open',
  'a token pasted in capitals or with stray spaces still works');


-- =============================================================================
-- 4. AN ADDRESS THAT BELONGS TO AN ACCOUNT
-- =============================================================================

insert into answers (label, body)
values ('matched',
        public.submit_event_attendance((select token from links where label = 'open'),
                                       'Amalia', 'Arce', 'Amalia.Arce+GBM@WUSTL.edu'));

select is((select body from answers where label = 'matched'),
  '{"ok": true, "event_title": "Open GBM"}'::jsonb,
  'an address belonging to an account is accepted, whatever its case or +tag');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000002', 'adad0000-0000-4000-8000-000000000101'),
  'rows=1 method=form awards=1 points=10',
  'and checks that member in at once, through the form, with the event''s points');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'amalia.arce@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000002',
  'the response is kept, pointing at the attendance it created');


-- =============================================================================
-- 5. SOMEONE ALREADY CHECKED IN
-- =============================================================================

reset role;
select public.perform_check_in('adad0000-0000-4000-8000-000000000003',
                               'adad0000-0000-4000-8000-000000000101', 'code', null);
set local role anon;

select is(
  public.submit_event_attendance((select token from links where label = 'open'),
                                 'Bruno', 'Blanco', 'bruno.blanco@wustl.edu'),
  '{"ok": true, "event_title": "Open GBM"}'::jsonb,
  'someone already checked in by code can still fill in the form');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000003', 'adad0000-0000-4000-8000-000000000101'),
  'rows=1 method=code awards=1 points=10',
  'without a second attendance row or a second award');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'bruno.blanco@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000003',
  'and the response is linked to the attendance they already had');


-- =============================================================================
-- 6. AN ADDRESS WITH NO ACCOUNT GETS THE SAME ANSWER
-- =============================================================================

insert into answers (label, body)
values ('unknown',
        public.submit_event_attendance((select token from links where label = 'open'),
                                       'Nuria', 'Nueva', 'Nuria.Nueva+gbm@wustl.edu'));

select is(
  (select array_agg(k order by k) from answers a, jsonb_object_keys(a.body) k where a.label = 'unknown'),
  (select array_agg(k order by k) from answers a, jsonb_object_keys(a.body) k where a.label = 'matched'),
  'an address with no account gets an answer with exactly the same keys');

select is(
  (select body from answers where label = 'unknown'),
  (select body from answers where label = 'matched'),
  'and the same values: the form never says whether an account matched');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'nuria.nueva@wustl.edu'),
  'waiting',
  'the response waits for an account');

select is(public.test_attendees('adad0000-0000-4000-8000-000000000101'), 2,
  'and no attendance is written for it');


-- =============================================================================
-- 7. SENDING IT TWICE
-- =============================================================================

select is(
  public.submit_event_attendance((select token from links where label = 'open'),
                                 'Nuria', 'Nueva', 'NURIA.NUEVA@wustl.edu'),
  '{"ok": true, "event_title": "Open GBM"}'::jsonb,
  'sending the same address again, differently cased, gets the same answer');

select is(
  public.submit_event_attendance((select token from links where label = 'open'),
                                 'Amalia', 'Arce', 'amalia.arce@wustl.edu'),
  '{"ok": true, "event_title": "Open GBM"}'::jsonb,
  'so does a matched address sent twice');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000002', 'adad0000-0000-4000-8000-000000000101'),
  'rows=1 method=form awards=1 points=10',
  'which earns nothing more');

select is(public.test_responses('adad0000-0000-4000-8000-000000000101'), 3,
  'and neither repeat adds a response');


-- =============================================================================
-- 8. ONLY INSIDE THE WINDOW, ONLY WELL-FORMED
-- =============================================================================

select is(
  public.submit_event_attendance((select token from links where label = 'future'),
                                 'Rita', 'Ruiz', 'rita.ruiz@wustl.edu') ->> 'code',
  'FORM_NOT_OPEN',
  'a response before the window is turned away as not open yet');

select is(
  public.submit_event_attendance((select token from links where label = 'past'),
                                 'Rita', 'Ruiz', 'rita.ruiz@wustl.edu') ->> 'code',
  'FORM_CLOSED',
  'after the window, as closed');

select is(
  public.submit_event_attendance((select token from links where label = 'completed'),
                                 'Rita', 'Ruiz', 'rita.ruiz@wustl.edu') ->> 'code',
  'FORM_CLOSED',
  'a completed event is closed to the form even inside its window');

select is(
  public.submit_event_attendance((select token from links where label = 'cancelled'),
                                 'Rita', 'Ruiz', 'rita.ruiz@wustl.edu') ->> 'code',
  'EVENT_CANCELLED',
  'a cancelled event says it was cancelled');

select is(
  public.submit_event_attendance((select token from links where label = 'draft'),
                                 'Rita', 'Ruiz', 'rita.ruiz@wustl.edu') ->> 'code',
  'FORM_NOT_FOUND',
  'a draft event''s link takes nothing');

select is(
  public.submit_event_attendance('not-a-token', 'Rita', 'Ruiz', 'rita.ruiz@wustl.edu') ->> 'code',
  'FORM_NOT_FOUND',
  'nor does a malformed token');

select is(
  public.test_responses('adad0000-0000-4000-8000-000000000102')
  + public.test_responses('adad0000-0000-4000-8000-000000000103')
  + public.test_responses('adad0000-0000-4000-8000-000000000104')
  + public.test_responses('adad0000-0000-4000-8000-000000000105')
  + public.test_responses('adad0000-0000-4000-8000-000000000106'),
  0,
  'a refused response leaves nothing behind');

select throws_ok(
  $$select public.submit_event_attendance((select token from links where label = 'open'),
                                          '   ', 'Ruiz', 'rita.ruiz@wustl.edu')$$,
  '22023', 'Enter your first name',
  'a blank first name is refused');

select throws_ok(
  $$select public.submit_event_attendance((select token from links where label = 'open'),
                                          'Rita', '', 'rita.ruiz@wustl.edu')$$,
  '22023', 'Enter your last name',
  'so is a blank last name');

select throws_ok(
  $$select public.submit_event_attendance((select token from links where label = 'open'),
                                          'Rita', 'Ruiz', 'rita.ruiz')$$,
  '22023', 'Enter a valid email address',
  'and an address that isn''t one');

select is(public.test_responses('adad0000-0000-4000-8000-000000000101'), 3,
  'and nothing is written for refused input');


-- =============================================================================
-- 9. WHO CAN READ THE RESPONSES
-- =============================================================================

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from public.event_attendance_submissions s
    where s.event_id = 'adad0000-0000-4000-8000-000000000101' and s.member_id is null),
  1,
  'an officer can read the waiting responses');

select public.test_login('adad0000-0000-4000-8000-000000000002');

select is((select count(*)::int from public.event_attendance_submissions), 0,
  'a member reads no responses, not even their own');

select throws_ok(
  $$insert into public.event_attendance_submissions (event_id, first_name, last_name, email)
    values ('adad0000-0000-4000-8000-000000000101', 'Amalia', 'Arce', 'amalia.otra@wustl.edu')$$,
  '42501', null,
  'nor writes one directly');

set local role anon;
select public.test_login(null);

select throws_ok(
  $$select * from public.event_attendance_submissions$$,
  '42501', null,
  'anon cannot read responses at all');


-- =============================================================================
-- 10. A WAITING RESPONSE IS CLAIMED AT SIGNUP
-- =============================================================================

-- She answered as Nuria.Nueva+gbm@ and registers without the tag.
reset role;
select public.test_login(null);
select public.test_create_user('adad0000-0000-4000-8000-000000000007', 'nuria.nueva@wustl.edu', 'Nuria', 'Nueva');

select is(
  (select membership_status::text from public.profiles where id = 'adad0000-0000-4000-8000-000000000007'),
  'pending',
  'Nuria''s new account is pending, like every new account');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000007', 'adad0000-0000-4000-8000-000000000101'),
  'rows=1 method=form awards=1 points=10',
  'and her waiting response is already on it, points included');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'nuria.nueva@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000007',
  'the response is claimed by the account, matched past the case and the +tag');

select is(
  (select count(*)::int from public.admin_audit_log l
    where l.action = 'attendance.claimed'
      and l.entity_type = 'event'
      and l.entity_id = 'adad0000-0000-4000-8000-000000000101'
      and l.actor_id is null
      and l.metadata ->> 'member_id' = 'adad0000-0000-4000-8000-000000000007'
      and (l.metadata ->> 'points_awarded')::int = 10),
  1,
  'the claim is audited once, as the system''s doing, with no actor');


-- =============================================================================
-- 11. A CLAIM THAT FAILS NEVER FAILS THE SIGNUP
-- =============================================================================

-- Tito answers two forms before he has an account.
set local role anon;
select public.submit_event_attendance((select token from links where label = 'broken'),
                                      'Tito', 'Trigo', 'tito.trigo@wustl.edu');
select public.submit_event_attendance((select token from links where label = 'open'),
                                      'Tito', 'Trigo', 'tito.trigo@wustl.edu');
reset role;

-- Something about one event makes its attendance impossible to write. Whatever
-- the real cause would be, the signup it happens inside has to survive it.
create function public.test_refuse_attendance() returns trigger language plpgsql as $$
begin
  if new.event_id = 'adad0000-0000-4000-8000-000000000107' then
    raise exception 'attendance for this event is refused by the test';
  end if;
  return new;
end;
$$;

create trigger test_refuse_attendance
  before insert on public.event_attendance
  for each row execute function public.test_refuse_attendance();

select lives_ok(
  $$select public.test_create_user('adad0000-0000-4000-8000-000000000008', 'tito.trigo@wustl.edu', 'Tito', 'Trigo')$$,
  'a claim that fails doesn''t fail the signup');

select ok(exists (select 1 from public.profiles where id = 'adad0000-0000-4000-8000-000000000008'),
  'Tito''s account and profile exist');

select is(public.test_response('adad0000-0000-4000-8000-000000000107', 'tito.trigo@wustl.edu'),
  'waiting',
  'the response that couldn''t be claimed is still waiting, not lost');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'tito.trigo@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000008',
  'and his other response still landed: one bad claim doesn''t cost the rest');

drop trigger test_refuse_attendance on public.event_attendance;
drop function public.test_refuse_attendance();


-- =============================================================================
-- 12. ... AND WHEN AN ACCOUNT CHANGES TO THAT ADDRESS
-- =============================================================================

set local role anon;
select public.submit_event_attendance((select token from links where label = 'open'),
                                      'Elsa', 'Estrada', 'elsa.nueva@wustl.edu');
reset role;
select public.test_login(null);

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'elsa.nueva@wustl.edu'),
  'waiting',
  'a response from an address no account has yet waits');

-- Carla tries to take it by writing that address onto her own profile. The
-- claim follows profiles.email, so this has to stay the address Auth signs in
-- with: profiles_guard_protected_columns() puts hers back before the claim
-- trigger looks.
set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000004');
update public.profiles set email = 'elsa.nueva@wustl.edu'
 where id = 'adad0000-0000-4000-8000-000000000004';
reset role;
select public.test_login(null);

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'elsa.nueva@wustl.edu'),
  'waiting',
  'a member who edits their own profile to someone else''s address claims nothing');

-- The member confirms a new address in Auth; handle_user_email_change() copies
-- it to her profile.
update auth.users set email = 'elsa.nueva@wustl.edu'
 where id = 'adad0000-0000-4000-8000-000000000005';

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'elsa.nueva@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000005',
  'changing an account''s address claims what was waiting for the new one');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000005', 'adad0000-0000-4000-8000-000000000101'),
  'rows=1 method=form awards=1 points=10',
  'attendance and points included');


-- =============================================================================
-- 13. AN OFFICER LINKS A RESPONSE BY HAND
-- =============================================================================

-- Carla and Amalia each answered with a personal address as well.
set local role anon;
select public.submit_event_attendance((select token from links where label = 'open'),
                                      'Carla', 'Cruz', 'carla.personal@example.com');
select public.submit_event_attendance((select token from links where label = 'open'),
                                      'Amalia', 'Arce', 'amalia.personal@example.com');

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000004');

select throws_ok(
  $$select public.admin_link_attendance_submission(
      public.test_response_id('adad0000-0000-4000-8000-000000000101', 'carla.personal@example.com'),
      'adad0000-0000-4000-8000-000000000004')$$,
  '42501', null,
  'a member cannot link a response, not even to themselves');

select public.test_login('adad0000-0000-4000-8000-000000000001');

select is(
  public.admin_link_attendance_submission(
    public.test_response_id('adad0000-0000-4000-8000-000000000101', 'carla.personal@example.com'),
    'adad0000-0000-4000-8000-000000000004') ->> 'ok',
  'true',
  'an officer links a waiting response to the member it belongs to');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000004', 'adad0000-0000-4000-8000-000000000101'),
  'rows=1 method=form awards=1 points=10',
  'which checks them in exactly as a matching address would have');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'carla.personal@example.com'),
  'claimed by adad0000-0000-4000-8000-000000000004',
  'and the response now points at that attendance');

select is(
  (select count(*)::int from public.admin_audit_log l
    where l.action = 'attendance.submission_linked'
      and l.entity_id = 'adad0000-0000-4000-8000-000000000101'
      and l.actor_id = 'adad0000-0000-4000-8000-000000000001'
      and l.metadata ->> 'member_id' = 'adad0000-0000-4000-8000-000000000004'
      and l.metadata ->> 'email' = 'carla.personal@example.com'),
  1,
  'the link is audited, with the officer as actor');

select throws_ok(
  $$select public.admin_link_attendance_submission(
      public.test_response_id('adad0000-0000-4000-8000-000000000101', 'carla.personal@example.com'),
      'adad0000-0000-4000-8000-000000000004')$$,
  '22023', 'That response is already on a member''s record',
  'a response already on a record can''t be linked again');

select is(
  public.admin_link_attendance_submission(
    public.test_response_id('adad0000-0000-4000-8000-000000000101', 'amalia.personal@example.com'),
    'adad0000-0000-4000-8000-000000000002') ->> 'code',
  'ALREADY_CHECKED_IN',
  'linking a response for someone already checked in says so');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000002', 'adad0000-0000-4000-8000-000000000101'),
  'rows=1 method=form awards=1 points=10',
  'and adds no second attendance or award');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'amalia.personal@example.com'),
  'claimed by adad0000-0000-4000-8000-000000000002',
  'but the response joins the attendance they had, so it leaves the waiting list');

select throws_ok(
  $$select public.admin_link_attendance_submission(
      public.test_response_id('adad0000-0000-4000-8000-000000000107', 'tito.trigo@wustl.edu'),
      'adad0000-0000-4000-8000-0000000000ff')$$,
  'P0002', 'Member not found',
  'a response can''t be linked to a member who doesn''t exist');

select throws_ok(
  $$select public.admin_link_attendance_submission(
      'adad0000-0000-4000-8000-0000000005ff', 'adad0000-0000-4000-8000-000000000004')$$,
  'P0002', 'That response no longer exists',
  'nor can a response that doesn''t exist be linked');

-- The signup trigger picks its waiting responses before it locks them, so an
-- officer can link one in between. One session can't stage that race, so the
-- late claim is made directly: Otilia, not checked in, arriving for the
-- response already linked to Carla.
reset role;
select public.test_login(null);

select is(
  private.claim_attendance_submission(
    public.test_response_id('adad0000-0000-4000-8000-000000000101', 'carla.personal@example.com'),
    'adad0000-0000-4000-8000-000000000001'),
  '{"ok": false, "code": "ALREADY_CLAIMED"}'::jsonb,
  'a claim that arrives after the response was linked finds it taken');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000001', 'adad0000-0000-4000-8000-000000000101'),
  'rows=0 method=none awards=0 points=0',
  'and checks nobody else in on it: one response, one person on the roster');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'carla.personal@example.com'),
  'claimed by adad0000-0000-4000-8000-000000000004',
  'the response stays with the member it was linked to');


-- =============================================================================
-- 14. AN OFFICER DELETES A RESPONSE
-- =============================================================================

set local role anon;
select public.test_login(null);
select public.submit_event_attendance((select token from links where label = 'open'),
                                      'Spam', 'Bot', 'spam.bot@example.com');

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000004');

select throws_ok(
  $$select public.admin_delete_attendance_submission(
      public.test_response_id('adad0000-0000-4000-8000-000000000101', 'spam.bot@example.com'))$$,
  '42501', null,
  'a member cannot delete a response');

select public.test_login('adad0000-0000-4000-8000-000000000001');

select is(
  public.admin_delete_attendance_submission(
    public.test_response_id('adad0000-0000-4000-8000-000000000101', 'spam.bot@example.com')) ->> 'ok',
  'true',
  'an officer deletes a waiting response');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'spam.bot@example.com'),
  'no response',
  'and it is gone');

select is(
  (select count(*)::int from public.admin_audit_log l
    where l.action = 'attendance.submission_deleted'
      and l.entity_id = 'adad0000-0000-4000-8000-000000000101'
      and l.actor_id = 'adad0000-0000-4000-8000-000000000001'
      and l.metadata ->> 'email' = 'spam.bot@example.com'),
  1,
  'the deletion is audited, with what was deleted');

select throws_ok(
  $$select public.admin_delete_attendance_submission(
      public.test_response_id('adad0000-0000-4000-8000-000000000101', 'amalia.arce@wustl.edu'))$$,
  '22023', 'That response is already on a member''s record. Remove their attendance instead.',
  'a response already on a record is attendance, and isn''t deleted this way');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'amalia.arce@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000002',
  'so it is still there, and so is the attendance');

select throws_ok(
  $$select public.admin_delete_attendance_submission('adad0000-0000-4000-8000-0000000005ff')$$,
  'P0002', 'That response no longer exists',
  'deleting a response that isn''t there says so');


-- =============================================================================
-- 15. A LEAKED LINK CAN ONLY WRITE SO MUCH
-- =============================================================================

-- The cap counts what came in since the link was made or last replaced, so the
-- thousand responses below are given times inside the link's life: it went up
-- half an hour ago and they arrived over the last twenty minutes. now() stands
-- still inside a test's transaction; without this the link, the responses and
-- the replacement further down would all share one instant.
reset role;
select public.test_login(null);

update public.event_attendance_links
   set created_at = now() - interval '30 minutes',
       updated_at = now() - interval '30 minutes'
 where event_id = 'adad0000-0000-4000-8000-000000000108';

insert into public.event_attendance_submissions (event_id, first_name, last_name, email, submitted_at)
select 'adad0000-0000-4000-8000-000000000108', 'Bulk', 'Response', 'bulk' || g || '@example.com',
       now() - interval '20 minutes'
  from generate_series(1, 1000) as g;

set local role anon;

select is(
  public.submit_event_attendance((select token from links where label = 'crowded'),
                                 'Lia', 'Late', 'lia.late@example.com'),
  '{"ok": false, "code": "FORM_FULL", "event_title": "Crowded Mixer"}'::jsonb,
  'after a thousand responses the link takes no new address');

select is(
  public.submit_event_attendance((select token from links where label = 'crowded'),
                                 'Bulk', 'Response', 'BULK7@example.com'),
  '{"ok": true, "event_title": "Crowded Mixer"}'::jsonb,
  'but an address it already has still gets the usual answer');

select is(public.test_responses('adad0000-0000-4000-8000-000000000108'), 1000,
  'and nothing past the cap is written');

-- The cap is on what a link lets in, not on the officers. One of them types
-- in someone who came to the desk while the form was full.
set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');

select is(
  public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000108',
                                         'Wendy', 'Walker', 'wendy.walker@example.com') ->> 'status',
  'waiting',
  'an officer can still enter a response by hand when the form is full');

-- Then clears one spam response, leaving 999 from the form and 1000 in all.
select public.admin_delete_attendance_submission(
  public.test_response_id('adad0000-0000-4000-8000-000000000108', 'bulk1000@example.com'));

set local role anon;
select public.test_login(null);

select is(
  public.submit_event_attendance((select token from links where label = 'crowded'),
                                 'Lia', 'Late', 'lia.late@example.com'),
  '{"ok": true, "event_title": "Crowded Mixer"}'::jsonb,
  'that frees one place: the response the officer entered doesn''t count against the link');

select is(
  public.submit_event_attendance((select token from links where label = 'crowded'),
                                 'Leo', 'Later', 'leo.later@example.com') ->> 'code',
  'FORM_FULL',
  'and once it is taken the link is full again');

-- Replacing the link is the advice when one leaks, so it has to bring the
-- form back for everyone else.
set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');

update links
   set token = public.admin_rotate_attendance_link('adad0000-0000-4000-8000-000000000108') ->> 'token'
 where label = 'crowded';

set local role anon;
select public.test_login(null);

select is(
  public.submit_event_attendance((select token from links where label = 'crowded'),
                                 'Leo', 'Later', 'leo.later@example.com'),
  '{"ok": true, "event_title": "Crowded Mixer"}'::jsonb,
  'the replacement takes new addresses: what came through the old link doesn''t count against it');

select is(public.test_responses('adad0000-0000-4000-8000-000000000108'), 1002,
  'and what the old link let in is still on file, for officers to clear out');


-- =============================================================================
-- 16. DELETING A MEMBER PUTS THEIR RESPONSE BACK
-- =============================================================================

select public.submit_event_attendance((select token from links where label = 'open'),
                                      'Dora', 'Durán', 'dora.duran@wustl.edu');
reset role;
select public.test_login(null);

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'dora.duran@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000006',
  'Dora''s response is on her record');

delete from auth.users where id = 'adad0000-0000-4000-8000-000000000006';

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'dora.duran@wustl.edu'),
  'waiting',
  'deleting her account puts the response back to waiting, rather than losing it');

select public.test_create_user('adad0000-0000-4000-8000-000000000009', 'dora.duran@wustl.edu', 'Dora', 'Durán');

select is(public.test_response('adad0000-0000-4000-8000-000000000101', 'dora.duran@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000009',
  'and an account created again with that address picks it up');


-- =============================================================================
-- 17. SENDING THE FORM AGAIN AFTER AN OFFICER REMOVED IT
-- =============================================================================

-- Ramona is checked in through the form. An officer removes it -- someone else
-- sent her address, say -- and then she arrives and sends it herself. Her
-- response is still on file, so a repeat that wrote nothing would tell her
-- she's checked in while nothing was recorded.
set local role anon;
select public.test_login(null);
select public.submit_event_attendance((select token from links where label = 'second'),
                                      'Ramona', 'Reyes', 'ramona.reyes@wustl.edu');

insert into answers (label, body)
select 'ramona_first',
       jsonb_build_object('id', public.test_attendance_id('adad0000-0000-4000-8000-00000000000a',
                                                          'adad0000-0000-4000-8000-000000000110'));

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');

select is(
  public.admin_remove_attendance(
    public.test_attendance_id('adad0000-0000-4000-8000-00000000000a', 'adad0000-0000-4000-8000-000000000110'),
    'Sent by someone else') ->> 'reversed_points',
  '10',
  'an officer removes Ramona''s form check-in, reversing its points');

select is(public.test_response('adad0000-0000-4000-8000-000000000110', 'ramona.reyes@wustl.edu'),
  'on a member but no attendance',
  'her response stays on file, on her record but no longer on the roster');

set local role anon;
select public.test_login(null);

select is(
  public.submit_event_attendance((select token from links where label = 'second'),
                                 'Ramona', 'Reyes', 'Ramona.Reyes@wustl.edu'),
  '{"ok": true, "event_title": "Second Chance Night"}'::jsonb,
  'when she sends the form herself she gets the usual answer');

select is(public.test_attendance('adad0000-0000-4000-8000-00000000000a', 'adad0000-0000-4000-8000-000000000110'),
  'rows=1 method=form awards=3 points=10',
  'and it is true: she is back on the roster through the form, with the event''s points once');

select isnt(
  public.test_attendance_id('adad0000-0000-4000-8000-00000000000a', 'adad0000-0000-4000-8000-000000000110')::text,
  (select body ->> 'id' from answers where label = 'ramona_first'),
  'on a new attendance row, not the one that was removed');

select is(public.test_ledger('adad0000-0000-4000-8000-00000000000a', 'adad0000-0000-4000-8000-000000000110'),
  'event_attendance 10, event_attendance 10, correction -10',
  'the ledger shows what happened: the award, its correction, and a new award');

select is(public.test_response('adad0000-0000-4000-8000-000000000110', 'ramona.reyes@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-00000000000a',
  'her response points at the new attendance');

select is(
  public.submit_event_attendance((select token from links where label = 'second'),
                                 'Ramona', 'Reyes', 'ramona.reyes@wustl.edu'),
  '{"ok": true, "event_title": "Second Chance Night"}'::jsonb,
  'sending it once more gets the same answer');

select is(public.test_attendance('adad0000-0000-4000-8000-00000000000a', 'adad0000-0000-4000-8000-000000000110'),
  'rows=1 method=form awards=3 points=10',
  'and, now that she is on the roster, writes nothing');


-- =============================================================================
-- 18. ... OR AFTER AN ACCOUNT APPEARED IN THE SAME INSTANT
-- =============================================================================

-- Paco sends the form at the moment his account is being created. Neither
-- transaction sees the other's uncommitted row: the form finds no account,
-- the signup finds no response, and the response is left waiting for an
-- account that already exists. One session can't stage that race, so its end
-- state is written directly: the account first, then the response behind its
-- back.
reset role;
select public.test_login(null);
select public.test_create_user('adad0000-0000-4000-8000-00000000000d', 'paco.prieto@wustl.edu', 'Paco', 'Prieto');
insert into public.event_attendance_submissions (event_id, first_name, last_name, email)
values ('adad0000-0000-4000-8000-000000000110', 'Paco', 'Prieto', 'paco.prieto@wustl.edu');

select is(public.test_response('adad0000-0000-4000-8000-000000000110', 'paco.prieto@wustl.edu'),
  'waiting',
  'a response can be left waiting although its address has an account');

set local role anon;

select is(
  public.submit_event_attendance((select token from links where label = 'second'),
                                 'Paco', 'Prieto', 'paco.prieto@wustl.edu'),
  '{"ok": true, "event_title": "Second Chance Night"}'::jsonb,
  'sending the form again gets the usual answer');

select is(public.test_attendance('adad0000-0000-4000-8000-00000000000d', 'adad0000-0000-4000-8000-000000000110'),
  'rows=1 method=form awards=1 points=10',
  'and this time checks him in');

select is(public.test_response('adad0000-0000-4000-8000-000000000110', 'paco.prieto@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-00000000000d',
  'by claiming the response that was waiting, not by writing another');

select is(public.test_responses('adad0000-0000-4000-8000-000000000110'), 2,
  'so the event has one response each from Ramona and Paco');


-- =============================================================================
-- 19. AN OFFICER ENTERS A RESPONSE
-- =============================================================================

-- For someone with no phone, who came after the window, or who found the link
-- down. The Late Sign-in Social's window closed days ago, which doesn't matter
-- here: entering someone after the event is the point.
reset role;

select ok(
  (select e.check_in_closes_at < now() from public.events e
    where e.id = 'adad0000-0000-4000-8000-000000000111'),
  'the Late Sign-in Social''s check-in window has closed');

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000004');

select throws_ok(
  $$select public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                                  'Quique', 'Quintero', 'quique.quintero@wustl.edu')$$,
  '42501', null,
  'a member cannot enter a response');

select public.test_login('adad0000-0000-4000-8000-000000000001');

select is(
  public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                         'Quique', 'Quintero', 'Quique.Quintero+late@wustl.edu'),
  '{"ok": true, "status": "waiting", "points_awarded": 0}'::jsonb,
  'an address with no account is kept, waiting, and the officer is told so');

select is(public.test_response('adad0000-0000-4000-8000-000000000111', 'quique.quintero@wustl.edu'),
  'waiting',
  'the response waits like one from the form');

select is(public.test_added_by('adad0000-0000-4000-8000-000000000111', 'quique.quintero@wustl.edu'),
  'adad0000-0000-4000-8000-000000000001'::uuid,
  'marked as entered by that officer');

select is(public.test_attendees('adad0000-0000-4000-8000-000000000111'), 0,
  'and no attendance is written for it yet');

select is(
  public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                         'Bruno', 'Blanco', '  BRUNO.Blanco+desk@WUSTL.edu '),
  '{"ok": true, "status": "checked_in", "points_awarded": 5}'::jsonb,
  'a member''s address, whatever its case, +tag or stray spaces, checks them in at once');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000003', 'adad0000-0000-4000-8000-000000000111'),
  'rows=1 method=manual awards=1 points=5',
  'as manual attendance with the event''s points, as Add attendee would');

select is(public.test_verified_by('adad0000-0000-4000-8000-000000000003', 'adad0000-0000-4000-8000-000000000111'),
  'adad0000-0000-4000-8000-000000000001'::uuid,
  'verified by the officer who entered it');

select is(public.test_response('adad0000-0000-4000-8000-000000000111', 'bruno.blanco@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000003',
  'and the response points at that attendance');

select is(
  (select string_agg(format('%s %s', l.metadata ->> 'email', l.metadata ->> 'points_awarded'), ', '
                     order by l.metadata ->> 'email')
     from public.admin_audit_log l
    where l.action = 'attendance.submission_added'
      and l.entity_id = 'adad0000-0000-4000-8000-000000000111'
      and l.actor_id = 'adad0000-0000-4000-8000-000000000001'),
  'bruno.blanco+desk@wustl.edu 5, quique.quintero+late@wustl.edu 0',
  'both are audited, with the officer as actor and what each earned');

select is(
  public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                         'Bruno', 'Blanco', 'bruno.blanco@wustl.edu'),
  '{"ok": true, "status": "already_recorded", "points_awarded": 0}'::jsonb,
  'entering someone already on the roster says so');

select is(
  public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                         'Quique', 'Quintero', 'quique.quintero@wustl.edu'),
  '{"ok": true, "status": "already_recorded", "points_awarded": 0}'::jsonb,
  'and so does entering a waiting response again');

select is(
  format('%s; responses=%s; audits=%s',
    public.test_attendance('adad0000-0000-4000-8000-000000000003', 'adad0000-0000-4000-8000-000000000111'),
    public.test_responses('adad0000-0000-4000-8000-000000000111'),
    public.test_audits('attendance.submission_added', 'adad0000-0000-4000-8000-000000000111')),
  'rows=1 method=manual awards=1 points=5; responses=2; audits=2',
  'neither writes anything: no second row, award, response or audit entry');

select throws_ok(
  $$select public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                                  '  ', 'Ruiz', 'rita.ruiz@wustl.edu')$$,
  '22023', 'Enter their first name',
  'a blank first name is refused');

select throws_ok(
  $$select public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                                  'Rita', '', 'rita.ruiz@wustl.edu')$$,
  '22023', 'Enter their last name',
  'so is a blank last name');

select throws_ok(
  $$select public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                                  'Rita', 'Ruiz', 'rita.ruiz')$$,
  '22023', 'Enter a valid email address',
  'and an address that isn''t one');

select throws_ok(
  $$select public.admin_add_attendance_submission('adad0000-0000-4000-8000-0000000001ff',
                                                  'Rita', 'Ruiz', 'rita.ruiz@wustl.edu')$$,
  'P0002', 'Event not found',
  'and an event that doesn''t exist');

select is(public.test_responses('adad0000-0000-4000-8000-000000000111'), 2,
  'nothing is written for refused input');

-- Quique registers after the event.
reset role;
select public.test_login(null);
select public.test_create_user('adad0000-0000-4000-8000-00000000000c', 'quique.quintero@wustl.edu', 'Quique', 'Quintero');

select is(public.test_attendance('adad0000-0000-4000-8000-00000000000c', 'adad0000-0000-4000-8000-000000000111'),
  'rows=1 method=manual awards=1 points=5',
  'the response the officer entered is claimed at signup, as manual attendance');

select is(public.test_verified_by('adad0000-0000-4000-8000-00000000000c', 'adad0000-0000-4000-8000-000000000111'),
  'adad0000-0000-4000-8000-000000000001'::uuid,
  'verified by the officer who entered it, not passed off as the form');

select is(public.test_response('adad0000-0000-4000-8000-000000000111', 'quique.quintero@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-00000000000c',
  'and the response points at it');

-- Amalia checked in with the code at the social, and an officer who didn't
-- know enters her at the desk as well.
select public.perform_check_in('adad0000-0000-4000-8000-000000000002',
                               'adad0000-0000-4000-8000-000000000111', 'code', null);

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');

select is(
  public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000111',
                                         'Amalia', 'Arce', 'amalia.arce@wustl.edu'),
  '{"ok": true, "status": "already_recorded", "points_awarded": 0}'::jsonb,
  'entering someone already checked in another way says they''re recorded, not that this checked them in');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000002', 'adad0000-0000-4000-8000-000000000111'),
  'rows=1 method=code awards=1 points=5',
  'and adds no second attendance or award');

select is(public.test_response('adad0000-0000-4000-8000-000000000111', 'amalia.arce@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-000000000002',
  'the response joins the attendance she had, so it never sits on the waiting list');

select is(
  (select string_agg(l.metadata ->> 'points_awarded', ', ')
     from public.admin_audit_log l
    where l.action = 'attendance.submission_added'
      and l.entity_id = 'adad0000-0000-4000-8000-000000000111'
      and l.metadata ->> 'email' = 'amalia.arce@wustl.edu'),
  '0',
  'the response it wrote is audited, as earning nothing');

-- Ramona's attendance at Second Chance Night comes off again, by mistake this
-- time, and the second officer puts her back by name. Her response is still on
-- file from the form, but this time an officer is vouching for her, so the
-- roster has to say so rather than show it as her own check-in.
select lives_ok(
  $$select public.admin_remove_attendance(
      public.test_attendance_id('adad0000-0000-4000-8000-00000000000a', 'adad0000-0000-4000-8000-000000000110'),
      'Removed by mistake')$$,
  'Ramona is on the roster again after sending the form, so an officer can take her off');

select public.test_login('adad0000-0000-4000-8000-00000000000b');

select is(
  public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000110',
                                         'Ramona', 'Reyes', 'ramona.reyes@wustl.edu'),
  '{"ok": true, "status": "checked_in", "points_awarded": 10}'::jsonb,
  'entering someone whose form response is on file but off the roster checks them in again');

select is(public.test_attendance('adad0000-0000-4000-8000-00000000000a', 'adad0000-0000-4000-8000-000000000110'),
  'rows=1 method=manual awards=5 points=10',
  'as manual attendance, with the event''s points once on top of two awards and two corrections');

select is(public.test_verified_by('adad0000-0000-4000-8000-00000000000a', 'adad0000-0000-4000-8000-000000000110'),
  'adad0000-0000-4000-8000-00000000000b'::uuid,
  'verified by the officer who entered her now, though the response came through the form');

select is(public.test_response('adad0000-0000-4000-8000-000000000110', 'ramona.reyes@wustl.edu'),
  'claimed by adad0000-0000-4000-8000-00000000000a',
  'and her response points at the new attendance');

select is(
  (select count(*)::int from public.admin_audit_log l
    where l.action = 'attendance.submission_added'
      and l.entity_id = 'adad0000-0000-4000-8000-000000000110'
      and l.actor_id = 'adad0000-0000-4000-8000-00000000000b'
      and (l.metadata ->> 'points_awarded')::int = 10),
  1,
  'which is audited, though no response was written: someone was checked in');


-- =============================================================================
-- 20. CLEARING OUT WHAT A LEAKED LINK LET IN
-- =============================================================================

-- Through the Leaked Link Mixer's link: three junk addresses, Carla, who has
-- an account, and Bruno's address, sent by somebody else. At the desk, an
-- officer enters a walk-in and takes Bruno off the roster.
set local role anon;
select public.test_login(null);
select public.submit_event_attendance((select token from links where label = 'leaked'),
                                      'Junk', 'One', 'junk1@example.com');
select public.submit_event_attendance((select token from links where label = 'leaked'),
                                      'Junk', 'Two', 'junk2@example.com');
select public.submit_event_attendance((select token from links where label = 'leaked'),
                                      'Junk', 'Three', 'junk3@example.com');
select public.submit_event_attendance((select token from links where label = 'leaked'),
                                      'Carla', 'Cruz', 'carla.cruz@wustl.edu');
select public.submit_event_attendance((select token from links where label = 'leaked'),
                                      'Bruno', 'Blanco', 'bruno.blanco@wustl.edu');

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');
select public.admin_add_attendance_submission('adad0000-0000-4000-8000-000000000113',
                                              'Walter', 'Walker', 'walter.walker@example.com');
select lives_ok(
  $$select public.admin_remove_attendance(
      public.test_attendance_id('adad0000-0000-4000-8000-000000000003', 'adad0000-0000-4000-8000-000000000113'),
      'Not at this event')$$,
  'Bruno''s address checked him in through the leaked link, and an officer takes him off');

-- All of that came before the link was replaced. now() stands still inside a
-- test's transaction, so it is moved ten minutes back to say so.
reset role;
update public.event_attendance_submissions
   set submitted_at = now() - interval '10 minutes'
 where event_id = 'adad0000-0000-4000-8000-000000000113';

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000001');
update links
   set token = public.admin_rotate_attendance_link('adad0000-0000-4000-8000-000000000113') ->> 'token'
 where label = 'leaked';

-- Someone sends the new link.
set local role anon;
select public.test_login(null);
select public.submit_event_attendance((select token from links where label = 'leaked'),
                                      'Lola', 'Luna', 'lola.luna@example.com');

set local role authenticated;
select public.test_login('adad0000-0000-4000-8000-000000000004');

select throws_ok(
  $$select public.admin_delete_waiting_submissions('adad0000-0000-4000-8000-000000000113', now())$$,
  '42501', null,
  'a member cannot clear out responses');

select public.test_login('adad0000-0000-4000-8000-000000000001');

select throws_ok(
  $$select public.admin_delete_waiting_submissions('adad0000-0000-4000-8000-000000000113', null)$$,
  '22023', 'Say which responses to delete',
  'clearing out needs a cut-off: there is no "delete everything waiting"');

select throws_ok(
  $$select public.admin_delete_waiting_submissions('adad0000-0000-4000-8000-0000000001ff', now())$$,
  'P0002', 'Event not found',
  'nor is there anything to clear for an event that doesn''t exist');

-- The roster passes the time the link was replaced.
select is(
  public.admin_delete_waiting_submissions(
    'adad0000-0000-4000-8000-000000000113',
    (public.admin_attendance_link('adad0000-0000-4000-8000-000000000113') ->> 'updated_at')::timestamptz),
  '{"ok": true, "deleted": 3}'::jsonb,
  'clearing out up to the replacement deletes the three junk responses, and says how many');

select is(
  (select string_agg(s.email, ', ' order by s.email) from public.event_attendance_submissions s
    where s.event_id = 'adad0000-0000-4000-8000-000000000113'),
  'bruno.blanco@wustl.edu, carla.cruz@wustl.edu, lola.luna@example.com, walter.walker@example.com',
  'it keeps the response on Carla''s record, the one the officer entered, and the one through the new link');

-- Bruno's response is off the roster but still on his record, so the waiting
-- list never showed it and the number the officer confirmed didn't count it.
select is(public.test_response('adad0000-0000-4000-8000-000000000113', 'bruno.blanco@wustl.edu'),
  'on a member but no attendance',
  'and Bruno''s, whose attendance was removed: the waiting list doesn''t show it, so it isn''t in the count');

select is(public.test_attendance('adad0000-0000-4000-8000-000000000004', 'adad0000-0000-4000-8000-000000000113'),
  'rows=1 method=form awards=1 points=10',
  'Carla''s attendance is untouched');

select is(public.test_responses('adad0000-0000-4000-8000-000000000108'), 1002,
  'and another event''s waiting responses, from well before the cut-off, are left alone');

select is(
  (select count(*)::int from public.admin_audit_log l
    where l.action = 'attendance.submissions_deleted'
      and l.entity_type = 'event'
      and l.entity_id = 'adad0000-0000-4000-8000-000000000113'
      and l.actor_id = 'adad0000-0000-4000-8000-000000000001'
      and l.metadata ->> 'event_title' = 'Leaked Link Mixer'
      and (l.metadata ->> 'count')::int = 3),
  1,
  'the clear-out is audited once, with how many went');

select is(
  public.admin_delete_waiting_submissions(
    'adad0000-0000-4000-8000-000000000113',
    (public.admin_attendance_link('adad0000-0000-4000-8000-000000000113') ->> 'updated_at')::timestamptz),
  '{"ok": true, "deleted": 0}'::jsonb,
  'doing it again finds nothing to delete');

select is(public.test_audits('attendance.submissions_deleted', 'adad0000-0000-4000-8000-000000000113'), 1,
  'and, having deleted nothing, writes no audit entry');

select * from finish();
rollback;

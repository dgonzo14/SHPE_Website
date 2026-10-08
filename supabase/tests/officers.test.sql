-- =============================================================================
-- officers.test.sql — chapter positions and "Meet your officers"
--
-- Run with:  supabase test db
--
-- Positions live in public.chapter_positions (20260914000001) and are set with
-- admin_set_chapter_position(); cards.test.sql covers that setter's own rules.
-- This suite asserts three things about positions as the board:
--
--   1. A position is a title, not a permission. Setting or clearing one never
--      touches member_roles, and a member holding one is no more an officer
--      than before.
--   2. Members see the board and only the board: position holders' titles and
--      contact details, nobody else, nothing more. Pending accounts see nothing.
--   3. The board comes back in Leadership-page order, however a title is
--      spelled, with anything off that list after it.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

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

select public.test_create_user('ffffffff-0000-4000-8000-000000000001', 'ana.rivera@wustl.edu',  'Ana',  'Rivera');
select public.test_create_user('ffffffff-0000-4000-8000-000000000002', 'olga.ortiz@wustl.edu',  'Olga', 'Ortiz');
select public.test_create_user('ffffffff-0000-4000-8000-000000000003', 'wes.web@wustl.edu',     'Wes',  'Webb');
select public.test_create_user('ffffffff-0000-4000-8000-000000000004', 'pat.pending@wustl.edu', 'Pat',  'Pending');
select public.test_create_user('ffffffff-0000-4000-8000-000000000005', 'nia.none@wustl.edu',    'Nia',  'None');

update public.profiles set membership_status = 'active', major = 'Computer Science',
       graduation_year = 2091, linkedin_url = 'https://www.linkedin.com/in/ana-test'
 where id = 'ffffffff-0000-4000-8000-000000000001';
update public.profiles set membership_status = 'active'
 where id in ('ffffffff-0000-4000-8000-000000000002',
              'ffffffff-0000-4000-8000-000000000003',
              'ffffffff-0000-4000-8000-000000000005');
-- ...000004 stays pending, which is the registration default.

insert into public.member_roles (member_id, role)
values ('ffffffff-0000-4000-8000-000000000002', 'officer');

-- Whatever the seed assigned, this suite starts from an empty board.
delete from public.chapter_positions where true;

create temporary table board (label text primary key, body jsonb not null);
grant all on board to anon, authenticated;


-- =============================================================================
-- NO SESSION
-- =============================================================================

set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$select public.get_chapter_officers()$$,
  '42501', null,
  'anon cannot see the officer board'
);


-- =============================================================================
-- AS A PLAIN MEMBER (Ana)
-- =============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"ffffffff-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.get_chapter_officers(),
  '[]'::jsonb,
  'with no positions assigned the board is empty, not an error'
);

select throws_ok(
  $$select public.admin_set_chapter_position('ffffffff-0000-4000-8000-000000000001', 'President')$$,
  '42501', null,
  'a member cannot make themselves President'
);

select throws_ok(
  $$select * from public.chapter_positions$$,
  '42501', null,
  'a member cannot read the positions table directly, only the board'
);

select throws_ok(
  $$select private.board_position_order('President')$$,
  '42501', null,
  'the ordering helper is not callable from a client'
);


-- =============================================================================
-- AN OFFICER SETS POSITIONS (Olga)
-- =============================================================================

select set_config('request.jwt.claims',
                  '{"sub":"ffffffff-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- Assigned out of order, and spelled differently from the Leadership page.
select public.admin_set_chapter_position('ffffffff-0000-4000-8000-000000000003', 'Webmaster');
select public.admin_set_chapter_position('ffffffff-0000-4000-8000-000000000001', 'Treasurer');
select public.admin_set_chapter_position('ffffffff-0000-4000-8000-000000000002', 'vice president');

reset role;
select set_config('request.jwt.claims', '', true);

-- ── A position is not a permission ──────────────────────────────────────────

select is(
  (select array_agg(r.role::text order by r.role)
     from public.member_roles r
    where r.member_id = 'ffffffff-0000-4000-8000-000000000001'),
  array['member'],
  'holding a position grants no role: the Treasurer is still only a member'
);

select ok(
  not private.is_officer('ffffffff-0000-4000-8000-000000000001'),
  'holding a position does not make a member an officer for access control'
);


-- =============================================================================
-- THE BOARD, AS A MEMBER (Ana)
-- =============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"ffffffff-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into board values ('member', public.get_chapter_officers());

select is(
  (select jsonb_agg(e ->> 'position') from board, jsonb_array_elements(body) e where label = 'member'),
  '["vice president", "Treasurer", "Webmaster"]'::jsonb,
  'the board follows Leadership-page order whatever the spelling, other titles last'
);

select is(
  (select array_agg(k order by k)
     from board, jsonb_array_elements(body) e, jsonb_object_keys(e) k
    where label = 'member' and e ->> 'position' = 'Treasurer'),
  array['email', 'first_name', 'graduation_year', 'is_me', 'last_name',
        'linkedin_url', 'major', 'position'],
  'each entry carries a title and contact details -- no ids, no roles'
);

select is(
  (select e - 'is_me' from board, jsonb_array_elements(body) e
    where label = 'member' and e ->> 'position' = 'Treasurer'),
  '{"position": "Treasurer", "first_name": "Ana", "last_name": "Rivera",
    "major": "Computer Science", "graduation_year": 2091,
    "email": "ana.rivera@wustl.edu",
    "linkedin_url": "https://www.linkedin.com/in/ana-test"}'::jsonb,
  'an entry has the holder''s name, major, class year, email and LinkedIn'
);

select is(
  (select jsonb_agg((e ->> 'is_me')::boolean) from board, jsonb_array_elements(body) e
    where label = 'member'),
  '[false, true, false]'::jsonb,
  'the caller''s own entry is marked, and only theirs'
);

select ok(
  (select body::text not like '%nia.none%' and body::text not like '%pat.pending%'
     from board where label = 'member'),
  'members without a position are not on the board'
);

-- =============================================================================
-- AS A PENDING ACCOUNT (Pat)
-- =============================================================================

select set_config('request.jwt.claims',
                  '{"sub":"ffffffff-0000-4000-8000-000000000004","role":"authenticated"}', true);

select throws_ok(
  $$select public.get_chapter_officers()$$,
  '42501', null,
  'a pending account does not get the officers'' contact details'
);


-- =============================================================================
-- CLEARING AND DELETING
-- =============================================================================

select set_config('request.jwt.claims',
                  '{"sub":"ffffffff-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(
  jsonb_array_length(public.get_chapter_officers()),
  3,
  'an officer sees the same board'
);

select public.admin_set_chapter_position('ffffffff-0000-4000-8000-000000000002', null);

select is(
  (select jsonb_agg(e ->> 'position') from jsonb_array_elements(public.get_chapter_officers()) e),
  '["Treasurer", "Webmaster"]'::jsonb,
  'a cleared position leaves the board at once'
);

reset role;
select set_config('request.jwt.claims', '', true);

select ok(
  private.is_officer('ffffffff-0000-4000-8000-000000000002'),
  'clearing a position revokes nothing: the officer is still an officer'
);

select is(
  (select count(*)::int from public.admin_audit_log
    where action in ('card.position_set', 'card.position_cleared')
      and entity_id in ('ffffffff-0000-4000-8000-000000000001',
                        'ffffffff-0000-4000-8000-000000000002',
                        'ffffffff-0000-4000-8000-000000000003')),
  4,
  'every position change above is in the audit log'
);

-- ── Ordering helper ─────────────────────────────────────────────────────────

select is(
  private.board_position_order('Vice-President'),
  private.board_position_order('  VICE president '),
  'spelling, case and spacing do not change a title''s place'
);

select ok(
  private.board_position_order('President') < private.board_position_order('First Year Representative'),
  'President comes first and First Year Representative last, as on the Leadership page'
);

select is(
  private.board_position_order('Webmaster'),
  1000,
  'a title off the Leadership page sorts after the whole board'
);

delete from auth.users where id = 'ffffffff-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"ffffffff-0000-4000-8000-000000000005","role":"authenticated"}', true);

select is(
  (select jsonb_agg(e ->> 'position') from jsonb_array_elements(public.get_chapter_officers()) e),
  '["Webmaster"]'::jsonb,
  'a deleted member leaves the board'
);

select * from finish();
rollback;

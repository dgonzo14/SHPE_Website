-- =============================================================================
-- card_publishing.test.sql — officers publishing and unpublishing cards
--
-- Run with:  supabase test db
--
-- admin_set_cards_published() (20260917000001) flips the same flag as a
-- member's own Publish switch, for one card or many. What matters:
--
--   1. Only officers can call it, and every change is audited, once.
--   2. It changes is_published and nothing else: a starter card stays a
--      starter card, hiding still wins, and the owner can still change it.
--   3. A selection that includes members without a card does the rest and
--      reports who was skipped.
--
-- Like every suite, this runs in one transaction and is rolled back.
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

-- A complete MemberCardInput for the given handle and name.
create or replace function public.test_pub_card(p_handle text, p_name text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'handle', p_handle,
    'display_name', p_name,
    'pronouns', null, 'headline', 'Mechanical engineering student', 'organization', null,
    'status_line', null, 'bio', null, 'location', null,
    'skills', '[]'::jsonb, 'languages', '[]'::jsonb,
    'avatar_path', null, 'banner_path', null, 'background_path', null,
    'show_major', true, 'show_graduation_year', true, 'show_member_since', false,
    'show_national_member', true, 'show_chapter_position', true,
    'theme', '{"preset": "executive"}'::jsonb,
    'sections', '["status", "links", "about", "education"]'::jsonb,
    'allow_indexing', false
  );
$$;

-- Audit rows for one action on one member.
create or replace function public.test_audits(p_action text, p_member uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.admin_audit_log l
   where l.action = p_action and l.entity_id = p_member;
$$;

-- A card's two flags as stored, read past RLS.
create or replace function public.test_flags(p_member uuid) returns text
language sql security definer set search_path = '' as $$
  select format('published=%s opened=%s', c.is_published::text, (c.member_opened_at is not null)::text)
    from public.member_cards c where c.member_id = p_member;
$$;

grant execute on function public.test_login(uuid)               to anon, authenticated;
grant execute on function public.test_pub_card(text, text)      to anon, authenticated;
grant execute on function public.test_audits(text, uuid)        to anon, authenticated;
grant execute on function public.test_flags(uuid)               to anon, authenticated;

select public.test_login(null);

select public.test_create_user('cbcb0000-0000-4000-8000-000000000001', 'otto.oficial@wustl.edu',  'Otto', 'Oficial');
select public.test_create_user('cbcb0000-0000-4000-8000-000000000002', 'mia.mendez@wustl.edu',    'Mia',  'Méndez');
select public.test_create_user('cbcb0000-0000-4000-8000-000000000003', 'nico.nunez@wustl.edu',    'Nico', 'Núñez');
select public.test_create_user('cbcb0000-0000-4000-8000-000000000004', 'zoe.zero@wustl.edu',      'Zoe',  'Zero');
select public.test_create_user('cbcb0000-0000-4000-8000-000000000005', 'remy.regular@wustl.edu',  'Remy', 'Regular');

update public.profiles set membership_status = 'active'
 where id::text like 'cbcb0000-0000-4000-8000-0000000000%';

insert into public.member_roles (member_id, role)
values ('cbcb0000-0000-4000-8000-000000000001', 'officer')
on conflict do nothing;

update public.app_settings set value = 'true'::jsonb where key = 'cards_enabled';

-- Mia builds her own card and leaves it as a draft.
set local role authenticated;
select public.test_login('cbcb0000-0000-4000-8000-000000000002');
select public.save_my_card(public.test_pub_card('mia-mendez', 'Mia Méndez'), '[]'::jsonb);

-- An officer makes Nico a starter card, unpublished. Zoe has no card at all.
select public.test_login('cbcb0000-0000-4000-8000-000000000001');
select public.admin_create_card('cbcb0000-0000-4000-8000-000000000003', 'nico-nunez', false);

reset role;
select public.test_login(null);


-- =============================================================================
-- 1. ONLY OFFICERS, NEVER ANONYMOUSLY
-- =============================================================================

select ok(
  not has_function_privilege('anon', 'public.admin_set_cards_published(uuid[], boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_set_cards_published(uuid[], boolean)', 'execute'),
  'signed-in callers can reach it (it checks the officer itself); anon cannot'
);

set local role authenticated;
select public.test_login('cbcb0000-0000-4000-8000-000000000005');
select throws_ok(
  $$select public.admin_set_cards_published(array['cbcb0000-0000-4000-8000-000000000002'::uuid], true)$$,
  '42501', null, 'a member cannot publish someone else''s card');
select throws_ok(
  $$select public.admin_set_cards_published(array['cbcb0000-0000-4000-8000-000000000002'::uuid], false)$$,
  '42501', null, 'nor unpublish it');
select is(public.test_flags('cbcb0000-0000-4000-8000-000000000002'), 'published=false opened=true',
  'and the refused call changed nothing');

-- =============================================================================
-- 2. ARGUMENTS
-- =============================================================================

select public.test_login('cbcb0000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.admin_set_cards_published(array['cbcb0000-0000-4000-8000-000000000002'::uuid], null)$$,
  '22023', null, 'it needs to know which way');
select throws_ok($$select public.admin_set_cards_published('{}'::uuid[], true)$$,
  '22023', null, 'an empty selection is refused');
select throws_ok($$select public.admin_set_cards_published(array[null]::uuid[], true)$$,
  '22023', null, 'so is a selection of nothing but nulls');
select throws_ok(
  $$select public.admin_set_cards_published(array(select gen_random_uuid() from generate_series(1, 501)), true)$$,
  '22023', null, 'more than 500 at a time is refused');

-- =============================================================================
-- 3. PUBLISHING
-- =============================================================================

select is(
  public.admin_set_cards_published(array[
    'cbcb0000-0000-4000-8000-000000000003',
    'cbcb0000-0000-4000-8000-000000000004',
    'cbcb0000-0000-4000-8000-000000000002',
    'cbcb0000-0000-4000-8000-000000000002',
    null
  ]::uuid[], true),
  '{"published": true,
    "changed":   ["cbcb0000-0000-4000-8000-000000000002", "cbcb0000-0000-4000-8000-000000000003"],
    "unchanged": [],
    "skipped":   ["cbcb0000-0000-4000-8000-000000000004"]}'::jsonb,
  'publishes every card in the selection once, and reports the member without one as skipped');

select is(public.test_audits('card.published', 'cbcb0000-0000-4000-8000-000000000002'), 1,
  'each published card is audited once, however often it was listed');
select is(public.test_audits('card.published', 'cbcb0000-0000-4000-8000-000000000003'), 1,
  'the starter card too');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.published'
                     and l.entity_id = 'cbcb0000-0000-4000-8000-000000000002'
                     and l.actor_id = 'cbcb0000-0000-4000-8000-000000000001'
                     and l.metadata ->> 'display_name' = 'Mia Méndez'
                     and l.metadata ->> 'handle' = 'mia-mendez'),
  'the audit row names the officer and whose card it was, by name and handle');
select is(public.test_audits('card.published', 'cbcb0000-0000-4000-8000-000000000004'), 0,
  'nothing is audited for a member without a card');

select is(public.test_flags('cbcb0000-0000-4000-8000-000000000003'), 'published=true opened=false',
  'publishing a starter card doesn''t count as its owner opening it');

set local role anon;
select public.test_login(null);
select is((public.get_public_card('mia-mendez')) ->> 'status', 'ok', 'Mia''s card is live');
select is((public.get_public_card('nico-nunez')) -> 'card' ->> 'is_starter', 'true',
  'and Nico''s is live as a starter card, showing only what one may');

set local role authenticated;
select public.test_login('cbcb0000-0000-4000-8000-000000000001');
select is(
  public.admin_set_cards_published(array['cbcb0000-0000-4000-8000-000000000002'::uuid], true),
  '{"published": true, "changed": [], "unchanged": ["cbcb0000-0000-4000-8000-000000000002"], "skipped": []}'::jsonb,
  'publishing a card that is already live changes nothing');
select is(public.test_audits('card.published', 'cbcb0000-0000-4000-8000-000000000002'), 1,
  'and records nothing a second time');

-- =============================================================================
-- 4. UNPUBLISHING
-- =============================================================================

select is(
  (public.admin_set_cards_published(array['cbcb0000-0000-4000-8000-000000000002'::uuid], false)) -> 'changed',
  '["cbcb0000-0000-4000-8000-000000000002"]'::jsonb,
  'an officer unpublishes a card');
select is(public.test_audits('card.unpublished', 'cbcb0000-0000-4000-8000-000000000002'), 1,
  'which is audited');

set local role anon;
select public.test_login(null);
select is(public.get_public_card('mia-mendez'), '{"status": "not_found"}'::jsonb,
  'an unpublished card looks like one that doesn''t exist');

-- Unpublishing isn't moderation: the owner can put it back.
set local role authenticated;
select public.test_login('cbcb0000-0000-4000-8000-000000000002');
select public.set_my_card_published(true);
set local role anon;
select public.test_login(null);
select is((public.get_public_card('mia-mendez')) ->> 'status', 'ok',
  'and its owner can publish it again from My Card');

-- =============================================================================
-- 5. HIDING STILL WINS
-- =============================================================================

set local role authenticated;
select public.test_login('cbcb0000-0000-4000-8000-000000000001');
select public.admin_set_card_hidden('cbcb0000-0000-4000-8000-000000000003', true, 'Checking the starter card');
select public.admin_set_cards_published(array['cbcb0000-0000-4000-8000-000000000003'::uuid], false);
select is(
  (public.admin_set_cards_published(array['cbcb0000-0000-4000-8000-000000000003'::uuid], true)) -> 'changed',
  '["cbcb0000-0000-4000-8000-000000000003"]'::jsonb,
  'a hidden card can be published');

set local role anon;
select public.test_login(null);
select is(public.get_public_card('nico-nunez'), '{"status": "not_found"}'::jsonb,
  'but it stays hidden until an officer unhides it');

set local role authenticated;
select public.test_login('cbcb0000-0000-4000-8000-000000000001');
select public.admin_set_card_hidden('cbcb0000-0000-4000-8000-000000000003', false);
set local role anon;
select public.test_login(null);
select is((public.get_public_card('nico-nunez')) ->> 'status', 'ok',
  'and once unhidden, it is live, because it was published');

-- =============================================================================
-- 6. THE ADMIN LIST AGREES
-- =============================================================================

set local role authenticated;
select public.test_login('cbcb0000-0000-4000-8000-000000000001');
select is(
  (select x ->> 'status' from jsonb_array_elements((public.admin_list_cards()) -> 'rows') x
    where x ->> 'member_id' = 'cbcb0000-0000-4000-8000-000000000003'),
  'published', 'the officer list shows the card as published');
select is(
  (select x ->> 'member_opened_at' from jsonb_array_elements((public.admin_list_cards()) -> 'rows') x
    where x ->> 'member_id' = 'cbcb0000-0000-4000-8000-000000000003'),
  null, 'and still as a card its owner hasn''t opened');

select * from finish();
rollback;

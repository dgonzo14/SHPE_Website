-- =============================================================================
-- member_search.test.sql — profiles.search_text, the accent-folded search field
--
-- Run with:  supabase test db
--
-- Officers search members by typing words; fetchMembers() sends one
-- `search_text ilike '%word%'` filter per word, folded in the browser the same
-- way the column is. The column has to fold accents and case, keep up with
-- every field it's built from, refuse writes, and leave row level security
-- exactly as it was.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

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

-- Her address holds none of her name, so finding her by name relies on the
-- folding alone.
select public.test_create_user('5ea7c000-0000-4000-8000-000000000001', 'mjmp@wustl.edu',        'María José', 'Muñoz Peña');
select public.test_create_user('5ea7c000-0000-4000-8000-000000000002', 'ana.rivera@wustl.edu',  'Ana',        'Rivera');
select public.test_create_user('5ea7c000-0000-4000-8000-000000000003', 'sofia.castro@wustl.edu', 'Sofia',     'Castro');
-- René López, typed the way some keyboards send it: each accent as its own
-- combining character after the letter, not one precomposed letter.
select public.test_create_user('5ea7c000-0000-4000-8000-000000000004', 'rene.lopez@wustl.edu',
                               'Rene' || U&'\0301', 'Lo' || U&'\0301' || 'pez');

update public.profiles set major = 'Ingeniería Biomédica'
 where id = '5ea7c000-0000-4000-8000-000000000001';

insert into public.member_roles (member_id, role)
values ('5ea7c000-0000-4000-8000-000000000003', 'officer');

-- What an officer's search for these words returns, the way fetchMembers()
-- asks for it: one ilike per word, every one required.
create or replace function public.test_search(p_words text[])
returns setof uuid language sql as $$
  select p.id from public.profiles p
   where p.id::text like '5ea7c000-%'
     and not exists (select 1 from unnest(p_words) w
                      where p.search_text not ilike '%' || w || '%')
   order by p.id;
$$;


-- ── What the column holds ───────────────────────────────────────────────────

select is(
  (select search_text from public.profiles where id = '5ea7c000-0000-4000-8000-000000000001'),
  'maria jose munoz pena mjmp@wustl.edu ingenieria biomedica',
  'search_text is the name, email and major, lowercased with the accents removed'
);

select is(
  (select search_text from public.profiles where id = '5ea7c000-0000-4000-8000-000000000002'),
  'ana rivera ana.rivera@wustl.edu ',
  'a missing major leaves the rest searchable'
);

select is(
  (select search_text from public.profiles where id = '5ea7c000-0000-4000-8000-000000000004'),
  'rene lopez rene.lopez@wustl.edu ',
  'accents typed as separate combining characters fold the same way'
);


-- ── An officer's search ─────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"5ea7c000-0000-4000-8000-000000000003","role":"authenticated"}',
                  true);

select results_eq(
  $$select public.test_search(array['munoz'])$$,
  $$values ('5ea7c000-0000-4000-8000-000000000001'::uuid)$$,
  'an officer typing "munoz" finds Muñoz'
);

select results_eq(
  $$select public.test_search(array['maria', 'jose', 'pena'])$$,
  $$values ('5ea7c000-0000-4000-8000-000000000001'::uuid)$$,
  'every word has to match, in any order and in any field'
);

select results_eq(
  $$select public.test_search(array['biomedica'])$$,
  $$values ('5ea7c000-0000-4000-8000-000000000001'::uuid)$$,
  'the major is searchable without its accents too'
);

select is_empty(
  $$select public.test_search(array['ana', 'munoz'])$$,
  'a first name from one member and a surname from another finds nobody'
);

reset role;


-- ── Keeping up with the fields it's built from ──────────────────────────────

update public.profiles set last_name = 'Núñez' where id = '5ea7c000-0000-4000-8000-000000000001';

select is(
  (select search_text from public.profiles where id = '5ea7c000-0000-4000-8000-000000000001'),
  'maria jose nunez mjmp@wustl.edu ingenieria biomedica',
  'a renamed member is found by the new name'
);

-- The sign-in address is copied to the profile by on_auth_user_email_changed.
update auth.users set email = 'mj.nunez@wustl.edu' where id = '5ea7c000-0000-4000-8000-000000000001';

select ok(
  (select search_text like '%mj.nunez@wustl.edu%' from public.profiles
    where id = '5ea7c000-0000-4000-8000-000000000001'),
  'and by a new email address'
);

select throws_ok(
  $$update public.profiles set search_text = 'anything'
     where id = '5ea7c000-0000-4000-8000-000000000002'$$,
  '428C9',
  'column "search_text" can only be updated to DEFAULT',
  'search_text can''t be written directly'
);


-- ── Row level security is unchanged ─────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"5ea7c000-0000-4000-8000-000000000002","role":"authenticated"}',
                  true);

select is_empty(
  $$select public.test_search(array['nunez'])$$,
  'a member searching finds no one else'
);

update public.profiles set major = 'Biología' where id = '5ea7c000-0000-4000-8000-000000000002';

select is(
  (select search_text from public.profiles where id = '5ea7c000-0000-4000-8000-000000000002'),
  'ana rivera ana.rivera@wustl.edu biologia',
  'a member saving their own profile updates their search text, generated column and all'
);

reset role;

select * from finish();
rollback;

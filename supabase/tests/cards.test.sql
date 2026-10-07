-- =============================================================================
-- cards.test.sql — member business cards
--
-- Run with:  supabase test db
--
-- The card is the one piece of member data designed to be shown to strangers,
-- so most of what is asserted here is what does NOT get out:
--
--   1. Nothing is reachable except through the functions. anon gets
--      get_public_card() and record_card_event() and nothing else; a member
--      gets their own card; an officer gets the audited admin_* functions.
--   2. A card that should not be seen looks exactly like one that does not
--      exist, and a starter card shows only what an officer-made card may.
--   3. Handles are permanent: old ones redirect, nobody else can take them,
--      the cap holds, and only an officer's reset frees one.
--   4. Everything a member writes is validated by the database however the
--      request was built: link schemes, the theme document, media folders.
--
-- Storage policy checks run only where a storage schema exists; elsewhere
-- they are reported as skipped, so the plan count holds either way.
--
-- Like every suite, this runs in one transaction and is rolled back.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(361);

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

-- A complete MemberCardInput, with overrides.
create or replace function public.test_card(p_handle text, p_extra jsonb default '{}')
returns jsonb language sql immutable as $$
  select '{
    "display_name": "José Peña",
    "pronouns": "he/him",
    "headline": "SWE Intern",
    "organization": "Washington University in St. Louis",
    "status_line": "Seeking Summer 2027 internships",
    "bio": "Hola. I build robots.",
    "location": "St. Louis",
    "skills": ["Python", "CAD"],
    "languages": ["English", "Español"],
    "avatar_path": null,
    "banner_path": null,
    "background_path": null,
    "show_major": true,
    "show_graduation_year": true,
    "show_member_since": false,
    "show_national_member": true,
    "show_chapter_position": true,
    "theme": {"preset": "shpe-classic"},
    "sections": ["status", "featured", "links", "about", "education", "shpe"],
    "allow_indexing": false
  }'::jsonb || jsonb_build_object('handle', p_handle) || coalesce(p_extra, '{}'::jsonb);
$$;

-- The caller's current links, in the shape save_my_card() takes, so a rename
-- does not also delete them.
create or replace function public.test_my_links() returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x -> 'id', 'kind', x -> 'kind', 'label', x -> 'label', 'value', x -> 'value',
           'is_featured', x -> 'is_featured', 'is_visible', x -> 'is_visible'
         ) order by (x ->> 'sort_order')::int), '[]'::jsonb)
    from jsonb_array_elements(public.get_my_card() -> 'links') x;
$$;

-- views/saves/shares/clicks for one member's card. Definer, so anon steps can
-- check that a no-op really counted nothing without switching roles.
create or replace function public.test_card_totals(p_member uuid) returns text
language sql security definer set search_path = '' as $$
  select format('%s/%s/%s/%s',
    coalesce((select sum(s.views)  from public.card_daily_stats s where s.member_id = p_member), 0),
    coalesce((select sum(s.saves)  from public.card_daily_stats s where s.member_id = p_member), 0),
    coalesce((select sum(s.shares) from public.card_daily_stats s where s.member_id = p_member), 0),
    coalesce((select sum(k.clicks) from public.card_link_daily_clicks k
                join public.member_card_links l on l.id = k.link_id
               where l.member_id = p_member), 0));
$$;

-- Sorted key list of a JSON object, to pin a payload's shape exactly.
create or replace function public.test_keys(p_obj jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_obj) k;
$$;
create or replace function public.test_sorted(p_keys text[]) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from unnest(p_keys) k;
$$;

-- Storage checks: skipped (and still counted) where there is no storage schema.
create or replace function public.test_storage_lives(p_sql text, p_desc text) returns text
language plpgsql as $$
begin
  if to_regclass('storage.objects') is null then
    return skip(p_desc || ' (no storage schema)', 1);
  end if;
  return lives_ok(p_sql, p_desc);
end;
$$;
create or replace function public.test_storage_throws(p_sql text, p_desc text) returns text
language plpgsql as $$
begin
  if to_regclass('storage.objects') is null then
    return skip(p_desc || ' (no storage schema)', 1);
  end if;
  return throws_ok(p_sql, '42501', null, p_desc);
end;
$$;
create or replace function public.test_storage_rows(p_sql text, p_expected integer, p_desc text) returns text
language plpgsql as $$
declare
  v_rows integer;
begin
  if to_regclass('storage.objects') is null then
    return skip(p_desc || ' (no storage schema)', 1);
  end if;
  execute p_sql;
  get diagnostics v_rows = row_count;
  return is(v_rows, p_expected, p_desc);
end;
$$;

grant execute on function public.test_login(uuid)                          to anon, authenticated;
grant execute on function public.test_card(text, jsonb)                    to anon, authenticated;
grant execute on function public.test_my_links()                           to anon, authenticated;
grant execute on function public.test_card_totals(uuid)                    to anon, authenticated;
grant execute on function public.test_keys(jsonb)                          to anon, authenticated;
grant execute on function public.test_sorted(text[])                       to anon, authenticated;
grant execute on function public.test_storage_lives(text, text)            to anon, authenticated;
grant execute on function public.test_storage_throws(text, text)           to anon, authenticated;
grant execute on function public.test_storage_rows(text, integer, text)    to anon, authenticated;

select public.test_login(null);

select public.test_create_user('caca0000-0000-4000-8000-000000000001', 'olga.oficial@wustl.edu',   'Olga',       'Oficial');
select public.test_create_user('caca0000-0000-4000-8000-000000000002', 'jose.pena@wustl.edu',      'José',       'Peña');
select public.test_create_user('caca0000-0000-4000-8000-000000000003', 'maria.garcia@wustl.edu',   'María José', 'García López');
select public.test_create_user('caca0000-0000-4000-8000-000000000004', 'pat.pending@wustl.edu',    'Pat',        'Pending');
select public.test_create_user('caca0000-0000-4000-8000-000000000005', 'sam.suspendido@wustl.edu', 'Sam',        'Suspendido');
select public.test_create_user('caca0000-0000-4000-8000-000000000006', 'alma.alumna@wustl.edu',    'Alma',       'Alumna');
select public.test_create_user('caca0000-0000-4000-8000-000000000007', 'd.gonzalez.noname@wustl.edu', '',         '');
select public.test_create_user('caca0000-0000-4000-8000-000000000008', 'diego.g1@wustl.edu',       'Diego',      'Gonzalez');
select public.test_create_user('caca0000-0000-4000-8000-000000000009', 'diego.g2@wustl.edu',       'Diego',      'Gonzalez');
select public.test_create_user('caca0000-0000-4000-8000-000000000010', 'diego.g3@wustl.edu',       'Diego',      'Gonzalez');
select public.test_create_user('caca0000-0000-4000-8000-000000000011', 'iris.inactiva@wustl.edu',  'Iris',       'Inactiva');
select public.test_create_user('caca0000-0000-4000-8000-000000000012', 'prez@wustl.edu',           'President',  '');
select public.test_create_user('caca0000-0000-4000-8000-000000000013', 'rosa.rios@wustl.edu',      'Rosa',       'Rios');
select public.test_create_user('caca0000-0000-4000-8000-000000000014', 'beto.bravo@wustl.edu',     'Beto',       'Bravo');

update public.profiles set membership_status = 'active', graduation_year = null
 where id::text like 'caca0000-0000-4000-8000-0000000000%';
update public.profiles set membership_status = 'pending'   where id = 'caca0000-0000-4000-8000-000000000004';
update public.profiles set membership_status = 'suspended' where id = 'caca0000-0000-4000-8000-000000000005';
update public.profiles set membership_status = 'alumni'    where id = 'caca0000-0000-4000-8000-000000000006';
update public.profiles set membership_status = 'inactive'  where id = 'caca0000-0000-4000-8000-000000000011';

update public.profiles
   set graduation_year = 2027, major = 'Computer Science', secondary_major = 'Spanish',
       degree_level = 'undergraduate', shpe_national_member = 'verified'
 where id = 'caca0000-0000-4000-8000-000000000002';
update public.profiles set graduation_year = 2028 where id = 'caca0000-0000-4000-8000-000000000003';
update public.profiles set graduation_year = 2027
 where id in ('caca0000-0000-4000-8000-000000000008',
              'caca0000-0000-4000-8000-000000000009',
              'caca0000-0000-4000-8000-000000000010');

insert into public.member_roles (member_id, role)
values ('caca0000-0000-4000-8000-000000000001', 'officer')
on conflict do nothing;

-- Start switched off, whatever seed.sql did.
update public.app_settings set value = 'false'::jsonb where key = 'cards_enabled';

-- Readable by every role this suite switches to.
create temporary table r (label text primary key, body jsonb);
create temporary table ids (k text primary key, id uuid not null);
grant all on r, ids to anon, authenticated;

-- The rows of the admin list, once section 16 has stored it.
create temporary view list_rows as
  select x.value as row from r, jsonb_array_elements(r.body -> 'rows') x where r.label = 'list';
grant select on list_rows to anon, authenticated;


-- =============================================================================
-- 1. NOTHING IS REACHABLE EXCEPT THROUGH THE FUNCTIONS
-- =============================================================================

set local role anon;
select public.test_login(null);

select throws_ok($$select * from public.member_cards$$,           '42501', null, 'anon cannot read member_cards');
select throws_ok($$select * from public.member_card_links$$,      '42501', null, 'anon cannot read member_card_links');
select throws_ok($$select * from public.card_handles$$,           '42501', null, 'anon cannot read card_handles');
select throws_ok($$select * from public.reserved_card_handles$$,  '42501', null, 'anon cannot read reserved_card_handles');
select throws_ok($$select * from public.chapter_positions$$,      '42501', null, 'anon cannot read chapter_positions');
select throws_ok($$select * from public.card_daily_stats$$,       '42501', null, 'anon cannot read card_daily_stats');
select throws_ok($$select * from public.card_link_daily_clicks$$, '42501', null, 'anon cannot read card_link_daily_clicks');
select throws_ok($$select * from public.card_handle_blocks$$,     '42501', null, 'anon cannot read card_handle_blocks');

select throws_ok($$select public.get_my_card()$$, '42501', null, 'anon cannot load an editor');
select throws_ok($$select public.check_card_handle('jose-pena')$$, '42501', null,
  'anon cannot check handles, so the namespace cannot be enumerated');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), '[]')$$, '42501', null,
  'anon cannot save a card');
select throws_ok($$select public.admin_list_cards()$$, '42501', null, 'anon cannot list cards');
select throws_ok($$select private.suggest_card_handle('caca0000-0000-4000-8000-000000000002')$$, '42501', null,
  'anon cannot reach the private helpers');

select is(public.get_public_card('nobody-here'), '{"status": "not_found"}'::jsonb,
  'anon can call get_public_card');
select lives_ok($$select public.record_card_event('nobody-here', 'view', 'nfc')$$,
  'anon can call record_card_event, and it never raises');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');

select throws_ok($$select * from public.member_cards$$, '42501', null,
  'a member cannot read member_cards directly, not even their own row');
select throws_ok($$insert into public.card_handles (handle, member_id) values ('grab-it', 'caca0000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member cannot write card_handles directly');
select throws_ok($$delete from public.card_handle_blocks$$, '42501', null,
  'a member cannot lift an officer''s handle block');
select throws_ok($$select private.suggest_card_handle('caca0000-0000-4000-8000-000000000003')$$, '42501', null,
  'a member cannot ask for someone else''s suggested handle');
select throws_ok($$select private.insert_officer_card('caca0000-0000-4000-8000-000000000003', 'sneaky', 'caca0000-0000-4000-8000-000000000002', true)$$,
  '42501', null, 'a member cannot call the definer that writes officer-made cards');

reset role;
select public.test_login(null);

select ok(
  not has_function_privilege('anon', 'public.save_my_card(jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_card()', 'execute')
  and not has_function_privilege('anon', 'public.admin_create_card(uuid, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_card_insights(integer)', 'execute'),
  'anon has no execute on any member or officer function'
);
select ok(
  has_function_privilege('anon', 'public.get_public_card(text)', 'execute')
  and has_function_privilege('anon', 'public.record_card_event(text, text, text, uuid)', 'execute'),
  'anon has exactly the two public functions'
);
select ok(
  not has_function_privilege('authenticated', 'private.card_theme_is_valid(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.cards_enabled()', 'execute')
  and not has_function_privilege('authenticated', 'private.card_is_public(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.card_json_in(jsonb, text[])', 'execute')
  and not has_function_privilege('authenticated', 'private.release_card_handle(uuid, text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.card_fallback_handle(uuid, text[])', 'execute'),
  'private card helpers carry no PUBLIC execute'
);
select ok(
  has_function_privilege('service_role', 'private.card_tags_ok(text[], integer, integer)', 'execute')
  and has_function_privilege('service_role', 'private.card_theme_is_valid(jsonb)', 'execute')
  and has_function_privilege('service_role', 'private.card_json_in(jsonb, text[])', 'execute')
  and has_function_privilege('service_role', 'private.card_link_value_ok(text, text)', 'execute'),
  'service_role can run the validators the CHECK constraints call'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('member_cards', 'member_card_links', 'card_handles', 'reserved_card_handles',
                        'chapter_positions', 'card_daily_stats', 'card_link_daily_clicks',
                        'card_handle_blocks')),
  0, 'no card table has a policy: every read goes through a function'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname in ('member_cards', 'member_card_links', 'card_handles', 'reserved_card_handles',
                        'chapter_positions', 'card_daily_stats', 'card_link_daily_clicks',
                        'card_handle_blocks')),
  8, 'RLS is on for all eight card tables'
);
select is((select count(*)::int from public.reserved_card_handles), 74,
  'reserved_card_handles holds exactly RESERVED_HANDLES from model.ts');


-- =============================================================================
-- 2. VALIDATORS
-- =============================================================================

-- ── Theme ──
select ok(private.card_theme_is_valid('{"preset":"shpe-classic"}'), 'theme: a bare preset is valid');
select ok(private.card_theme_is_valid('{
  "preset":"glass","layout":"banner",
  "colors":{"background":"#0b1f3a","surface":"#FFFFFF","text":"#1b365d","muted":"#4b5563","accent":"#e84e1b","accentText":"#ffffff"},
  "background":{"type":"gradient","from":"#1b365d","to":"#e84e1b","angle":135,"dim":40,"pattern":"topo"},
  "font":{"heading":"libre-franklin","body":"inter"},
  "buttons":{"shape":"pill","style":"glass","arrangement":"icon-grid","icons":false},
  "avatar":{"shape":"hidden","ring":true},
  "density":"compact"}'), 'theme: every key at once is valid');
select ok(not private.card_theme_is_valid('["shpe-classic"]'),                           'theme: not an object is refused');
select ok(not private.card_theme_is_valid('{"layout":"banner"}'),                        'theme: preset is required');
select ok(not private.card_theme_is_valid('{"preset":"neon"}'),                          'theme: unknown preset is refused');
select ok(not private.card_theme_is_valid('{"preset":null}'),                            'theme: null preset is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","css":"body{}"}'),          'theme: unknown top-level key is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","layout":"grid"}'),         'theme: unknown layout is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","colors":{"accent":"#12345g"}}'), 'theme: bad hex is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","colors":{"accent":"#fff"}}'),    'theme: short hex is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","colors":{"accent":"red"}}'),     'theme: named colors are refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","colors":{"link":"#ffffff"}}'),   'theme: unknown color key is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","background":{"from":"#ffffff"}}'), 'theme: background needs a type');
select ok(not private.card_theme_is_valid('{"preset":"paper","background":{"type":"image","url":"https://x.test/a.png"}}'),
  'theme: no URL can be smuggled into the background');
select ok(not private.card_theme_is_valid('{"preset":"paper","background":{"type":"gradient","angle":361}}'), 'theme: angle above 360 is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","background":{"type":"gradient","angle":1.5}}'), 'theme: fractional angle is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","background":{"type":"image","dim":81}}'),       'theme: dim above 80 is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","background":{"type":"image","dim":"10"}}'),     'theme: a numeric string is not a number');
select ok(not private.card_theme_is_valid('{"preset":"paper","font":{"heading":"comic-sans"}}'),              'theme: unknown font is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","buttons":{"icons":"yes"}}'),                    'theme: icons must be a boolean');
select ok(not private.card_theme_is_valid('{"preset":"paper","avatar":{"shape":"star"}}'),                    'theme: unknown avatar shape is refused');
select ok(not private.card_theme_is_valid('{"preset":"paper","density":"cozy"}'),                             'theme: unknown density is refused');
select ok(not private.card_theme_is_valid(jsonb_build_object('preset', 'paper', 'colors',
            (select jsonb_object_agg('k' || g, '#ffffff') from generate_series(1, 200) g))),
  'theme: a document stuffed with extra keys is refused');

-- ── Sections ──
select ok(private.card_sections_are_valid('["status","featured","links","about","education","shpe"]'), 'sections: the default is valid');
select ok(private.card_sections_are_valid('[]'),                                  'sections: showing no blocks is valid');
select ok(not private.card_sections_are_valid('["links","links"]'),               'sections: duplicates are refused');
select ok(not private.card_sections_are_valid('["links","guestbook"]'),           'sections: unknown blocks are refused');
select ok(not private.card_sections_are_valid('["links",1]'),                     'sections: non-strings are refused');
select ok(not private.card_sections_are_valid('{"links":true}'),                  'sections: must be an array');

-- ── Link values ──
select ok(private.card_link_value_ok('linkedin', 'https://www.linkedin.com/in/jose'), 'links: https is accepted');
select ok(not private.card_link_value_ok('website', 'http://example.com'),            'links: http is refused');
select ok(not private.card_link_value_ok('website', 'javascript:alert(1)'),           'links: javascript: is refused');
select ok(not private.card_link_value_ok('custom', 'data:text/html;base64,PHNjcmlwdD4='), 'links: data: is refused');
select ok(not private.card_link_value_ok('website', 'https://x.test/"onmouseover="x'),    'links: quotes cannot break out of an href');
select ok(not private.card_link_value_ok('website', 'https://x.test/' || repeat('a', 490)), 'links: over 500 characters is refused');
select ok(private.card_link_value_ok('email', 'jose@example.com'),                    'links: an email address is accepted');
select ok(not private.card_link_value_ok('email', 'jose@example'),                    'links: an email needs a domain with a dot');
select ok(private.card_link_value_ok('phone', '+1 (314) 555-0123'),                   'links: a phone number is accepted');
select ok(not private.card_link_value_ok('phone', '(((-)))'),                         'links: a phone number needs seven digits');

-- ── Handles and media paths ──
select ok(private.card_handle_shape_ok('jose-pena'),          'handle: letters and a hyphen are fine');
select ok(not private.card_handle_shape_ok('jo'),             'handle: two characters is too short');
select ok(not private.card_handle_shape_ok('jose--pena'),     'handle: double hyphens are refused');
select ok(not private.card_handle_shape_ok('-jose'),          'handle: a leading hyphen is refused');
select ok(not private.card_handle_shape_ok('Jose'),           'handle: uppercase is refused (callers lowercase first)');
select ok(not private.card_handle_shape_ok(repeat('a', 31)),  'handle: 31 characters is too long');
select ok(private.card_media_path_ok('caca0000-0000-4000-8000-000000000002',
            'caca0000-0000-4000-8000-000000000002/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp'),
  'media: a path in the owner''s folder is accepted');
select ok(not private.card_media_path_ok('caca0000-0000-4000-8000-000000000002',
            'caca0000-0000-4000-8000-000000000003/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp'),
  'media: a path in another member''s folder is refused');
select ok(not private.card_media_path_ok('caca0000-0000-4000-8000-000000000002',
            'https://evil.test/pixel.png'),
  'media: a URL is refused');


-- =============================================================================
-- 3. SUGGESTED HANDLES
-- =============================================================================

select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000002'), 'jose-pena',
  'accents fold: José Peña -> jose-pena');
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000003'), 'maria-garcia',
  'compound names shorten: María José García López -> maria-garcia');
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000003', '{maria-garcia}'),
  'maria-jose-garcia-lopez', 'collision falls through to the full name');
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000003', '{maria-garcia,maria-jose-garcia-lopez}'),
  'maria-garcia-28', '...then to the class year');
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000003',
            '{maria-garcia,maria-jose-garcia-lopez,maria-garcia-28}'),
  'maria-garcia-2', '...then to -2');
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000008', '{diego-gonzalez}'),
  'diego-gonzalez-27', 'a two-word name skips the full-name step');
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000012'), 'president-2',
  'reserved words are skipped');
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000007'), null,
  'no name means no suggestion -- never anything from the email');
select is(private.card_handle_fold('O''Neil-Smith Ñandú Straße'), 'oneil-smith-nandu-strasse',
  'apostrophes vanish, ß becomes ss, and everything else hyphenates');
select is(private.card_handle_cut('maximiliano-alejandro-fernandez-castellanos', 30), 'maximiliano-alejandro',
  'long names are cut at a hyphen, not mid-word');

-- Browsers submit names composed (NFC). Precomposed letters outside Latin-1
-- used to fall through to hyphens: 'Nguyễn' came out as 'nguy-n'.
select is(private.card_handle_fold('Nguyễn Thị Ánh'), 'nguyen-thi-anh',
  'fold: Vietnamese letters with stacked marks fold to their base letter');
select is(private.card_handle_fold('Trần Phạm Lương Ngọc'), 'tran-pham-luong-ngoc',
  'fold: horned and dotted Vietnamese vowels fold too');
select is(private.card_handle_fold(normalize('Nguyễn Thị Ánh', NFD)), 'nguyen-thi-anh',
  'fold: the same name typed decomposed gives the same handle');
select is(private.card_handle_fold('Łukasz Żółć Wąsik'), 'lukasz-zolc-wasik',
  'fold: Polish, including ł, which does not decompose');
select is(private.card_handle_fold('Ægir Ødegård Þórsdóttir Ðuro'), 'aegir-odegard-thorsdottir-duro',
  'fold: Nordic æ, ø, þ and ð');
select is(private.card_handle_fold('Jürgen Weiß STRAẞE'), 'jurgen-weiss-strasse',
  'fold: German umlauts and both cases of ß');
select is(private.card_handle_fold('Đặng İlkay Iğdır'), 'dang-ilkay-igdir',
  'fold: Vietnamese đ and Turkish dotted and dotless i');
select is(private.card_handle_fold('Иван 王芳'), '',
  'fold: a script with no Latin reading folds to nothing (callers fall back)');


-- =============================================================================
-- 4. SWITCHED OFF
-- =============================================================================

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');

select is(public.get_my_card(), '{"enabled": false}'::jsonb,
  'switched off, a member learns that and nothing else');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), '[]')$$,
  '22023', 'Business cards aren''t open yet', 'switched off, a member cannot save');
select throws_ok($$select public.admin_set_cards_enabled(true)$$, '42501', null,
  'a member cannot switch cards on');

select public.test_login('caca0000-0000-4000-8000-000000000004');
select throws_ok($$select public.get_my_card()$$, '42501', null, 'a pending account gets nothing');
select throws_ok($$select public.suggest_my_card_handle()$$, '42501', null,
  'a pending account cannot even get a suggestion');

select public.test_login('caca0000-0000-4000-8000-000000000001');
insert into r values ('olga-off', public.get_my_card());
select ok(
  (select body -> 'enabled' = 'false'::jsonb and body ? 'profile' and body -> 'card' = 'null'::jsonb
     from r where label = 'olga-off'),
  'switched off, an officer still gets their editor, to set up before launch'
);

select is(public.admin_set_cards_enabled(true), '{"ok": true, "enabled": true}'::jsonb,
  'an officer switches cards on');
select is((public.get_app_config()) -> 'cards_enabled', 'true'::jsonb,
  'get_app_config exposes the switch');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'cards.enabled'
                     and l.actor_id = 'caca0000-0000-4000-8000-000000000001'),
  'switching cards on is audited');


-- =============================================================================
-- 5. A MEMBER BUILDS A CARD
-- =============================================================================

select public.test_login('caca0000-0000-4000-8000-000000000002');

select is(public.suggest_my_card_handle(), 'jose-pena', 'the editor pre-fills the suggested handle');
select is(public.check_card_handle('jose-pena'), 'available',   'check: a free handle is available');
select is(public.check_card_handle(' Admin '),   'reserved',    'check: input is normalised, and reserved words say so');
select is(public.check_card_handle('a'),         'invalid',     'check: too short is invalid');
select is(public.check_card_handle('<script>'),  'invalid',     'check: junk is invalid');

-- ── Refusals, each a plain 22023 ──
select throws_ok($$select public.save_my_card(public.test_card('jose-pena') || '{"created_by":"caca0000-0000-4000-8000-000000000001"}', '[]')$$,
  '22023', 'Unknown card field: created_by', 'an unknown card key is refused, not ignored');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena') - 'bio', '[]')$$,
  '22023', 'The card is missing bio', 'a missing card key is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"display_name":"   "}'), '[]')$$,
  '22023', 'Enter the name to show on your card', 'a blank name is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', jsonb_build_object('bio', repeat('x', 601))), '[]')$$,
  '22023', 'Keep your bio to 600 characters or fewer', 'an over-long bio is refused');
select throws_ok($$select public.save_my_card(public.test_card('admin'), '[]')$$,
  '22023', 'That handle is reserved', 'a reserved handle is refused');
select throws_ok($$select public.save_my_card(public.test_card('jo--se'), '[]')$$,
  '22023', null, 'a malformed handle is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"theme":{"preset":"paper","script":"x"}}'), '[]')$$,
  '22023', null, 'a theme with an unknown key is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"theme":{"preset":"paper","colors":{"accent":"#ggg000"}}}'), '[]')$$,
  '22023', null, 'a theme with a bad hex is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"theme":{"preset":"paper","layout":"grid"}}'), '[]')$$,
  '22023', null, 'a theme with an unknown layout is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"sections":["links","links"]}'), '[]')$$,
  '22023', null, 'duplicate sections are refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"skills":["Python","python"]}'), '[]')$$,
  '22023', 'Each skill can only be listed once', 'skills are unique regardless of case');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', jsonb_build_object('skills', (select jsonb_agg('s' || g) from generate_series(1, 16) g))), '[]')$$,
  '22023', 'You can list up to 15 skills', 'more than 15 skills is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', jsonb_build_object('languages', jsonb_build_array(repeat('x', 31)))), '[]')$$,
  '22023', 'Keep each language to 30 characters or fewer', 'an over-long language is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"avatar_path":"caca0000-0000-4000-8000-000000000003/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp"}'), '[]')$$,
  '22023', 'That image didn''t upload correctly. Try again.', 'a photo from another member''s folder is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"show_major":"yes"}'), '[]')$$,
  '22023', null, 'a non-boolean toggle is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), '[{"kind":"website","label":null,"value":"javascript:alert(1)","is_featured":false,"is_visible":true}]')$$,
  '22023', 'Links have to be full addresses starting with https://', 'a javascript: link is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), '[{"kind":"custom","label":null,"value":"data:text/html,hi","is_featured":false,"is_visible":true}]')$$,
  '22023', null, 'a data: link is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), '[{"kind":"website","label":null,"value":"http://example.com","is_featured":false,"is_visible":true}]')$$,
  '22023', null, 'an http: link is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), '[{"kind":"myspace","label":null,"value":"https://myspace.com/j","is_featured":false,"is_visible":true}]')$$,
  '22023', 'Unknown link type', 'an unknown link kind is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), '[{"kind":"website","value":"https://a.test","onclick":"x"}]')$$,
  '22023', 'Unknown link field: onclick', 'an unknown link key is refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), '[{"kind":"website","label":null,"value":"https://a.test","is_featured":true,"is_visible":true},{"kind":"github","label":null,"value":"https://github.com/j","is_featured":true,"is_visible":true}]')$$,
  '22023', 'Only one link can be featured', 'two featured links are refused');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), (select jsonb_agg(jsonb_build_object('kind','website','value','https://a.test/' || g)) from generate_series(1, 21) g))$$,
  '22023', 'A card can have up to 20 links', 'more than 20 links is refused');

select is((public.get_my_card()) -> 'card', 'null'::jsonb, 'every refusal above left nothing behind');

-- ── The first save ──
insert into r values ('save1', public.save_my_card(public.test_card('jose-pena'), '[
  {"kind":"linkedin","label":null,"value":"https://www.linkedin.com/in/jose-pena","is_featured":false,"is_visible":true},
  {"kind":"email","label":null,"value":"jose@example.com","is_featured":false,"is_visible":true},
  {"kind":"phone","label":"Cell","value":"+1 314 555 0123","is_featured":false,"is_visible":false},
  {"kind":"website","label":"Portfolio","value":"https://jose.example.com","is_featured":true,"is_visible":true}
]'));
insert into ids select x ->> 'kind', (x ->> 'id')::uuid
  from r, jsonb_array_elements(r.body -> 'links') x where r.label = 'save1';

select is(public.test_keys((select body from r where label = 'save1')),
  public.test_sorted(array['enabled', 'card', 'links', 'position', 'profile']),
  'save_my_card returns MyCardState');
select is(public.test_keys((select body -> 'card' from r where label = 'save1')),
  public.test_sorted(array[
    'member_id', 'handle', 'is_published', 'allow_indexing', 'hidden_at', 'hidden_reason',
    'created_by_officer', 'member_opened_at', 'chip_handle', 'chip_handle_active', 'chip_written_at', 'display_name',
    'pronouns', 'headline', 'organization', 'status_line', 'bio', 'location', 'skills', 'languages',
    'avatar_path', 'banner_path', 'background_path', 'show_major', 'show_graduation_year',
    'show_member_since', 'show_national_member', 'show_chapter_position', 'theme', 'sections',
    'created_at', 'updated_at']),
  'the card has exactly the MemberCard keys');
select is(public.test_keys((select body -> 'profile' from r where label = 'save1')),
  public.test_sorted(array['first_name', 'last_name', 'major', 'secondary_major', 'graduation_year',
                           'degree_level', 'member_since', 'national_member_verified', 'membership_status']),
  'the profile has exactly the CardProfileFields keys');
select is(public.test_keys((select body -> 'links' -> 0 from r where label = 'save1')),
  public.test_sorted(array['id', 'kind', 'label', 'value', 'sort_order', 'is_featured', 'is_visible']),
  'each link has exactly the CardLink keys');
select ok(
  (select body -> 'card' ->> 'member_opened_at' is not null
      and body -> 'card' -> 'created_by_officer' = 'false'::jsonb
      and body -> 'card' -> 'is_published' = 'false'::jsonb
      and jsonb_array_length(body -> 'links') = 4
     from r where label = 'save1'),
  'the first save opens the card, unpublished, with all four links (hidden included)');
select is(public.check_card_handle('jose-pena'), 'yours', 'check: your own handle is yours');

-- ── Another member ──
select public.test_login('caca0000-0000-4000-8000-000000000003');

select is(public.check_card_handle('jose-pena'), 'taken', 'check: someone else''s handle is taken');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"display_name":"María García"}'), '[]')$$,
  '22023', 'That handle is taken', 'nobody can claim another member''s handle');
select throws_ok(
  format($$select public.save_my_card(public.test_card('maria-garcia', '{"display_name":"María García"}'),
           '[{"id":"%s","kind":"website","label":null,"value":"https://maria.test","is_featured":false,"is_visible":true}]')$$,
         (select id from ids where k = 'website')),
  '22023', 'That link isn''t on your card', 'another member''s link id is refused, not adopted');
select throws_ok($$select public.save_my_card(public.test_card('maria-garcia', '{"display_name":"María García"}'), '[{"id":"not-a-uuid","kind":"website","value":"https://maria.test"}]')$$,
  '22023', 'That link isn''t on your card', 'a malformed link id is refused');

insert into r values ('maria1', public.save_my_card(
  public.test_card('maria-garcia', '{"display_name":"María García"}'),
  '[{"kind":"github","label":null,"value":"https://github.com/mariag","is_featured":false,"is_visible":true}]'));
insert into ids select 'maria-github', (body -> 'links' -> 0 ->> 'id')::uuid from r where label = 'maria1';

select ok(
  (select body -> 'card' ->> 'member_id' = 'caca0000-0000-4000-8000-000000000003'
      and jsonb_array_length(body -> 'links') = 1
     from r where label = 'maria1'),
  'a member''s editor holds only their own card and links');

-- Rosa renames away from a handle that Beto might have wanted.
select public.test_login('caca0000-0000-4000-8000-000000000013');
select public.save_my_card(public.test_card('beto-bravo', '{"display_name":"Rosa Rios"}'), '[]');
select public.save_my_card(public.test_card('rosa-rios',  '{"display_name":"Rosa Rios"}'), '[]');

reset role;
select public.test_login(null);
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000014'), 'beto-bravo-2',
  'another member''s OLD handle is skipped too');
set local role authenticated;


-- =============================================================================
-- 6. PUBLISHING, AND WHAT A STRANGER SEES
-- =============================================================================

select public.test_login('caca0000-0000-4000-8000-000000000008');
select throws_ok($$select public.set_my_card_published(true)$$, '22023', 'Save your card first',
  'publishing needs a card');

select public.test_login('caca0000-0000-4000-8000-000000000002');
select is((public.set_my_card_published(true)) -> 'card' -> 'is_published', 'true'::jsonb,
  'a member publishes their card');

set local role anon;
select public.test_login(null);

insert into r values ('pub1', public.get_public_card('jose-pena'));

select is((select body ->> 'status' from r where label = 'pub1'), 'ok', 'a published card resolves');
select is(public.test_keys((select body -> 'card' from r where label = 'pub1')),
  public.test_sorted(array[
    'handle', 'display_name', 'pronouns', 'headline', 'organization', 'status_line', 'bio',
    'location', 'skills', 'languages', 'avatar_path', 'banner_path', 'background_path', 'theme',
    'sections', 'allow_indexing', 'is_starter', 'education', 'shpe', 'links']),
  'the public card has exactly the PublicCardData keys: no member_id, no email, no hidden fields');
select is((select body -> 'card' -> 'links' from r where label = 'pub1'),
  jsonb_build_array(
    jsonb_build_object('id', (select id from ids where k = 'linkedin'), 'kind', 'linkedin', 'label', null,
                       'value', 'https://www.linkedin.com/in/jose-pena', 'is_featured', false),
    jsonb_build_object('id', (select id from ids where k = 'email'), 'kind', 'email', 'label', null,
                       'value', 'jose@example.com', 'is_featured', false),
    jsonb_build_object('id', (select id from ids where k = 'website'), 'kind', 'website', 'label', 'Portfolio',
                       'value', 'https://jose.example.com', 'is_featured', true)),
  'visible links only, in order -- the hidden phone number never leaves the database');
select is((select body -> 'card' -> 'education' from r where label = 'pub1'),
  '{"major": "Computer Science", "secondary_major": "Spanish", "graduation_year": 2027, "degree_level": "undergraduate"}'::jsonb,
  'education comes live from the profile');
select is((select body -> 'card' -> 'shpe' from r where label = 'pub1'),
  '{"position": null, "member_since": null, "national_member_verified": true, "is_alumni": false}'::jsonb,
  'the National badge shows only because an officer verified it; member since is opt-in');
select is((public.get_public_card('  JOSE-PENA ')) ->> 'status', 'ok', 'the handle is normalised');
select is(public.get_public_card('maria-garcia'), '{"status": "not_found"}'::jsonb,
  'an unpublished card is not found');

-- Toggles cut the profile facts.
set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');
select public.save_my_card(
  public.test_card('jose-pena', '{"show_major":false,"show_graduation_year":false,"show_national_member":false}'),
  public.test_my_links());
set local role anon;
select public.test_login(null);
select ok(
  (select c -> 'education' = 'null'::jsonb
      and c -> 'shpe' -> 'national_member_verified' = 'false'::jsonb
     from (select (public.get_public_card('jose-pena')) -> 'card' as c) x),
  'with the toggles off, education is null and the badge is gone');
set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');
select public.save_my_card(public.test_card('jose-pena'), public.test_my_links());


-- =============================================================================
-- 7. COUNTING VISITS
-- =============================================================================

set local role anon;
select public.test_login(null);

select public.record_card_event('jose-pena', 'view', 'nfc');
select public.record_card_event(' JOSE-PENA ', 'view', 'qr');
select public.record_card_event('jose-pena', 'save', 'link');
select public.record_card_event('jose-pena', 'share', 'link');
select public.record_card_event('jose-pena', 'link_click', 'link', (select id from ids where k = 'website'));
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '2/1/1/1',
  'views, saves, shares and a link click are counted');

select public.record_card_event('jose-pena', 'like', 'nfc');
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '2/1/1/1', 'an unknown event is ignored');
select public.record_card_event('jose-pena', 'view', 'email');
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '2/1/1/1', 'an unknown source is ignored');
select public.record_card_event('jose-pena', 'link_click', 'link', (select id from ids where k = 'phone'));
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '2/1/1/1', 'a click on a hidden link is ignored');
select public.record_card_event('jose-pena', 'link_click', 'link', (select id from ids where k = 'maria-github'));
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '2/1/1/1', 'a click on another card''s link is ignored');
select public.record_card_event('jose-pena', 'link_click', 'link', null);
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '2/1/1/1', 'a click with no link is ignored');
select public.record_card_event('maria-garcia', 'view', 'nfc');
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000003'), '0/0/0/0', 'an unpublished card is not counted');
select lives_ok($$select public.record_card_event(null, null, null, null)$$, 'all-null input is a no-op, not an error');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');
select public.record_card_event('jose-pena', 'view', 'nfc');
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '2/1/1/1', 'the owner viewing their own card is not counted');

select public.test_login('caca0000-0000-4000-8000-000000000003');
select public.record_card_event('jose-pena', 'view', 'link');
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '3/1/1/1', 'another signed-in member is counted');


-- =============================================================================
-- 8. LINKS KEEP THEIR IDS ACROSS SAVES
-- =============================================================================

select public.test_login('caca0000-0000-4000-8000-000000000002');

insert into r values ('save2', public.save_my_card(public.test_card('jose-pena'), jsonb_build_array(
  jsonb_build_object('id', (select id from ids where k = 'website'), 'kind', 'website', 'label', 'Portfolio',
                     'value', 'https://jose.example.com', 'is_featured', false, 'is_visible', true),
  jsonb_build_object('id', (select id from ids where k = 'linkedin'), 'kind', 'linkedin', 'label', null,
                     'value', 'https://www.linkedin.com/in/jose-pena', 'is_featured', true, 'is_visible', true),
  jsonb_build_object('id', (select id from ids where k = 'phone'), 'kind', 'phone', 'label', 'Cell',
                     'value', '+1 314 555 0123', 'is_featured', false, 'is_visible', false),
  jsonb_build_object('kind', 'github', 'label', null, 'value', 'https://github.com/josepena',
                     'is_featured', false, 'is_visible', true))));

select is(
  (select jsonb_agg(x ->> 'id' order by (x ->> 'sort_order')::int) from r, jsonb_array_elements(r.body -> 'links') x
    where r.label = 'save2' and x ->> 'kind' <> 'github'),
  jsonb_build_array((select id from ids where k = 'website'), (select id from ids where k = 'linkedin'),
                    (select id from ids where k = 'phone')),
  'kept links keep their ids, in the new order');
select ok(
  (select not exists (select 1 from jsonb_array_elements(body -> 'links') x
                       where x ->> 'id' = (select id::text from ids where k = 'email'))
     from r where label = 'save2'),
  'a link left out is deleted');
select ok(
  (select (body -> 'links' -> 1 -> 'is_featured') = 'true'::jsonb and (body -> 'links' -> 0 -> 'is_featured') = 'false'::jsonb
     from r where label = 'save2'),
  'the featured flag can move from one link to another in one save');
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '3/1/1/1',
  'click history survives the save');
select throws_ok(
  format($$select public.save_my_card(public.test_card('jose-pena'),
           '[{"id":"%1$s","kind":"website","value":"https://a.test"},{"id":"%1$s","kind":"website","value":"https://b.test"}]')$$,
         (select id from ids where k = 'website')),
  '22023', 'The same link is listed twice', 'the same link id twice is refused');


-- =============================================================================
-- 9. RENAMES REDIRECT
-- =============================================================================

select public.save_my_card(public.test_card('jose-p'), public.test_my_links());

set local role anon;
select public.test_login(null);
select is(public.get_public_card('jose-pena'), '{"status": "redirect", "handle": "jose-p"}'::jsonb,
  'an old handle redirects to the current one');
select public.record_card_event('jose-pena', 'view', 'qr');
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '4/1/1/1',
  'a visit through an old handle counts for the card');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');
select is(public.check_card_handle('jose-pena'), 'yours', 'an old handle is still yours');
select public.test_login('caca0000-0000-4000-8000-000000000003');
select is(public.check_card_handle('jose-pena'), 'taken', 'and still taken to everyone else');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena', '{"display_name":"María García"}'), public.test_my_links())$$,
  '22023', 'That handle is taken', 'nobody can claim another member''s old handle');


-- =============================================================================
-- 10. INSIGHTS
-- =============================================================================

reset role;
select public.test_login(null);
insert into public.card_daily_stats (member_id, day, source, views)
values ('caca0000-0000-4000-8000-000000000002', (now() at time zone 'America/Chicago')::date - 3,  'link', 5),
       ('caca0000-0000-4000-8000-000000000002', (now() at time zone 'America/Chicago')::date - 40, 'nfc', 10);

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');
insert into r values ('ins7', public.get_my_card_insights(7));

select is((select body -> 'totals' from r where label = 'ins7'),
  '{"views": 9, "saves": 1, "shares": 1, "nfc": 1, "qr": 2, "link": 6}'::jsonb,
  'insights totals views by source, saves and shares for the window');
select is((select jsonb_array_length(body -> 'daily') from r where label = 'ins7'), 7,
  'one row per day in the window');
select is((select body -> 'daily' -> 6 ->> 'day' from r where label = 'ins7'),
  to_char((now() at time zone 'America/Chicago')::date, 'YYYY-MM-DD'),
  'oldest first, ending today (chapter time)');
select ok(
  (select (body -> 'daily' -> 0 -> 'views') = '0'::jsonb
      and (body -> 'daily' -> 3 -> 'views') = '5'::jsonb
      and (body -> 'daily' -> 6 -> 'views') = '4'::jsonb
     from r where label = 'ins7'),
  'days without visits are zero-filled');
select is(
  (select jsonb_agg(x ->> 'clicks' order by o) from r, jsonb_array_elements(r.body -> 'links') with ordinality t(x, o)
    where r.label = 'ins7'),
  '["1", "0", "0", "0"]'::jsonb,
  'every current link is listed in order, zero clicks included');
select is(((public.get_my_card_insights(30)) -> 'totals' ->> 'views')::int, 9,
  'a visit 40 days ago is outside the 30-day window');
select is(((public.get_my_card_insights(365)) -> 'totals' ->> 'views')::int, 19,
  '...and inside the 365-day one');
select throws_ok($$select public.get_my_card_insights(0)$$,   '22023', null, 'zero days is refused');
select throws_ok($$select public.get_my_card_insights(366)$$, '22023', null, 'more than a year is refused');

select public.test_login('caca0000-0000-4000-8000-000000000008');
insert into r values ('ins-none', public.get_my_card_insights());
select ok(
  (select body -> 'totals' = '{"views": 0, "saves": 0, "shares": 0, "nfc": 0, "qr": 0, "link": 0}'::jsonb
      and jsonb_array_length(body -> 'daily') = 30
      and body -> 'links' = '[]'::jsonb
     from r where label = 'ins-none'),
  'no card: zeros, thirty empty days and no links');


-- =============================================================================
-- 11. NOT FOUND LOOKS THE SAME FOR EVERY REASON
-- =============================================================================

-- Alma (alumni) publishes a card.
select public.test_login('caca0000-0000-4000-8000-000000000006');
select public.save_my_card(public.test_card('alma-alumna', '{"display_name":"Alma Alumna"}'), '[]');
select public.set_my_card_published(true);

set local role anon;
select public.test_login(null);
select is((public.get_public_card('alma-alumna')) -> 'card' -> 'shpe' -> 'is_alumni', 'true'::jsonb,
  'alumni keep their card: it is the alumni network');
select is(public.get_public_card('nobody-at-all'), '{"status": "not_found"}'::jsonb, 'not found: nonexistent');
select is(public.get_public_card('../../etc'),     '{"status": "not_found"}'::jsonb, 'not found: malformed');
select is(public.get_public_card('maria-garcia'),  '{"status": "not_found"}'::jsonb, 'not found: unpublished');

reset role;
select public.test_login(null);
update public.profiles set membership_status = 'pending' where id = 'caca0000-0000-4000-8000-000000000006';
select is(public.get_public_card('alma-alumna'), '{"status": "not_found"}'::jsonb, 'not found: pending owner');
update public.profiles set membership_status = 'suspended' where id = 'caca0000-0000-4000-8000-000000000006';
select is(public.get_public_card('alma-alumna'), '{"status": "not_found"}'::jsonb, 'not found: suspended owner');
update public.profiles set membership_status = 'inactive' where id = 'caca0000-0000-4000-8000-000000000006';
select is((public.get_public_card('alma-alumna')) ->> 'status', 'ok', 'inactive members keep a live card');
update public.profiles set membership_status = 'alumni' where id = 'caca0000-0000-4000-8000-000000000006';

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
select throws_ok($$select public.admin_set_card_hidden('caca0000-0000-4000-8000-000000000002', true, 'no')$$,
  '22023', null, 'hiding needs a real reason');
select is(public.admin_set_card_hidden('caca0000-0000-4000-8000-000000000002', true, 'Impersonating an officer'),
  '{"ok": true, "hidden": true}'::jsonb, 'an officer hides a card');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.hidden' and l.entity_id = 'caca0000-0000-4000-8000-000000000002'
                     and l.metadata ->> 'reason' = 'Impersonating an officer'),
  'hiding is audited with the reason');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.hidden' and l.entity_id = 'caca0000-0000-4000-8000-000000000002'
                     and l.metadata ->> 'display_name' = 'José Peña'
                     and l.metadata ->> 'handle' = 'jose-p'),
  'the hide audit row says whose card it was: name and current handle');

set local role anon;
select public.test_login(null);
select is(public.get_public_card('jose-p'),    '{"status": "not_found"}'::jsonb, 'not found: hidden');
select is(public.get_public_card('jose-pena'), '{"status": "not_found"}'::jsonb,
  'not found: a hidden card''s old handle does not redirect either');
select public.record_card_event('jose-p', 'view', 'nfc');
-- 19 = the 4 views counted above plus the 15 inserted for the insights window.
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000002'), '19/1/1/1', 'a hidden card is not counted');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');
select is((public.get_my_card()) -> 'card' ->> 'hidden_reason', 'Impersonating an officer',
  'the member sees why their card was hidden');

select public.test_login('caca0000-0000-4000-8000-000000000001');
select public.admin_set_card_hidden('caca0000-0000-4000-8000-000000000002', false);
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.unhidden' and l.entity_id = 'caca0000-0000-4000-8000-000000000002'
                     and l.metadata ->> 'display_name' = 'José Peña'),
  'unhiding is audited, with the member''s name');
select public.admin_set_cards_enabled(false);

set local role anon;
select public.test_login(null);
select is(public.get_public_card('jose-p'), '{"status": "not_found"}'::jsonb, 'not found: feature switched off');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
select public.admin_set_cards_enabled(true);
set local role anon;
select public.test_login(null);
select is((public.get_public_card('jose-p')) ->> 'status', 'ok', 'and back once it is on again');


-- =============================================================================
-- 12. OFFICER TOOLS REFUSE MEMBERS
-- =============================================================================

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000003');

select throws_ok($$select public.admin_create_card('caca0000-0000-4000-8000-000000000008')$$, '42501', null,
  'a member cannot create a card for someone');
select throws_ok($$select public.admin_create_missing_cards(false, true)$$, '42501', null,
  'a member cannot even preview bulk creation');
select throws_ok($$select public.admin_mark_chips_written(array['caca0000-0000-4000-8000-000000000003'::uuid])$$, '42501', null,
  'a member cannot mark chips written');
select throws_ok($$select public.admin_set_card_hidden('caca0000-0000-4000-8000-000000000002', true, 'Because I can')$$, '42501', null,
  'a member cannot hide someone else''s card');
select throws_ok($$select public.admin_reset_card_handle('caca0000-0000-4000-8000-000000000002', 'Because I can')$$, '42501', null,
  'a member cannot reset someone else''s handle');
select throws_ok($$select public.admin_set_chapter_position('caca0000-0000-4000-8000-000000000003', 'President')$$, '42501', null,
  'a member cannot give themselves a chapter position');
select throws_ok($$select public.admin_list_cards()$$, '42501', null, 'a member cannot list every card');
select throws_ok($$select public.admin_suggest_card_handle('caca0000-0000-4000-8000-000000000002')$$, '42501', null,
  'a member cannot ask for another member''s handle');


-- =============================================================================
-- 13. VERIFIED POSITIONS
-- =============================================================================

select public.test_login('caca0000-0000-4000-8000-000000000001');

select throws_ok($$select public.admin_set_chapter_position('caca0000-0000-4000-8000-000000000002', 'X')$$, '22023', null,
  'a one-letter position is refused');
select is(public.admin_set_chapter_position('caca0000-0000-4000-8000-000000000002', '  President  '),
  '{"ok": true, "title": "President"}'::jsonb, 'an officer sets a position');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.position_set' and l.entity_id = 'caca0000-0000-4000-8000-000000000002'
                     and l.metadata = '{"title": "President", "display_name": "José Peña", "handle": "jose-p"}'::jsonb),
  'setting a position is audited, with whose card it is');

set local role anon;
select public.test_login(null);
select is((public.get_public_card('jose-p')) -> 'card' -> 'shpe' ->> 'position', 'President',
  'the verified position shows on the card');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
select is(public.admin_set_chapter_position('caca0000-0000-4000-8000-000000000002', ''),
  '{"ok": true, "title": null}'::jsonb, 'a blank title clears it');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.position_cleared' and l.entity_id = 'caca0000-0000-4000-8000-000000000002'
                     and l.metadata ->> 'display_name' = 'José Peña'),
  'clearing a position is audited, with the member''s name');


-- =============================================================================
-- 14. OFFICER-MADE CARDS
-- =============================================================================

select throws_ok($$select public.admin_create_card('caca0000-0000-4000-8000-000000000004')$$,
  '22023', 'That member hasn''t been approved yet', 'no card for a pending account');
select throws_ok($$select public.admin_create_card('caca0000-0000-4000-8000-000000000007')$$,
  '22023', 'Add a name to their profile first', 'no card for a member with no name');
select throws_ok($$select public.admin_create_card('caca0000-0000-4000-8000-000000000002')$$,
  '22023', 'That member already has a card', 'one card per member');
select throws_ok($$select public.admin_create_card('caca0000-0000-4000-8000-000000000008', 'president')$$,
  '22023', 'That handle is reserved', 'officers cannot hand out reserved words either');
select throws_ok($$select public.admin_create_card('caca0000-0000-4000-8000-000000000008', 'jose-pena')$$,
  '22023', 'That handle is taken', 'officers cannot hand out someone''s old handle');

select is(public.admin_suggest_card_handle('caca0000-0000-4000-8000-000000000008'), 'diego-gonzalez',
  'officers see the same suggestion the member would');
select is(public.admin_create_card('caca0000-0000-4000-8000-000000000008'),
  '{"ok": true, "member_id": "caca0000-0000-4000-8000-000000000008", "handle": "diego-gonzalez", "is_published": false}'::jsonb,
  'an officer creates a card with the suggested handle, unpublished by default');
select is(public.admin_suggest_card_handle('caca0000-0000-4000-8000-000000000008'), 'diego-gonzalez',
  'once a member has a card, the suggestion is their current handle');
select is(public.admin_suggest_card_handle('caca0000-0000-4000-8000-000000000009'), 'diego-gonzalez-27',
  'the next Diego Gonzalez gets the class year');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.created' and l.entity_type = 'member'
                     and l.entity_id = 'caca0000-0000-4000-8000-000000000008'
                     and l.metadata = '{"handle": "diego-gonzalez", "published": false, "display_name": "Diego Gonzalez"}'::jsonb),
  'card creation is audited, with the member''s name');

reset role;
select public.test_login(null);
select ok(
  (select c.display_name = 'Diego Gonzalez'
      and c.organization = 'Washington University in St. Louis'
      and c.created_by = 'caca0000-0000-4000-8000-000000000001'
      and c.officer_created
      and c.member_opened_at is null
      and c.pronouns is null and c.headline is null and c.bio is null and c.status_line is null
      and c.location is null and c.avatar_path is null and c.banner_path is null
      and c.background_path is null and c.skills = '{}' and c.languages = '{}'
     from public.member_cards c where c.member_id = 'caca0000-0000-4000-8000-000000000008'),
  'an officer-made card has the name and school and nothing else');
select is((select count(*)::int from public.member_card_links l where l.member_id = 'caca0000-0000-4000-8000-000000000008'),
  0, 'an officer-made card has no links, email or phone');
select is(public.get_public_card('diego-gonzalez'), '{"status": "not_found"}'::jsonb,
  'an unpublished officer-made card is not found');

-- A published starter card -- and then the row stuffed with everything the
-- starter rule must keep out, to show the rule is enforced on the way out.
set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
select is((public.admin_create_card('caca0000-0000-4000-8000-000000000011', ' Iris-Starter ', true)) ->> 'handle',
  'iris-starter', 'an officer can choose the handle and publish a starter card');

reset role;
select public.test_login(null);
update public.profiles
   set major = 'Physics', graduation_year = 2026, degree_level = 'undergraduate', shpe_national_member = 'verified'
 where id = 'caca0000-0000-4000-8000-000000000011';
update public.member_cards
   set pronouns = 'they/them', headline = 'Leak', status_line = 'Leak', bio = 'Leak', location = 'Leak',
       skills = '{Leak}', languages = '{Leak}', show_member_since = true, allow_indexing = true,
       avatar_path = 'caca0000-0000-4000-8000-000000000011/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp',
       theme = '{"preset":"midnight"}', sections = '["about"]'
 where member_id = 'caca0000-0000-4000-8000-000000000011';
insert into public.member_card_links (member_id, kind, value, sort_order)
values ('caca0000-0000-4000-8000-000000000011', 'email', 'iris@example.com', 0);
insert into public.chapter_positions (member_id, title) values ('caca0000-0000-4000-8000-000000000011', 'Secretary');
insert into ids select 'iris-email', id from public.member_card_links
 where member_id = 'caca0000-0000-4000-8000-000000000011';

set local role anon;
select public.test_login(null);
insert into r values ('starter', public.get_public_card('iris-starter'));

select is(public.test_keys((select body -> 'card' from r where label = 'starter')),
  public.test_sorted(array[
    'handle', 'display_name', 'pronouns', 'headline', 'organization', 'status_line', 'bio',
    'location', 'skills', 'languages', 'avatar_path', 'banner_path', 'background_path', 'theme',
    'sections', 'allow_indexing', 'is_starter', 'education', 'shpe', 'links']),
  'a starter card has the same shape as any other');
select is(
  (select (body -> 'card') - 'handle' - 'display_name' - 'organization' - 'education' from r where label = 'starter'),
  '{
    "pronouns": null, "headline": null, "status_line": null, "bio": null, "location": null,
    "skills": [], "languages": [], "avatar_path": null, "banner_path": null, "background_path": null,
    "theme": {"preset": "shpe-classic"},
    "sections": ["status", "featured", "links", "about", "education", "shpe"],
    "allow_indexing": false, "is_starter": true,
    "shpe": {"position": "Secretary", "member_since": null, "national_member_verified": false, "is_alumni": false},
    "links": []
  }'::jsonb,
  'a starter card leaks nothing: whatever the row holds, only name, school, education and position');
select ok(
  (select body -> 'card' ->> 'display_name' = 'Iris Inactiva'
      and body -> 'card' ->> 'organization' = 'Washington University in St. Louis'
      and body -> 'card' -> 'education' ->> 'major' = 'Physics'
      and (body -> 'card' -> 'education' ->> 'graduation_year')::int = 2026
     from r where label = 'starter'),
  'a starter card shows the name, school, major and class year');
select public.record_card_event('iris-starter', 'link_click', 'link', (select id from ids where k = 'iris-email'));
select is(public.test_card_totals('caca0000-0000-4000-8000-000000000011'), '0/0/0/0',
  'a starter card shows no links, so none can be clicked');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000011');
insert into r values ('iris-editor', public.get_my_card());
select ok(
  (select body -> 'card' -> 'created_by_officer' = 'true'::jsonb and body -> 'card' -> 'member_opened_at' = 'null'::jsonb
     from r where label = 'iris-editor'),
  'the member''s editor knows an officer set the card up and it has not been opened');
select is(public.suggest_my_card_handle(), 'iris-starter',
  'the editor pre-fills the officer-chosen handle');
select ok(
  ((public.save_my_card(public.test_card('iris-starter', '{"display_name":"Iris Inactiva"}'), '[]')) -> 'card' ->> 'member_opened_at') is not null,
  'the member''s first save sets member_opened_at');
set local role anon;
select public.test_login(null);
select is((public.get_public_card('iris-starter')) -> 'card' -> 'is_starter', 'false'::jsonb,
  'once opened, it is the member''s card, not a starter');


-- =============================================================================
-- 15. CHIPS, THE HANDLE CAP, AND RESETS
-- =============================================================================

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');

select throws_ok($$select public.admin_mark_chips_written('{}')$$, '22023', null, 'marking nobody is refused');
select is(public.admin_mark_chips_written(array['caca0000-0000-4000-8000-000000000002'::uuid,
                                                'caca0000-0000-4000-8000-000000000009'::uuid]),
  '{"ok": true, "count": 1, "skipped": ["caca0000-0000-4000-8000-000000000009"]}'::jsonb,
  'chips are marked only for members who have a card; the rest are listed as skipped');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.chips_written' and (l.metadata ->> 'count')::int = 1),
  'marking chips is audited');

select public.test_login('caca0000-0000-4000-8000-000000000002');
select is((public.get_my_card()) -> 'card' ->> 'chip_handle', 'jose-p', 'the card records the handle on the chip');
select is((public.get_my_card()) -> 'card' -> 'chip_handle_active', 'true'::jsonb,
  'a freshly written chip lands on the card');

select public.save_my_card(public.test_card('jose-pena-cs'), public.test_my_links());
set local role anon;
select public.test_login(null);
select is(public.get_public_card('jose-p'), '{"status": "redirect", "handle": "jose-pena-cs"}'::jsonb,
  'after a rename, the chip''s handle still lands on the current card');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');
select is((public.get_my_card()) -> 'card' -> 'chip_handle_active', 'true'::jsonb,
  'after a rename the chip is still active, because its handle redirects');
select lives_ok($$select public.save_my_card(public.test_card('jose-four'), public.test_my_links())$$, 'a fourth handle is fine');
select lives_ok($$select public.save_my_card(public.test_card('jose-five'), public.test_my_links())$$, 'a fifth handle is fine');
select throws_ok($$select public.save_my_card(public.test_card('jose-six'), public.test_my_links())$$,
  '22023', null, 'a sixth is refused: five handles per member, ever');
select is(((public.save_my_card(public.test_card('jose-pena'), public.test_my_links())) -> 'card' ->> 'handle'),
  'jose-pena', 'going back to a handle you already hold is always allowed');
select is(jsonb_array_length((public.get_my_card()) -> 'links'), 4, 'renames never touched the links');

select public.test_login('caca0000-0000-4000-8000-000000000001');
select throws_ok($$select public.admin_reset_card_handle('caca0000-0000-4000-8000-000000000002', 'x')$$, '22023', null,
  'a reset needs a reason');
select is(public.admin_reset_card_handle('caca0000-0000-4000-8000-000000000002', 'Impersonating the chapter'),
  '{"ok": true, "old_handle": "jose-pena", "handle": "jose-pena-27"}'::jsonb,
  'a reset assigns the member''s next suggested handle');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.handle_reset'
                     and l.metadata = '{"old_handle": "jose-pena", "new_handle": "jose-pena-27", "reason": "Impersonating the chapter",
                                        "display_name": "José Peña", "handle": "jose-pena-27"}'::jsonb),
  'a reset is audited, with the member''s name');

set local role anon;
select public.test_login(null);
select is(public.get_public_card('jose-pena'), '{"status": "not_found"}'::jsonb,
  'the reset handle is freed: it no longer redirects');
select is(public.get_public_card('jose-p'), '{"status": "redirect", "handle": "jose-pena-27"}'::jsonb,
  'the member''s other old handles still redirect');

-- The member it was taken from cannot take it back -- on purpose, or by
-- saving from an editor that still holds the old handle.
set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000002');
select is(public.check_card_handle('jose-pena'), 'removed',
  'the reset member is told an officer removed the handle, not that it is available');
select throws_ok($$select public.save_my_card(public.test_card('jose-pena'), public.test_my_links())$$,
  '22023', 'An officer removed that handle from your card. Pick a different one.',
  'a stale editor saving the old handle fails clearly instead of undoing the reset');
select is((public.get_my_card()) -> 'card' ->> 'handle', 'jose-pena-27',
  'and the card keeps the handle the reset gave it');

reset role;
select public.test_login(null);
select ok(private.suggest_card_handle('caca0000-0000-4000-8000-000000000002') is distinct from 'jose-pena',
  'suggestions never offer a member a handle an officer released from them');
select ok(exists (select 1 from public.card_handle_blocks b
                   where b.handle = 'jose-pena' and b.member_id = 'caca0000-0000-4000-8000-000000000002'
                     and b.reason = 'Impersonating the chapter'
                     and b.blocked_by = 'caca0000-0000-4000-8000-000000000001'),
  'the reset records who blocked the handle, for whom, and why');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000003');
select is(public.check_card_handle('jose-pena'), 'available', 'and anyone else may now claim it');
select is((public.save_my_card(public.test_card('jose-pena', '{"display_name":"María García"}'), public.test_my_links())) -> 'card' ->> 'handle',
  'jose-pena', 'another member really can claim it');
select public.save_my_card(public.test_card('maria-garcia', '{"display_name":"María García"}'), public.test_my_links());


-- =============================================================================
-- 16. THE OFFICER LIST
-- =============================================================================

select public.test_login('caca0000-0000-4000-8000-000000000001');
insert into r values ('list', public.admin_list_cards());

select is((select body -> 'enabled' from r where label = 'list'), 'true'::jsonb, 'the list carries the switch');
select is(public.test_keys((select row from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000002')),
  public.test_sorted(array['member_id', 'first_name', 'last_name', 'email', 'membership_status', 'handle',
    'status', 'is_published', 'hidden_at', 'hidden_reason', 'created_by_officer', 'member_opened_at',
    'chip_handle', 'chip_handle_active', 'chip_written_at', 'old_handles', 'position', 'views_30d', 'updated_at']),
  'each row has exactly the AdminCardRow keys');
-- All claimed in this one transaction, so claimed_at ties and the handle
-- breaks it; the release section checks oldest-first with real timestamps.
select is((select row -> 'old_handles' from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000002'),
  '["jose-five", "jose-four", "jose-p", "jose-pena-cs"]'::jsonb,
  'old_handles lists every other handle the member holds -- not the current one, not the reset one');
select is((select row -> 'old_handles' from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000007'),
  '[]'::jsonb, 'no card: old_handles is empty');
select is((select row -> 'created_by_officer' from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000008'),
  'true'::jsonb, 'an officer-made card is flagged as one');
select ok(
  (select row ->> 'status' = 'published' and row ->> 'handle' = 'jose-pena-27'
      and (row ->> 'views_30d')::int = 9 and row ->> 'chip_handle' = 'jose-p'
     from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000002'),
  'a published card shows its handle, chip and 30-day views');
select is((select row ->> 'status' from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000008'),
  'officer_unopened', 'an officer-made card nobody has opened says so');
select is((select row ->> 'status' from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000003'),
  'member', 'a member''s unpublished card is a member draft');
select ok(
  (select row ->> 'status' = 'none' and row -> 'handle' = 'null'::jsonb
     from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000007'),
  'members without a card are listed too');
select ok(
  not exists (select 1 from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000004'),
  'pending accounts are not listed');
select is((select row -> 'chip_handle_active' from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000002'),
  'true'::jsonb, 'a chip on an old handle that still redirects is listed as active');
select is((select row -> 'chip_handle_active' from list_rows where row ->> 'member_id' = 'caca0000-0000-4000-8000-000000000007'),
  'null'::jsonb, 'no card, no chip: chip_handle_active is null');

-- A chip written with the current handle, which a reset then deletes, is dead:
-- the row has to say so, so officers know to rewrite it.
select public.admin_mark_chips_written(array['caca0000-0000-4000-8000-000000000002'::uuid]);
select lives_ok($$select public.admin_reset_card_handle('caca0000-0000-4000-8000-000000000002', 'Offensive handle')$$,
  'a second reset, this time of the handle on the chip');
insert into r values ('list2', public.admin_list_cards());
select is((select x -> 'chip_handle_active' from r, jsonb_array_elements(r.body -> 'rows') x
            where r.label = 'list2' and x ->> 'member_id' = 'caca0000-0000-4000-8000-000000000002'),
  'false'::jsonb, 'after a reset of the chip''s handle, the list shows the chip as dead');
select public.test_login('caca0000-0000-4000-8000-000000000002');
select is((public.get_my_card()) -> 'card' -> 'chip_handle_active', 'false'::jsonb,
  'and so does the member''s own card');
select public.test_login('caca0000-0000-4000-8000-000000000001');


-- =============================================================================
-- 17. CREATE CARDS FOR EVERYONE MISSING ONE
-- =============================================================================

-- Seeded members step out of the way for the duration.
reset role;
select public.test_login(null);
update public.profiles set membership_status = 'inactive'
 where id::text not like 'caca0000-0000-4000-8000-0000000000%';
insert into r values ('cards-before', to_jsonb((select count(*) from public.member_cards)));

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
insert into r values ('dry', public.admin_create_missing_cards(true));

select is(
  (select jsonb_agg(x -> 'handle' order by o) from r, jsonb_array_elements(r.body -> 'created') with ordinality t(x, o)
    where r.label = 'dry'),
  '["president-2", "beto-bravo-2", "diego-gonzalez-27", "diego-gonzalez-2", "olga-oficial"]'::jsonb,
  'the preview proposes a handle per member, and two people with one name get distinct ones');
select is((select body -> 'skipped' from r where label = 'dry'),
  '[{"member_id": "caca0000-0000-4000-8000-000000000007", "name": "", "email": "d.gonzalez.noname@wustl.edu", "reason": "no_name"}]'::jsonb,
  'members with no name are skipped and listed, not given a meaningless handle');
select ok(
  (select body -> 'dry_run' = 'true'::jsonb and body -> 'published' = 'true'::jsonb
      and not (body::text like '%caca0000-0000-4000-8000-000000000004%')
      and not (body::text like '%caca0000-0000-4000-8000-000000000002%')
     from r where label = 'dry'),
  'pending members and members with a card are left out');

reset role;
select public.test_login(null);
select is((select count(*)::int from public.member_cards), (select (body #>> '{}')::int from r where label = 'cards-before'),
  'a dry run writes nothing');
select ok(not exists (select 1 from public.admin_audit_log where action = 'card.bulk_created'),
  'a dry run is not audited');

-- Simulate a race: just as Olga's handle is inserted, someone else claims it.
create function pg_temp.steal_handle() returns trigger language plpgsql as $$
begin
  if new.handle = 'olga-oficial' and new.member_id = 'caca0000-0000-4000-8000-000000000001' then
    insert into public.card_handles (handle, member_id) values ('olga-oficial', 'caca0000-0000-4000-8000-000000000013');
  end if;
  return new;
end;
$$;
create trigger steal_handle before insert on public.card_handles
  for each row execute function pg_temp.steal_handle();

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
insert into r values ('bulk', public.admin_create_missing_cards(false, false));

select is(
  (select jsonb_agg(x -> 'handle' order by o) from r, jsonb_array_elements(r.body -> 'created') with ordinality t(x, o)
    where r.label = 'bulk'),
  '["president-2", "beto-bravo-2", "diego-gonzalez-27", "diego-gonzalez-2", "olga-oficial-2"]'::jsonb,
  'a handle lost mid-run moves that member to their next candidate without failing the batch');
select is((select body -> 'created' -> 2 ->> 'name' from r where label = 'bulk'), 'Diego Gonzalez',
  'each created card reports the member''s name');

reset role;
select public.test_login(null);
drop trigger steal_handle on public.card_handles;

select is((select count(*)::int from public.member_cards
            where member_id in ('caca0000-0000-4000-8000-000000000001', 'caca0000-0000-4000-8000-000000000009',
                                'caca0000-0000-4000-8000-000000000010', 'caca0000-0000-4000-8000-000000000012',
                                'caca0000-0000-4000-8000-000000000014')
              and not is_published),
  5, 'the real run wrote five unpublished cards');
select ok(
  (select member_opened_at is null from public.member_cards where member_id = 'caca0000-0000-4000-8000-000000000009')
  and (select member_opened_at is not null from public.member_cards where member_id = 'caca0000-0000-4000-8000-000000000001'),
  'cards are starters until opened -- except the officer''s own, which they made themselves');
select is((select metadata from public.admin_audit_log where action = 'card.bulk_created'),
  '{"count": 5, "published": false}'::jsonb, 'one audit row for the whole batch');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
select is((public.admin_create_missing_cards(false, false)) -> 'created', '[]'::jsonb,
  'running it again creates nothing');
select is((select count(*)::int from public.admin_audit_log where action = 'card.bulk_created'), 1,
  'and an empty run is not audited');


-- =============================================================================
-- 18. STORAGE: OWN FOLDER ONLY
-- =============================================================================

select public.test_login('caca0000-0000-4000-8000-000000000002');
select public.test_storage_lives(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000002/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')$$,
  'storage: a member uploads into their own folder');
select public.test_storage_throws(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000003/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')$$,
  'storage: a member cannot upload into another member''s folder');
select public.test_storage_throws(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000002/sub/evil.html')$$,
  'storage: only well-formed image paths, even in your own folder');
select public.test_storage_rows(
  $$select 1 from storage.objects where bucket_id = 'card-media'$$, 1,
  'storage: a member sees their own objects');
select public.test_storage_throws(
  $$update storage.objects set name = 'caca0000-0000-4000-8000-000000000003/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp' where bucket_id = 'card-media'$$,
  'storage: a member cannot move an object into someone else''s folder');

select public.test_login('caca0000-0000-4000-8000-000000000003');
select public.test_storage_rows(
  $$select 1 from storage.objects where bucket_id = 'card-media'$$, 0,
  'storage: another member cannot list it');
select public.test_storage_rows(
  $$delete from storage.objects where bucket_id = 'card-media'$$, 0,
  'storage: another member cannot delete it');

select public.test_login('caca0000-0000-4000-8000-000000000004');
select public.test_storage_throws(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000004/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')$$,
  'storage: a pending account cannot upload at all');

select public.test_login('caca0000-0000-4000-8000-000000000005');
select public.test_storage_throws(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000005/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')$$,
  'storage: a suspended member cannot upload either');

-- The per-member cap: 29 objects already in María's folder.
reset role;
select public.test_login(null);
select public.test_storage_rows(
  $$insert into storage.objects (bucket_id, name)
    select 'card-media', 'caca0000-0000-4000-8000-000000000003/' || gen_random_uuid() || '.webp'
      from generate_series(1, 29)$$, 29,
  'storage: (setup) 29 objects in one member''s folder');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000003');
select public.test_storage_lives(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000003/1b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')$$,
  'storage: the 30th upload is allowed');
select public.test_storage_throws(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000003/2b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')$$,
  'storage: the 31st is refused -- one member cannot fill the bucket');
select public.test_login('caca0000-0000-4000-8000-000000000006');
select public.test_storage_lives(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000006/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')$$,
  'storage: a full folder does not stop anyone else uploading');

-- Admins clean up after a deleted account: read and delete in any folder.
reset role;
select public.test_login(null);
select public.test_create_user('caca0000-0000-4000-8000-000000000015', 'ada.admin@wustl.edu', 'Ada', 'Admin');
update public.profiles set membership_status = 'inactive' where id = 'caca0000-0000-4000-8000-000000000015';
insert into public.member_roles (member_id, role) values ('caca0000-0000-4000-8000-000000000015', 'admin');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
select public.test_storage_rows(
  $$delete from storage.objects where bucket_id = 'card-media' and name like 'caca0000-0000-4000-8000-000000000006/%'$$, 0,
  'storage: an officer who is not an admin cannot delete other members'' images');
select public.test_login('caca0000-0000-4000-8000-000000000015');
select public.test_storage_rows(
  $$select 1 from storage.objects where bucket_id = 'card-media'$$, 32,
  'storage: an admin can list every folder');
select public.test_storage_rows(
  $$delete from storage.objects where bucket_id = 'card-media' and name like 'caca0000-0000-4000-8000-000000000003/%'$$, 30,
  'storage: an admin can empty a member''s folder');
select public.test_storage_throws(
  $$insert into storage.objects (bucket_id, name) values ('card-media', 'caca0000-0000-4000-8000-000000000003/3b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')$$,
  'storage: but cannot put an image in anyone else''s folder');

select public.test_login('caca0000-0000-4000-8000-000000000002');
select public.test_storage_rows(
  $$delete from storage.objects where bucket_id = 'card-media'$$, 1,
  'storage: the owner can delete their own object');

reset role;
select public.test_login(null);
select public.test_storage_rows(
  $$select 1 from storage.buckets where id = 'card-media' and public and file_size_limit = 2097152
      and allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']$$, 1,
  'storage: the bucket is public, 2 MB, images only');


-- =============================================================================
-- 19. RELEASING A HANDLE, CURRENT OR OLD
-- =============================================================================

-- Rosa holds beto-bravo from section 5 -- the handle Beto would have wanted --
-- and renamed away from it, so a reset of her current handle would never
-- touch it. Give her one more old handle, publish, and date the claims so
-- oldest-first is visible.
select public.test_login('caca0000-0000-4000-8000-000000000013');
select public.save_my_card(public.test_card('rosa-r',    '{"display_name":"Rosa Rios"}'), '[]');
select public.save_my_card(public.test_card('rosa-rios', '{"display_name":"Rosa Rios"}'), '[]');
select public.set_my_card_published(true);

reset role;
select public.test_login(null);
update public.card_handles set claimed_at = now() - interval '3 days' where handle = 'rosa-r';
update public.card_handles set claimed_at = now() - interval '2 days' where handle = 'beto-bravo';
update public.card_handles set claimed_at = now() - interval '1 day'  where handle = 'rosa-rios';

set local role anon;
select public.test_login(null);
select is(public.get_public_card('beto-bravo'), '{"status": "redirect", "handle": "rosa-rios"}'::jsonb,
  'an old handle keeps pointing at its holder until an officer releases it');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
insert into r values ('list-rosa', public.admin_list_cards());
select is((select x -> 'old_handles' from r, jsonb_array_elements(r.body -> 'rows') x
            where r.label = 'list-rosa' and x ->> 'member_id' = 'caca0000-0000-4000-8000-000000000013'),
  '["rosa-r", "beto-bravo"]'::jsonb, 'officers see a member''s old handles, oldest first');

select public.test_login('caca0000-0000-4000-8000-000000000014');
select throws_ok($$select public.admin_release_card_handle('caca0000-0000-4000-8000-000000000013', 'beto-bravo', 'It is my name')$$,
  '42501', null, 'a member cannot release someone else''s handle');

select public.test_login('caca0000-0000-4000-8000-000000000001');
select throws_ok($$select public.admin_release_card_handle('caca0000-0000-4000-8000-000000000013', 'beto-bravo', 'no')$$,
  '22023', null, 'a release needs a reason');
select throws_ok($$select public.admin_release_card_handle('caca0000-0000-4000-8000-000000000013', 'beto-bravo-2', 'Not hers')$$,
  '22023', 'That handle isn''t one of this member''s handles', 'only a handle the member holds can be released from them');
select is(public.admin_release_card_handle('caca0000-0000-4000-8000-000000000013', ' Beto-Bravo ', 'Squatting on Beto''s name'),
  '{"ok": true, "handle": "beto-bravo", "was_current": false, "new_handle": null}'::jsonb,
  'an officer releases an old handle; the card keeps its current one');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.handle_released' and l.entity_id = 'caca0000-0000-4000-8000-000000000013'
                     and l.metadata = '{"display_name": "Rosa Rios", "current_handle": "rosa-rios", "handle": "beto-bravo",
                                        "was_current": false, "new_handle": null, "reason": "Squatting on Beto''s name"}'::jsonb),
  'a release is audited with whose card, which handle and why');

set local role anon;
select public.test_login(null);
select is(public.get_public_card('beto-bravo'), '{"status": "not_found"}'::jsonb,
  'the released handle stops redirecting');
select is((public.get_public_card('rosa-rios')) ->> 'status', 'ok', 'the card itself is untouched');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000013');
select is(public.check_card_handle('beto-bravo'), 'removed', 'the member it was released from sees it as removed');
select throws_ok($$select public.save_my_card(public.test_card('beto-bravo', '{"display_name":"Rosa Rios"}'), '[]')$$,
  '22023', 'An officer removed that handle from your card. Pick a different one.',
  'and cannot switch back to it, though it used to be theirs');

select public.test_login('caca0000-0000-4000-8000-000000000014');
select is(public.check_card_handle('beto-bravo'), 'available', 'the person it belongs to can now have it');
select is((public.save_my_card(public.test_card('beto-bravo', '{"display_name":"Beto Bravo"}'), '[]')) -> 'card' ->> 'handle',
  'beto-bravo', 'and claims it');

-- Releasing the current handle is a reset: the card moves first.
select public.test_login('caca0000-0000-4000-8000-000000000001');
select is(public.admin_release_card_handle('caca0000-0000-4000-8000-000000000013', 'rosa-rios', 'Offensive in context'),
  '{"ok": true, "handle": "rosa-rios", "was_current": true, "new_handle": "rosa-rios-2"}'::jsonb,
  'releasing the current handle moves the card to the next suggestion');
insert into r values ('list-rosa2', public.admin_list_cards());
select ok(
  (select x ->> 'handle' = 'rosa-rios-2' and x -> 'old_handles' = '["rosa-r"]'::jsonb
     from r, jsonb_array_elements(r.body -> 'rows') x
    where r.label = 'list-rosa2' and x ->> 'member_id' = 'caca0000-0000-4000-8000-000000000013'),
  'the list shows the new handle and only the old handles still held');

set local role anon;
select public.test_login(null);
select is(public.get_public_card('rosa-rios'), '{"status": "not_found"}'::jsonb,
  'the released current handle resolves to nothing');
select is(public.get_public_card('rosa-r'), '{"status": "redirect", "handle": "rosa-rios-2"}'::jsonb,
  'the member''s remaining old handle redirects to the new one');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000013');
select is(public.check_card_handle('rosa-rios'), 'removed', 'a released current handle is blocked for its member too');


-- =============================================================================
-- 20. CHIPS RECORD THE HANDLE THE OFFICER SAW
-- =============================================================================

-- The officer exported Rosa's sheet with rosa-r and Beto's with rosa-rios,
-- which Beto never held. Recording "the card's handle now" would name
-- rosa-rios-2 for Rosa -- not what is on her chip.
select public.test_login('caca0000-0000-4000-8000-000000000001');
select throws_ok($$select public.admin_mark_chips_written(
                     array['caca0000-0000-4000-8000-000000000013'::uuid, 'caca0000-0000-4000-8000-000000000014'::uuid],
                     array['rosa-r'])$$,
  '22023', 'Send one handle for each member', 'one handle per member, or none');
select throws_ok($$select public.admin_mark_chips_written(
                     array['caca0000-0000-4000-8000-000000000013'::uuid, 'caca0000-0000-4000-8000-000000000013'::uuid],
                     array['rosa-r', 'rosa-rios-2'])$$,
  '22023', 'List each member once', 'a member listed twice is refused');
select is(public.admin_mark_chips_written(
            array['caca0000-0000-4000-8000-000000000013'::uuid, 'caca0000-0000-4000-8000-000000000014'::uuid],
            array[' Rosa-R ', 'rosa-rios']),
  '{"ok": true, "count": 1, "skipped": ["caca0000-0000-4000-8000-000000000014"]}'::jsonb,
  'the given handle is recorded only for a member who holds it; the other is skipped');
select ok(exists (select 1 from public.admin_audit_log l
                   where l.action = 'card.chips_written'
                     and (l.metadata ->> 'count')::int = 1 and (l.metadata ->> 'skipped_count')::int = 1),
  'the audit row counts both');

select public.test_login('caca0000-0000-4000-8000-000000000013');
select ok(
  (select c ->> 'chip_handle' = 'rosa-r' and c ->> 'handle' = 'rosa-rios-2' and c -> 'chip_handle_active' = 'true'::jsonb
     from (select (public.get_my_card()) -> 'card' as c) x),
  'the chip records the old handle the officer wrote, which still lands on the card');
select public.test_login('caca0000-0000-4000-8000-000000000014');
select is((public.get_my_card()) -> 'card' -> 'chip_handle', 'null'::jsonb,
  'the skipped member''s card records no chip');

select public.test_login('caca0000-0000-4000-8000-000000000001');
select public.admin_mark_chips_written(array['caca0000-0000-4000-8000-000000000014'::uuid]);
select public.test_login('caca0000-0000-4000-8000-000000000014');
select is((public.get_my_card()) -> 'card' ->> 'chip_handle', 'beto-bravo',
  'without handles, each card''s current handle is recorded');


-- =============================================================================
-- 21. NAMES THE FOLD CANNOT READ, AND CARDS THAT OUTLIVE THEIR OFFICER
-- =============================================================================

reset role;
select public.test_login(null);
select public.test_create_user('caca0000-0000-4000-8000-000000000016', 'wang.fang@wustl.edu',   'Wang',  'Fang');
select public.test_create_user('caca0000-0000-4000-8000-000000000017', 'blank.name@wustl.edu',  'Blank', 'Name');
select public.test_create_user('caca0000-0000-4000-8000-000000000018', 'nguyen.thi@wustl.edu',  'Nguyen', 'Thi');
select public.test_create_user('caca0000-0000-4000-8000-000000000019', 'otto.oficial@wustl.edu', 'Otto', 'Oficial');
update public.profiles set first_name = '王', last_name = '芳', membership_status = 'active'
 where id = 'caca0000-0000-4000-8000-000000000016';
-- A no-break space and a zero-width space: looks blank, is blank.
update public.profiles set first_name = E'\u00a0', last_name = E'\u200b', membership_status = 'active'
 where id = 'caca0000-0000-4000-8000-000000000017';
update public.profiles set first_name = 'Nguyễn', last_name = 'Thị Ánh', membership_status = 'active'
 where id = 'caca0000-0000-4000-8000-000000000018';
update public.profiles set membership_status = 'inactive' where id = 'caca0000-0000-4000-8000-000000000019';
insert into public.member_roles (member_id, role) values ('caca0000-0000-4000-8000-000000000019', 'officer');

select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000018'), 'nguyen-thi',
  'a composed Vietnamese name suggests a clean handle');
insert into r values ('wang-suggest', to_jsonb(private.suggest_card_handle('caca0000-0000-4000-8000-000000000016')));
select matches((select body #>> '{}' from r where label = 'wang-suggest'), '^member-[0-9a-f]{6}$',
  'a name with nothing a handle can use gets member-xxxxxx, never nothing');
select is(private.suggest_card_handle('caca0000-0000-4000-8000-000000000017'), null,
  'a name of invisible spaces counts as no name');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000001');
insert into r values ('dry-names', public.admin_create_missing_cards(false, true));
select is(
  (select x ->> 'handle' from r, jsonb_array_elements(r.body -> 'created') x
    where r.label = 'dry-names' and x ->> 'member_id' = 'caca0000-0000-4000-8000-000000000016'),
  (select body #>> '{}' from r where label = 'wang-suggest'),
  'bulk create includes a member whose name folds to nothing, with the fallback handle');
select ok(
  (select (r.body -> 'skipped') @> '[{"member_id": "caca0000-0000-4000-8000-000000000017", "reason": "no_name", "name": ""}]'::jsonb
      and (r.body -> 'created') @> '[{"member_id": "caca0000-0000-4000-8000-000000000018", "handle": "nguyen-thi"}]'::jsonb
     from r where r.label = 'dry-names'),
  'only a blank name is skipped; every other eligible member is in one list or the other');
select throws_ok($$select public.admin_create_card('caca0000-0000-4000-8000-000000000017')$$,
  '22023', 'Add a name to their profile first', 'a single create refuses only a blank name');

select public.test_login('caca0000-0000-4000-8000-000000000016');
select is(public.suggest_my_card_handle(),
  (select x ->> 'handle' from r, jsonb_array_elements(r.body -> 'created') x
    where r.label = 'dry-names' and x ->> 'member_id' = 'caca0000-0000-4000-8000-000000000016'),
  'the member''s own pre-fill is the same fallback the preview showed');

-- Otto makes Wang's card, then Otto's account is deleted.
select public.test_login('caca0000-0000-4000-8000-000000000019');
select is((public.admin_create_card('caca0000-0000-4000-8000-000000000016')) ->> 'handle',
  (select x ->> 'handle' from r, jsonb_array_elements(r.body -> 'created') x
    where r.label = 'dry-names' and x ->> 'member_id' = 'caca0000-0000-4000-8000-000000000016'),
  'a single create gives the same fallback handle the preview proposed');

reset role;
select public.test_login(null);
delete from auth.users where id = 'caca0000-0000-4000-8000-000000000019';
select ok(
  (select created_by is null and officer_created and member_opened_at is null
     from public.member_cards where member_id = 'caca0000-0000-4000-8000-000000000016'),
  '(setup) the creating officer is gone, so created_by is null');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000016');
select is((public.get_my_card()) -> 'card' -> 'created_by_officer', 'true'::jsonb,
  'the member still sees that an officer set their card up after that officer''s account is deleted');
select public.test_login('caca0000-0000-4000-8000-000000000001');
insert into r values ('list-wang', public.admin_list_cards());
select ok(
  (select x -> 'created_by_officer' = 'true'::jsonb and x ->> 'status' = 'officer_unopened'
     from r, jsonb_array_elements(r.body -> 'rows') x
    where r.label = 'list-wang' and x ->> 'member_id' = 'caca0000-0000-4000-8000-000000000016'),
  'and the officer list still counts it as officer-made and unopened');


-- =============================================================================
-- 22. SERVICE ROLE CAN STILL WRITE (ADMIN SCRIPTS, THE DASHBOARD)
-- =============================================================================

reset role;
select public.test_login(null);
set local role service_role;
select lives_ok($$update public.member_cards set bio = 'Scrubbed by an admin script'
                   where member_id = 'caca0000-0000-4000-8000-000000000003'$$,
  'service_role can update a card: the CHECK helpers are granted to it');
select lives_ok($$insert into public.member_card_links (member_id, kind, value, sort_order)
                   values ('caca0000-0000-4000-8000-000000000003', 'website', 'https://maria.example.com', 9)$$,
  'service_role can add a valid link');
select throws_ok($$insert into public.member_card_links (member_id, kind, value, sort_order)
                    values ('caca0000-0000-4000-8000-000000000003', 'website', 'javascript:alert(1)', 10)$$,
  '23514', null, 'and the constraints still hold for it');
reset role;


-- =============================================================================
-- 23. DELETION
-- =============================================================================

insert into r select 'jose-handles', to_jsonb(array_agg(h.handle order by h.handle))
  from public.card_handles h where h.member_id = 'caca0000-0000-4000-8000-000000000002';

select lives_ok($$delete from auth.users where id = 'caca0000-0000-4000-8000-000000000002'$$,
  'a member with a card, old handles, links and stats can be deleted');
select is(
  (select count(*)::int from public.card_handles where member_id = 'caca0000-0000-4000-8000-000000000002')
  + (select count(*)::int from public.member_cards where member_id = 'caca0000-0000-4000-8000-000000000002')
  + (select count(*)::int from public.card_daily_stats where member_id = 'caca0000-0000-4000-8000-000000000002')
  + (select count(*)::int from public.card_handle_blocks where member_id = 'caca0000-0000-4000-8000-000000000002')
  + (select count(*)::int from public.card_link_daily_clicks k
       where k.link_id in (select id from ids where k in ('website', 'linkedin', 'phone'))),
  0, 'and every trace of the card goes with them');
select is(
  (select to_jsonb(array_agg(x.handle order by x.handle)) from public.reserved_card_handles x
    where x.reason = 'retired: account deleted'),
  (select body from r where label = 'jose-handles'),
  'every handle they held is retired, not freed: their chip and saved contacts can never open someone else''s card');
select ok(
  (select jsonb_array_length(body) = 5 from r where label = 'jose-handles')
  and exists (select 1 from public.card_handles h
               where h.handle = 'jose-pena' and h.member_id = 'caca0000-0000-4000-8000-000000000003'),
  'a handle an officer released from them, now held by someone else, stays with its new owner');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000003');
select is(public.check_card_handle('jose-p'), 'reserved', 'a deleted member''s handle reads as reserved');
select throws_ok($$select public.save_my_card(public.test_card('jose-p', '{"display_name":"María García"}'), public.test_my_links())$$,
  '22023', 'That handle is reserved', 'and nobody can claim it');
set local role anon;
select public.test_login(null);
select is(public.get_public_card('jose-p'), '{"status": "not_found"}'::jsonb,
  'it resolves to nothing, rather than to whoever might have claimed it next');
reset role;

-- =============================================================================
-- 24. A PHOTO THE DESIGN HIDES NEVER LEAVES THE DATABASE
-- =============================================================================
-- The "No photo" shape and photoless layouts (Minimal, which Paper uses by
-- default) keep the photo saved but must not publish its address.

reset role;
select public.test_login(null);
select public.test_create_user('caca0000-0000-4000-8000-000000000020', 'paz.photo@wustl.edu', 'Paz', 'Photo');
update public.profiles set membership_status = 'active' where id = 'caca0000-0000-4000-8000-000000000020';
update public.app_settings set value = 'true'::jsonb where key = 'cards_enabled';

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000020');
select public.save_my_card(
  public.test_card('paz-photo', jsonb_build_object(
    'display_name', 'Paz Photo',
    'avatar_path', 'caca0000-0000-4000-8000-000000000020/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp')),
  '[]');
select public.set_my_card_published(true);

set local role anon;
select public.test_login(null);
select is(public.get_public_card('paz-photo') -> 'card' ->> 'avatar_path',
  'caca0000-0000-4000-8000-000000000020/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp',
  'a photo the design shows is published');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000020');
select public.save_my_card(
  public.test_card('paz-photo', jsonb_build_object(
    'display_name', 'Paz Photo',
    'avatar_path', 'caca0000-0000-4000-8000-000000000020/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp',
    'theme', '{"preset": "shpe-classic", "avatar": {"shape": "hidden"}}'::jsonb)),
  '[]');
set local role anon;
select public.test_login(null);
select is(public.get_public_card('paz-photo') -> 'card' -> 'avatar_path', 'null'::jsonb,
  'the "No photo" shape keeps the address out of the public card');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000020');
select public.save_my_card(
  public.test_card('paz-photo', jsonb_build_object(
    'display_name', 'Paz Photo',
    'avatar_path', 'caca0000-0000-4000-8000-000000000020/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp',
    'theme', '{"preset": "paper"}'::jsonb)),
  '[]');
set local role anon;
select public.test_login(null);
select is(public.get_public_card('paz-photo') -> 'card' -> 'avatar_path', 'null'::jsonb,
  'so does Paper, whose default Minimal layout has no photo');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000020');
select public.save_my_card(
  public.test_card('paz-photo', jsonb_build_object(
    'display_name', 'Paz Photo',
    'avatar_path', 'caca0000-0000-4000-8000-000000000020/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp',
    'theme', '{"preset": "paper", "layout": "classic"}'::jsonb)),
  '[]');
select is((public.get_my_card()) -> 'card' ->> 'avatar_path',
  'caca0000-0000-4000-8000-000000000020/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp',
  'the photo stayed saved for its owner the whole time');
set local role anon;
select public.test_login(null);
select is(public.get_public_card('paz-photo') -> 'card' ->> 'avatar_path',
  'caca0000-0000-4000-8000-000000000020/0b9e5a4c-1d2e-4f3a-8b7c-6d5e4f3a2b1c.webp',
  'and Paper with a photo layout shows it again');
reset role;
select ok(not private.card_theme_shows_photo('{"preset": "shpe-classic", "layout": "minimal"}'::jsonb),
  'an explicit Minimal layout hides the photo on any preset');

-- =============================================================================
-- 25. A DRAFT THAT WAS NEVER PUBLIC FREES ITS HANDLE WHEN DELETED
-- =============================================================================
-- Retiring protects chips, QR codes and saved contacts. A duplicate account's
-- unpublished, never-viewed draft has none of those, so deleting it must free
-- the handle for the person's real account.

reset role;
select public.test_login(null);
select public.test_create_user('caca0000-0000-4000-8000-000000000021', 'dupe.draft@wustl.edu', 'Dupe', 'Draft');
update public.profiles set membership_status = 'active' where id = 'caca0000-0000-4000-8000-000000000021';

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000021');
select public.save_my_card(public.test_card('dupe-draft', '{"display_name": "Dupe Draft"}'), '[]');

reset role;
select public.test_login(null);
delete from auth.users where id = 'caca0000-0000-4000-8000-000000000021';
select ok(not exists (select 1 from public.reserved_card_handles where handle = 'dupe-draft'),
  'a never-public draft''s handle is not retired');

set local role authenticated;
select public.test_login('caca0000-0000-4000-8000-000000000003');
select is(public.check_card_handle('dupe-draft'), 'available',
  'so the person''s real account can claim it');
reset role;
select ok(exists (select 1 from public.reserved_card_handles
                   where handle = 'jose-p' and reason = 'retired: account deleted'),
  'while a card that was live still had every handle retired');

select * from finish();
rollback;

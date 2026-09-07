-- =============================================================================
-- seed.sql — LOCAL DEVELOPMENT FIXTURES ONLY
--
-- Run by `supabase db reset` against the local database. It is NOT a migration
-- and is never applied to a hosted project, which is the only thing keeping
-- these fake accounts out of production. Do not add it to a migration folder,
-- and do not run it against a real project.
--
-- Every person below is invented. No real student data belongs in this file.
--
-- All development accounts share the password:  shpe-dev-password
-- =============================================================================

-- Development-only: allow the .test accounts below to exist alongside the real
-- @wustl.edu policy. Migrations seed the production value; this line only ever
-- runs locally.
update public.app_settings
   set value = '["wustl.edu", "example.test"]'::jsonb
 where key = 'allowed_email_domains';


-- ── People ──────────────────────────────────────────────────────────────────

create or replace function pg_temp.seed_user(
  p_email text,
  p_first text,
  p_last  text,
  p_major text,
  p_grad  integer,
  p_national boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
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
  )
  values (
    v_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('shpe-dev-password', extensions.gen_salt('bf')),
    now(), now() - (random() * interval '400 days'), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'first_name', p_first,
      'last_name', p_last,
      'major', p_major,
      'graduation_year', p_grad::text,
      'degree_level', 'undergraduate',
      'shpe_national_member', case when p_national then 'true' else 'false' end
    ),
    '', '', '', ''
  );
  return v_id;
end;
$$;

-- Three named accounts to sign in with, one per role.
select pg_temp.seed_user('admin@example.test',   'Alex',  'Admin',   'Computer Science',         2027, true);
select pg_temp.seed_user('officer@example.test', 'Olivia','Officer', 'Mechanical Engineering',   2027, true);
select pg_temp.seed_user('member@example.test',  'Marco', 'Member',  'Biomedical Engineering',   2028, false);

-- Two more officers, so the officer views have more than one actor in them.
select pg_temp.seed_user('sofia.castro@example.test',  'Sofia',  'Castro',  'Electrical Engineering', 2027, true);
select pg_temp.seed_user('tomas.herrera@example.test', 'Tomas',  'Herrera', 'Systems Engineering',    2026, false);

-- Twenty-five members with a realistic spread of majors and years.
do $$
declare
  v_people text[][] := array[
    array['Ana','Rivera','Computer Science','2028'],
    array['Luis','Mendez','Mechanical Engineering','2027'],
    array['Camila','Nunez','Biomedical Engineering','2029'],
    array['Mateo','Solis','Electrical Engineering','2026'],
    array['Valeria','Ortiz','Chemical Engineering','2028'],
    array['Diego','Paz','Computer Engineering','2027'],
    array['Isabela','Fuentes','Environmental Engineering','2029'],
    array['Javier','Rojas','Systems Engineering','2026'],
    array['Lucia','Marin','Computer Science','2027'],
    array['Andres','Vega','Mechanical Engineering','2028'],
    array['Renata','Campos','Biomedical Engineering','2026'],
    array['Emilio','Duarte','Data Science','2029'],
    array['Paola','Bermudez','Chemical Engineering','2027'],
    array['Nicolas','Aguirre','Computer Science','2026'],
    array['Daniela','Cortes','Electrical Engineering','2028'],
    array['Sebastian','Lozano','Mechanical Engineering','2029'],
    array['Mariana','Escobar','Environmental Engineering','2027'],
    array['Rafael','Quintero','Computer Engineering','2028'],
    array['Elena','Salgado','Data Science','2026'],
    array['Gabriel','Ibarra','Systems Engineering','2027'],
    array['Natalia','Peralta','Biomedical Engineering','2029'],
    array['Adrian','Montes','Chemical Engineering','2028'],
    array['Sara','Villalobos','Computer Science','2029'],
    array['Hector','Zamora','Electrical Engineering','2026'],
    array['Ximena','Reyes','Mechanical Engineering','2027']
  ];
  v_row text[];
  v_index integer := 0;
begin
  foreach v_row slice 1 in array v_people loop
    v_index := v_index + 1;
    perform pg_temp.seed_user(
      lower(v_row[1]) || '.' || lower(v_row[2]) || '@example.test',
      v_row[1], v_row[2], v_row[3], v_row[4]::integer,
      v_index % 3 = 0
    );
  end loop;
end;
$$;

-- ── Roles ───────────────────────────────────────────────────────────────────
-- Everyone already has `member` from the signup trigger. Elevation is explicit.

insert into public.member_roles (member_id, role)
select id, 'admin' from public.profiles where email = 'admin@example.test'
on conflict do nothing;

insert into public.member_roles (member_id, role)
select id, 'officer' from public.profiles
 where email in ('admin@example.test', 'officer@example.test',
                 'sofia.castro@example.test', 'tomas.herrera@example.test')
on conflict do nothing;

-- A spread of membership states, so the officer views have something to show.
update public.profiles set membership_status = 'inactive'
 where email in ('hector.zamora@example.test', 'elena.salgado@example.test');
update public.profiles set membership_status = 'alumni'
 where email = 'javier.rojas@example.test';
update public.profiles set membership_status = 'pending'
 where email = 'sara.villalobos@example.test';

-- Some National memberships confirmed by an officer, some only claimed.
update public.profiles set shpe_national_member = 'verified'
 where email in ('admin@example.test', 'officer@example.test',
                 'ana.rivera@example.test', 'lucia.marin@example.test');


-- ── Events ──────────────────────────────────────────────────────────────────
-- Anchored to the active term so the dashboard has data the day you seed.

do $$
declare
  v_term      uuid := public.current_term_id();
  v_officer   uuid := (select id from public.profiles where email = 'officer@example.test');
  v_gbm       uuid := (select id from public.event_categories where slug = 'general-body-meeting');
  v_prof      uuid := (select id from public.event_categories where slug = 'professional-development');
  v_corp      uuid := (select id from public.event_categories where slug = 'corporate');
  v_academic  uuid := (select id from public.event_categories where slug = 'academic');
  v_service   uuid := (select id from public.event_categories where slug = 'community-service');
  v_social    uuid := (select id from public.event_categories where slug = 'social');
  v_conf      uuid := (select id from public.event_categories where slug = 'conference');
  v_mentor    uuid := (select id from public.event_categories where slug = 'mentorship');
begin
  insert into public.events
    (title, category_id, academic_term_id, start_at, end_at, location,
     points_value, status, organizer_name, organizer_email, description, created_by)
  values
    -- Past
    ('Fall Kickoff GBM', v_gbm, v_term,
     now() - interval '35 days', now() - interval '35 days' + interval '90 minutes',
     'Lopata Hall 101', 10, 'completed', 'Olivia Officer', 'shpe@wustl.edu',
     'Our first general body meeting of the year. Meet the exec board, hear what we have planned, and grab dinner.', v_officer),

    ('Welcome Social', v_social, v_term,
     now() - interval '31 days', now() - interval '31 days' + interval '2 hours',
     'Danforth University Center', 5, 'completed', 'Olivia Officer', 'shpe@wustl.edu',
     'Low-key social to meet the familia.', v_officer),

    ('Resume Review Workshop', v_prof, v_term,
     now() - interval '26 days', now() - interval '26 days' + interval '90 minutes',
     'Whitaker Hall 218', 10, 'completed', 'Sofia Castro', 'shpe@wustl.edu',
     'Bring a draft resume; officers and alumni give line-by-line feedback.', v_officer),

    ('Career Fair Preparation', v_prof, v_term,
     now() - interval '22 days', now() - interval '22 days' + interval '90 minutes',
     'Urbauer Hall 218', 10, 'completed', 'Sofia Castro', 'shpe@wustl.edu',
     'Elevator pitches, company research, and what recruiters actually ask.', v_officer),

    ('General Body Meeting #2', v_gbm, v_term,
     now() - interval '18 days', now() - interval '18 days' + interval '90 minutes',
     'Lopata Hall 101', 10, 'completed', 'Olivia Officer', 'shpe@wustl.edu',
     'Chapter updates, convention logistics, and committee sign-ups.', v_officer),

    ('Boeing Networking Night', v_corp, v_term,
     now() - interval '13 days', now() - interval '13 days' + interval '2 hours',
     'Knight Hall', 15, 'completed', 'Tomas Herrera', 'shpe@wustl.edu',
     'Meet Boeing engineers and recruiters. Business casual; bring copies of your resume.', v_officer),

    ('SHPE Study Night', v_academic, v_term,
     now() - interval '9 days', now() - interval '9 days' + interval '3 hours',
     'Olin Library', 5, 'completed', 'Olivia Officer', 'shpe@wustl.edu',
     'Quiet study, snacks, and upperclassmen around for the hard problem sets.', v_officer),

    ('Hispanic Heritage Month Social', v_social, v_term,
     now() - interval '5 days', now() - interval '5 days' + interval '2 hours',
     'Tisch Commons', 10, 'completed', 'Olivia Officer', 'shpe@wustl.edu',
     'Food, music, and celebrating the familia.', v_officer),

    -- Happening today: check-in is open right now, which is what you want
    -- when you first open the portal after seeding.
    ('General Body Meeting #3', v_gbm, v_term,
     now() - interval '15 minutes', now() + interval '75 minutes',
     'Lopata Hall 101', 10, 'published', 'Olivia Officer', 'shpe@wustl.edu',
     'Convention readiness, spring planning, and a guest from the alumni network.', v_officer),

    -- Upcoming
    ('Engineering Alumni Panel', v_mentor, v_term,
     now() + interval '4 days', now() + interval '4 days' + interval '90 minutes',
     'Whitaker Hall Auditorium', 10, 'published', 'Sofia Castro', 'shpe@wustl.edu',
     'SHPE alumni on first jobs, grad school, and the things nobody tells you.', v_officer),

    ('Community Service Day', v_service, v_term,
     now() + interval '9 days', now() + interval '9 days' + interval '4 hours',
     'Meet at Mallinckrodt', 15, 'published', 'Tomas Herrera', 'shpe@wustl.edu',
     'Volunteering with a local STEM outreach programme. Transport provided.', v_officer),

    ('National Convention Readiness Workshop', v_conf, v_term,
     now() + interval '14 days', now() + interval '14 days' + interval '2 hours',
     'Cupples II 217', 15, 'published', 'Olivia Officer', 'shpe@wustl.edu',
     'Everything for the SHPE National Convention: resume book, career fair strategy, and travel logistics.', v_officer),

    ('Corporate Technical Workshop', v_corp, v_term,
     now() + interval '20 days', now() + interval '20 days' + interval '2 hours',
     'Brauer Hall 100', 15, 'published', 'Tomas Herrera', 'shpe@wustl.edu',
     'Hands-on session run by an industry partner.', v_officer),

    ('Graduate School Information Session', v_academic, v_term,
     now() + interval '27 days', now() + interval '27 days' + interval '90 minutes',
     'Jolley Hall 309', 10, 'published', 'Sofia Castro', 'shpe@wustl.edu',
     'Applications, funding, and whether grad school is right for you.', v_officer),

    -- One cancelled and one draft, so those states are visible in the UI.
    ('Activities Fair Tabling', v_social, v_term,
     now() + interval '6 days', now() + interval '6 days' + interval '3 hours',
     'Brookings Quadrangle', 5, 'cancelled', 'Olivia Officer', 'shpe@wustl.edu',
     'Cancelled due to weather.', v_officer),

    ('Spring Kickoff GBM', v_gbm, v_term,
     now() + interval '45 days', now() + interval '45 days' + interval '90 minutes',
     'Lopata Hall 101', 10, 'draft', 'Olivia Officer', 'shpe@wustl.edu',
     'Not announced yet.', v_officer);
end;
$$;


-- ── Attendance and points ───────────────────────────────────────────────────
-- Written through public.perform_check_in, the same function a real check-in
-- uses, so the seeded ledger is consistent with the seeded attendance by
-- construction rather than by hand.

do $$
declare
  v_member record;
  v_event  record;
  v_member_ix integer := 0;
  v_event_ix  integer;
begin
  for v_member in
    select id from public.profiles
     where membership_status in ('active', 'alumni')
     order by created_at
  loop
    v_member_ix := v_member_ix + 1;
    v_event_ix := 0;

    for v_event in
      select id from public.events
       where status = 'completed'
       order by start_at
    loop
      v_event_ix := v_event_ix + 1;

      -- A deterministic but uneven spread: some members attend nearly
      -- everything, some attend a couple of things, most sit in between.
      if (v_member_ix * 7 + v_event_ix * 3) % 10 < 6 then
        perform public.perform_check_in(v_member.id, v_event.id, 'import', null);
      end if;
    end loop;
  end loop;
end;
$$;

-- A couple of manual adjustments, so the ledger shows more than event awards.
do $$
declare
  v_officer uuid := (select id from public.profiles where email = 'officer@example.test');
begin
  perform public.write_audit_log(v_officer, 'points.adjusted', 'member',
    (select id from public.profiles where email = 'ana.rivera@example.test'),
    '{"adjustment": 10, "reason": "Volunteer bonus - ran the resume workshop"}'::jsonb);

  insert into public.point_transactions
    (member_id, academic_term_id, amount, transaction_type, description, created_by)
  values
    ((select id from public.profiles where email = 'ana.rivera@example.test'),
     public.current_term_id(), 10, 'bonus',
     'Volunteer bonus - ran the resume workshop', v_officer),
    ((select id from public.profiles where email = 'luis.mendez@example.test'),
     public.current_term_id(), 5, 'manual_adjustment',
     'Helped set up the networking night', v_officer);
end;
$$;


-- ── Announcements ───────────────────────────────────────────────────────────

insert into public.announcements (title, body, priority, published_at, expires_at, created_by)
select * from (values
  ('Convention travel forms due Friday',
   E'If you are coming to the National Convention, the travel and lodging form has to be in by Friday at 5pm.\n\nWe cannot add anyone after that — the block booking closes.',
   'urgent'::public.announcement_priority, now() - interval '1 day', now() + interval '4 days'),
  ('GBM #3 is tonight',
   E'Lopata 101 at 7pm. Dinner provided.\n\nWe will cover spring planning and the alumni panel.',
   'important'::public.announcement_priority, now() - interval '6 hours', now() + interval '1 day'),
  ('Resume book open for corporate partners',
   'Upload your resume through the career portal by the end of the month to be included in the book we send to corporate partners.',
   'important'::public.announcement_priority, now() - interval '3 days', now() + interval '20 days'),
  ('New: community service points',
   'Service events now carry points like every other category. See the events page for what is coming up.',
   'normal'::public.announcement_priority, now() - interval '8 days', null),
  ('Officer applications open in the spring',
   'Interested in running for exec? Applications open after spring break. Talk to any current officer if you want to know what a role actually involves.',
   'normal'::public.announcement_priority, now() - interval '15 days', null),
  ('Welcome to the new member portal',
   E'You can now check into events, track your SHPE points, and see your attendance history in one place.\n\nFound something broken? Tell an officer.',
   'normal'::public.announcement_priority, now() - interval '30 days', null)
) as a(title, body, priority, published_at, expires_at)
cross join lateral (select id from public.profiles where email = 'officer@example.test') o(created_by);


-- ── Additional resources ────────────────────────────────────────────────────
-- The reference-data migration already seeds the chapter's real public
-- documents; these fill out the categories for development.

insert into public.resources (title, description, category, url, visibility, sort_order)
values
  ('Resume Template',
   'The one-page template officers use for resume reviews.',
   'Resume', 'https://example.test/shpe-resume-template', 'member', 60),
  ('Technical Interview Prep',
   'Practice problems and a study plan for technical interviews.',
   'Interview', 'https://example.test/interview-prep', 'member', 70),
  ('Convention Preparation Guide',
   'What to pack, how the career fair works, and how to follow up afterwards.',
   'Convention', 'https://example.test/convention-guide', 'member', 80),
  ('Past GBM Slides',
   'Slide decks from previous general body meetings.',
   'Workshops', 'https://example.test/gbm-slides', 'member', 90),
  ('Corporate Partner Contacts',
   'Recruiter contacts and relationship notes. Officers only.',
   'Corporate', 'https://example.test/corporate-contacts', 'officer', 100)
on conflict do nothing;


-- ── Check-in codes for the live event ───────────────────────────────────────
-- Seeded directly (rather than through the officer RPC, which needs a JWT) so
-- there is a known code to try immediately: SHPEDEV1

insert into public.event_checkin_secrets (event_id, code_salt, code_hash)
select e.id, 'seed-salt', public.hash_checkin_code('seed-salt', 'SHPEDEV1')
  from public.events e
 where e.title = 'General Body Meeting #3'
on conflict (event_id) do update
  set code_salt = excluded.code_salt,
      code_hash = excluded.code_hash;


-- ── What you just created ───────────────────────────────────────────────────

do $$
begin
  raise notice '';
  raise notice '=== WashU SHPE development data ready ===';
  raise notice 'Members: %  Events: %  Attendance: %  Ledger rows: %',
    (select count(*) from public.profiles),
    (select count(*) from public.events),
    (select count(*) from public.event_attendance),
    (select count(*) from public.point_transactions);
  raise notice '';
  raise notice 'Sign in with password  shpe-dev-password';
  raise notice '  admin@example.test    (admin + officer + member)';
  raise notice '  officer@example.test  (officer + member)';
  raise notice '  member@example.test   (member)';
  raise notice '';
  raise notice 'Live check-in code for "General Body Meeting #3":  SHPEDEV1';
  raise notice '';
end;
$$;

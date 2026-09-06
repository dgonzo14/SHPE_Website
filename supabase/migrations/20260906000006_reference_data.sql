-- =============================================================================
-- 20260906000006_reference_data.sql
-- Reference and configuration data. Production-safe: contains no people, no
-- fabricated attendance, and no development accounts. Development fixtures live
-- in supabase/seed.sql, which migrations never run.
-- =============================================================================


-- ── Chapter policy defaults ─────────────────────────────────────────────────

insert into public.app_settings (key, value, description) values
  ('allowed_email_domains',
   '["wustl.edu"]'::jsonb,
   'Email domains permitted to self-register. Empty array disables the restriction entirely.'),

  ('manual_email_allowlist',
   '[]'::jsonb,
   'Individual addresses allowed to register despite not matching allowed_email_domains. This is how an officer onboards a member with a non-WashU address.'),

  ('default_membership_status',
   '"active"'::jsonb,
   'membership_status assigned at registration. Set to "pending" to require officer approval before a new member can check in.'),

  ('checkin_allowed_statuses',
   '["active"]'::jsonb,
   'Membership statuses permitted to check into events. Empty array allows all.'),

  ('membership_requirements_enabled',
   'false'::jsonb,
   'Whether the Membership page evaluates active-member requirements. Ships disabled: WashU SHPE has not defined official requirements, and this system does not invent chapter policy.'),

  ('membership_requirements',
   '[]'::jsonb,
   'Requirement definitions. Each entry: {id, label, type, target, category_slug?} where type is total_points | total_events | category_events.')
on conflict (key) do nothing;


-- ── Event categories ────────────────────────────────────────────────────────
-- Officers can add, rename or retire these from the database without a deploy.
-- Point values are deliberately NOT attached here: an officer sets points per
-- event, because a one-off corporate workshop is not automatically worth what
-- every other corporate event is worth.

insert into public.event_categories (name, slug, description, color, sort_order) values
  ('General Body Meeting', 'general-body-meeting', 'Chapter-wide meetings open to all members.',        '#1B365D', 10),
  ('Professional Development', 'professional-development', 'Resume, interview, and career-skills sessions.', '#E84E1B', 20),
  ('Corporate', 'corporate', 'Company info sessions, networking nights, and site visits.',              '#5B9BD5', 30),
  ('Academic', 'academic', 'Study nights, tutoring, and academic support.',                             '#F5A623', 40),
  ('Community Service', 'community-service', 'Volunteering and outreach in the St. Louis community.',   '#10B981', 50),
  ('Social', 'social', 'Familia socials and community-building events.',                                '#8B5CF6', 60),
  ('Fundraising', 'fundraising', 'Chapter fundraising efforts.',                                        '#EC4899', 70),
  ('Conference', 'conference', 'National Convention, regional leadership, and related travel.',         '#0EA5E9', 80),
  ('Mentorship', 'mentorship', 'Mentor/mentee programming and alumni connections.',                     '#14B8A6', 90),
  ('Other', 'other', 'Anything that does not fit the categories above.',                                '#6B7280', 999)
on conflict (slug) do nothing;


-- ── Academic terms ──────────────────────────────────────────────────────────
-- Semesters only. "Academic year" is a *scope* derived from the academic_year
-- column (see public.term_ids_for_scope), not a row of its own, so it can never
-- drift out of sync with the semesters it covers.
--
-- Dates are approximate WashU semester boundaries; admins can adjust them.

insert into public.academic_terms (name, term_type, start_date, end_date, academic_year, is_active) values
  ('Fall 2025',   'fall',   '2025-08-25', '2025-12-19', '2025-2026', false),
  ('Spring 2026', 'spring', '2026-01-12', '2026-05-15', '2025-2026', false),
  ('Fall 2026',   'fall',   '2026-08-24', '2026-12-18', '2026-2027', true),
  ('Spring 2027', 'spring', '2027-01-11', '2027-05-14', '2026-2027', false)
on conflict (name) do nothing;


-- ── Starter resources ───────────────────────────────────────────────────────
-- Documents the chapter already publishes. These stay `public` visibility so
-- moving the portal in front of them does not quietly take anything away from
-- prospective members who could previously read them.

insert into public.resources (title, description, category, url, visibility, sort_order) values
  ('SHPE Student Chapter Bylaws',
   'Governing bylaws for the WashU SHPE student chapter.',
   'Chapter Documents', '/SHPE-Student-Chapter-Bylaws.pdf', 'public', 10),
  ('SHPE Constitution',
   'The chapter constitution.',
   'Chapter Documents', '/SHPE_Constitution.docx', 'public', 20),
  ('Sponsorship Package',
   'What partnership with WashU SHPE looks like, for companies and for members making an introduction.',
   'Corporate', '/WashU_SHPE_Sponsorship_Package.pdf', 'public', 30),
  ('SHPE National Scholarships',
   'Scholarships available to SHPE National members.',
   'Scholarship', 'https://shpe.org/students/scholarships/', 'member', 40),
  ('SHPE National Convention',
   'Convention information, registration, and career fair details from SHPE National.',
   'Convention', 'https://shpe.org/engage/events/convention/', 'member', 50)
on conflict do nothing;

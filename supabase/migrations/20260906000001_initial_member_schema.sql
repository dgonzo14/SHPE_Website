-- =============================================================================
-- 20260906000001_initial_member_schema.sql
-- WashU SHPE member portal — core schema
--
-- Design notes that matter later:
--   * Points are a LEDGER (point_transactions), never a mutable counter. Totals
--     are always derived. This gives every number on screen an audit trail.
--   * Check-in codes are never stored in plaintext and never live on a row a
--     member can read. `event_checkin_secrets` deliberately has RLS enabled
--     with ZERO policies, so only SECURITY DEFINER functions can reach it.
--   * event_attendance has UNIQUE(event_id, member_id). That constraint — not
--     application logic — is what makes duplicate attendance impossible under
--     double-clicks, retries, and concurrent tabs.
--   * Events referenced by attendance or the ledger cannot be deleted
--     (ON DELETE RESTRICT). Officers cancel events; history is never orphaned.
-- =============================================================================

-- ── Enumerated domains ──────────────────────────────────────────────────────

create type public.membership_status as enum
  ('pending', 'active', 'inactive', 'alumni', 'suspended');

create type public.degree_level as enum
  ('undergraduate', 'masters', 'phd', 'other');

-- 'verified' means an officer confirmed it against the SHPE National roster.
-- Self-reported membership is never silently upgraded to verified.
create type public.national_member_status as enum
  ('not_provided', 'self_reported', 'verified');

-- Authorisation roles only. Officer *titles* (president, treasurer, ...) are
-- organisational metadata and deliberately do not participate in access control.
create type public.app_role as enum ('member', 'officer', 'admin');

create type public.event_status as enum
  ('draft', 'published', 'cancelled', 'completed');

create type public.term_type as enum ('fall', 'spring', 'summer', 'academic_year');

create type public.checkin_method as enum ('code', 'qr', 'manual', 'import');

create type public.point_transaction_type as enum
  ('event_attendance', 'bonus', 'manual_adjustment', 'correction', 'migration');

create type public.announcement_priority as enum ('normal', 'important', 'urgent');

create type public.resource_visibility as enum ('public', 'member', 'officer');


-- ── Chapter-configurable policy ─────────────────────────────────────────────
-- Anything the chapter might reasonably want to change without a code deploy
-- lives here rather than being hard-coded in a component.

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

comment on table public.app_settings is
  'Chapter policy configuration. Read through public.get_app_config(); written only by admins.';


-- ── Profiles ────────────────────────────────────────────────────────────────
-- One row per authenticated account, created by an auth.users trigger.
-- Passwords live in auth.users and are never mirrored here.

create table public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,

  first_name              text not null default '',
  last_name               text not null default '',
  email                   text not null,

  major                   text,
  secondary_major         text,
  graduation_year         integer,
  degree_level            public.degree_level,

  shpe_national_member    public.national_member_status not null default 'not_provided',
  shpe_national_member_id text,

  linkedin_url            text,
  profile_image_url       text,

  membership_status       public.membership_status not null default 'active',
  member_since            date not null default current_date,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint profiles_graduation_year_range
    check (graduation_year is null or graduation_year between 1950 and 2100),
  constraint profiles_email_shape
    check (position('@' in email) > 1),
  constraint profiles_linkedin_is_url
    check (linkedin_url is null or linkedin_url ~* '^https?://')
);

create unique index profiles_email_lower_key on public.profiles (lower(email));
create index profiles_membership_status_idx on public.profiles (membership_status);
create index profiles_graduation_year_idx  on public.profiles (graduation_year);


-- ── Roles ───────────────────────────────────────────────────────────────────
-- Separate table so a role grant is an auditable event with an actor, and so
-- `role` can never be smuggled in through a profile update or a signup form.

create table public.member_roles (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (member_id, role)
);

create index member_roles_member_idx on public.member_roles (member_id);


-- ── Academic terms ──────────────────────────────────────────────────────────
-- Engagement is scoped to a term, so a new semester never erases history.

create table public.academic_terms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  term_type     public.term_type not null,
  start_date    date not null,
  end_date      date not null,
  academic_year text not null,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),

  constraint academic_terms_date_order check (end_date >= start_date)
);

-- At most one term can be the active dashboard context at a time.
create unique index academic_terms_single_active
  on public.academic_terms ((is_active)) where is_active;
create index academic_terms_range_idx on public.academic_terms (start_date, end_date);


-- ── Event categories ────────────────────────────────────────────────────────
-- Data, not source code: officers add a category without a deploy.

create table public.event_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  slug        text not null unique,
  description text,
  color       text,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);


-- ── Events ──────────────────────────────────────────────────────────────────

create table public.events (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  slug               text not null unique,
  description        text,

  category_id        uuid references public.event_categories (id) on delete restrict,
  academic_term_id   uuid references public.academic_terms (id) on delete set null,

  start_at           timestamptz not null,
  end_at             timestamptz not null,
  location           text,

  points_value       integer not null default 0,

  check_in_opens_at  timestamptz,
  check_in_closes_at timestamptz,

  status             public.event_status not null default 'draft',
  capacity           integer,

  organizer_name     text,
  organizer_email    text,
  image_url          text,

  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint events_title_not_blank     check (length(btrim(title)) > 0),
  constraint events_time_order          check (end_at > start_at),
  constraint events_points_not_negative check (points_value >= 0),
  constraint events_capacity_positive   check (capacity is null or capacity > 0),
  constraint events_checkin_window_order
    check (check_in_opens_at is null
        or check_in_closes_at is null
        or check_in_closes_at >= check_in_opens_at)
);

create index events_start_at_idx     on public.events (start_at);
create index events_status_idx       on public.events (status);
create index events_status_start_idx on public.events (status, start_at);
create index events_category_idx     on public.events (category_id);
create index events_term_idx         on public.events (academic_term_id);
-- Supports the "which events are accepting check-ins right now?" scan.
create index events_checkin_window_idx
  on public.events (check_in_opens_at, check_in_closes_at)
  where status = 'published';


-- ── Check-in secrets ────────────────────────────────────────────────────────
-- Salted SHA-256. Plaintext is shown to the officer once, at generation time,
-- and is never returned by any query afterwards.

create table public.event_checkin_secrets (
  event_id   uuid primary key references public.events (id) on delete cascade,
  code_salt  text not null,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rotated_by uuid references public.profiles (id) on delete set null
);

comment on table public.event_checkin_secrets is
  'RLS is enabled with no policies on purpose: unreachable except via SECURITY DEFINER functions.';


-- ── Attendance ──────────────────────────────────────────────────────────────

create table public.event_attendance (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete restrict,
  member_id       uuid not null references public.profiles (id) on delete cascade,
  check_in_method public.checkin_method not null default 'code',
  checked_in_at   timestamptz not null default now(),
  verified_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),

  -- The single most important constraint in this schema.
  constraint event_attendance_unique_member_event unique (event_id, member_id)
);

create index event_attendance_member_idx on public.event_attendance (member_id);
create index event_attendance_event_idx  on public.event_attendance (event_id);
create index event_attendance_time_idx   on public.event_attendance (checked_in_at desc);


-- ── Point ledger ────────────────────────────────────────────────────────────
-- Append-only in practice: mistakes are fixed with a compensating 'correction'
-- row, never by editing or deleting history.
--
-- Deliberately NOT unique on (member_id, event_id): an officer may legitimately
-- remove attendance (which posts a correction) and later re-add it. Duplicate
-- awards are prevented upstream by event_attendance's unique constraint, which
-- is the only gate the automatic award path passes through.

create table public.point_transactions (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.profiles (id) on delete cascade,
  event_id         uuid references public.events (id) on delete restrict,
  academic_term_id uuid references public.academic_terms (id) on delete set null,
  amount           integer not null,
  transaction_type public.point_transaction_type not null,
  description      text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint point_transactions_amount_nonzero check (amount <> 0)
);

create index point_transactions_member_idx      on public.point_transactions (member_id);
create index point_transactions_term_idx        on public.point_transactions (academic_term_id);
create index point_transactions_member_term_idx on public.point_transactions (member_id, academic_term_id);
create index point_transactions_event_idx       on public.point_transactions (event_id);
create index point_transactions_created_idx     on public.point_transactions (created_at desc);


-- ── Announcements ───────────────────────────────────────────────────────────

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  priority     public.announcement_priority not null default 'normal',
  published_at timestamptz,
  expires_at   timestamptz,
  is_archived  boolean not null default false,
  external_url text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint announcements_title_not_blank check (length(btrim(title)) > 0),
  constraint announcements_expiry_after_publish
    check (expires_at is null or published_at is null or expires_at > published_at)
);

create index announcements_published_idx on public.announcements (published_at desc);
create index announcements_active_idx
  on public.announcements (published_at desc)
  where not is_archived;


-- ── Resources ───────────────────────────────────────────────────────────────

create table public.resources (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  category     text not null,
  url          text,
  file_url     text,
  visibility   public.resource_visibility not null default 'member',
  is_archived  boolean not null default false,
  published_at timestamptz not null default now(),
  sort_order   integer not null default 100,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint resources_has_target check (url is not null or file_url is not null)
);

create index resources_visibility_idx on public.resources (visibility) where not is_archived;
create index resources_category_idx   on public.resources (category);


-- ── Notification / visibility preferences ───────────────────────────────────
-- Reserved for the future member directory and email digests. Created for every
-- member so the columns exist the day those features ship; the UI deliberately
-- does not render toggles for behaviour that is not implemented yet.

create table public.notification_preferences (
  member_id             uuid primary key references public.profiles (id) on delete cascade,
  email_announcements   boolean not null default true,
  email_event_reminders boolean not null default true,
  directory_opt_in      boolean not null default false,
  show_major            boolean not null default true,
  show_graduation_year  boolean not null default true,
  show_linkedin         boolean not null default false,
  updated_at            timestamptz not null default now()
);


-- ── Check-in attempt log (brute-force throttling) ───────────────────────────
-- Durable rather than in-process: serverless/edge instances do not share memory,
-- so an in-memory counter is not a control.

create table public.checkin_attempts (
  id           bigint generated always as identity primary key,
  member_id    uuid not null references public.profiles (id) on delete cascade,
  event_id     uuid references public.events (id) on delete set null,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);

create index checkin_attempts_member_time_idx
  on public.checkin_attempts (member_id, attempted_at desc);


-- ── Administrative audit log ────────────────────────────────────────────────

create table public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_actor_idx   on public.admin_audit_log (actor_id);
create index admin_audit_log_entity_idx  on public.admin_audit_log (entity_type, entity_id);

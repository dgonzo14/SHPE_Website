-- =============================================================================
-- 20260906000007_public_events.sql
-- Make the chapter calendar public, so database events replace the embedded
-- Outlook calendar rather than sitting alongside it.
--
-- The design problem: /members is a public page, and its calendar is how
-- prospective members and sponsors see that the chapter is active. Moving
-- events into the portal without this migration would have hidden the schedule
-- from exactly the people that page exists for.
--
-- The exposure is deliberately narrow. Anonymous visitors get a *column subset*
-- of published events, enforced by a column-level GRANT rather than by the
-- client politely asking for fewer fields:
--
--   visible : id, title, slug, description, category, start_at, end_at,
--             location, points_value, image_url, status
--   hidden  : organizer_email, organizer_name, capacity, check_in windows,
--             created_by, academic_term_id, timestamps
--
-- Check-in windows in particular stay private. They are not secret, but there
-- is no reason to publish the exact minute a code goes live.
-- =============================================================================

-- ── Per-event public visibility ─────────────────────────────────────────────
-- Defaults to true because most chapter events are open. Officer syncs, exec
-- board meetings and anything internal get switched off in the event form.

alter table public.events
  add column is_public boolean not null default true;

comment on column public.events.is_public is
  'Whether the event appears on the public website calendar. Internal meetings set this false.';

-- Supports the public calendar's month-range scan.
create index events_public_calendar_idx
  on public.events (start_at)
  where status <> 'draft' and is_public;


-- ── Anonymous read access ───────────────────────────────────────────────────
-- Two independent limits, both required for a row to be returned:
--   the POLICY decides which rows  (published or cancelled or completed, public)
--   the GRANT decides which columns
-- A `select *` as anon fails outright, which is the intended behaviour: the
-- public client has to name the columns it wants.

grant select (
  id,
  title,
  slug,
  description,
  category_id,
  start_at,
  end_at,
  location,
  points_value,
  image_url,
  status,
  is_public
) on public.events to anon;

-- Drafts stay invisible, exactly as they are for members. Cancelled and
-- completed events remain visible: someone who saw "Career Fair Prep, Nov 3"
-- is better served by a struck-through "Cancelled" than by it silently
-- vanishing from the calendar.
create policy events_select_public_anon on public.events
  for select to anon
  using (status <> 'draft' and is_public);


-- Category names and colours are labels on a public calendar; nothing here is
-- sensitive, so the whole row is readable.
grant select on public.event_categories to anon;

create policy event_categories_select_anon on public.event_categories
  for select to anon
  using (is_active);


-- ── Keep internal events internal by default where it matters ───────────────
-- Nothing to migrate: there are no events yet in production. If this ever runs
-- against a database that already has events, they all become public, which is
-- the safe reading of "the chapter calendar" — but review them afterwards.

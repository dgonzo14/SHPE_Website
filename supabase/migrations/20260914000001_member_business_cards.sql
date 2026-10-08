-- =============================================================================
-- Member business cards: washushpe.org/card/<handle>
--
-- Members build a card in My SHPE, and its address is what gets written to
-- their NFC card. docs/digital-business-cards.md is the product plan; this file
-- is the part of it that has to be right, because it decides what a stranger
-- holding a phone can learn about a student.
--
-- Four decisions shape the rest of the file:
--
--   * Nothing here is reachable except through functions. Every table has RLS
--     on, zero policies and no grants -- the same lockdown as the leaderboard
--     snapshot. A stranger's only ways in are get_public_card() and
--     record_card_event(); a member's are the *_my_card functions, which only
--     ever touch the caller's own row; an officer's are the admin_* functions,
--     each of which calls require_officer() before doing anything and writes
--     an audit row. There is no select-own policy because the editor does not
--     need one: get_my_card() returns everything it shows.
--
--   * Handles are permanent. The URL on a chip can only change if someone
--     physically rewrites the chip, so every handle a member has used stays in
--     card_handles, still theirs, and redirects to their current one. Nobody
--     else can ever claim it -- not even after the member's account is
--     deleted: their handles move to reserved_card_handles on the way out, so
--     an old chip or a saved contact can never open a stranger's card. The one
--     exception is an officer releasing an impersonating or offensive handle,
--     which deliberately frees it for everyone except the member it was taken
--     from (card_handle_blocks). A composite foreign key makes "a card's handle
--     is one its owner holds" a schema fact rather than something every
--     function has to remember.
--
--   * A card that should not be seen is indistinguishable from one that does
--     not exist. Unpublished, hidden, pending, suspended, switched-off and
--     nonexistent all return the same {"status":"not_found"}, so the handle
--     namespace cannot be probed for who has a draft.
--
--   * Officers can create a card for a member (so every chip can be written at
--     card-writing night), but an officer-made card carries the member's name
--     and school and nothing else. Until the member opens it, the public
--     payload is cut down to name, school, education and position however the
--     row is filled in -- the "starter" rule in get_public_card(). Contact
--     details only ever come from the member.
--
-- It ships OFF, like the leaderboard. Officers can build cards before launch;
-- nobody else sees anything until an officer flips cards_enabled.
--
-- src/features/cards/model.ts mirrors every list and limit below. The database
-- is the authority: a value the client accepts and this file refuses fails the
-- save with a 22023 rather than slipping through.
-- =============================================================================


-- ── The switch ──────────────────────────────────────────────────────────────

insert into public.app_settings (key, value, description) values
  ('cards_enabled',
   'false'::jsonb,
   'Whether member business cards are live at /card/<handle>. Ships off; an officer turns it on from Admin > Cards. Officers can always build and preview cards.')
on conflict (key) do nothing;


-- The portal decides whether to show "My Card" from this, and the public card
-- page needs nothing from it (get_public_card() enforces the switch itself).
-- Unchanged otherwise. Whether the chapter has cards switched on says nothing
-- about any member, so it is safe at the anon grant this function already has.
create or replace function public.get_app_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
    from public.app_settings s
   where s.key in (
     'allowed_email_domains',
     'membership_requirements_enabled',
     'membership_requirements',
     'points_display_label',
     'leaderboard_enabled',
     'cards_enabled'
   );
$$;


-- Strictly `true`, not "anything that casts to true". admin_set_app_setting()
-- takes arbitrary jsonb, and a value like "maybe" must read as off rather than
-- make every card request raise until someone fixes it by hand.
create or replace function private.cards_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.value = 'true'::jsonb from public.app_settings s where s.key = 'cards_enabled'),
    false
  );
$$;


-- ── Small validators ────────────────────────────────────────────────────────
--
-- All in `private`, all immutable, all `set search_path = ''`. They are used by
-- CHECK constraints as well as by save_my_card(), so the constraint and the
-- friendly error can never disagree about what is allowed. None of them raises
-- on malformed input: a CHECK that throws a cast error is a worse message than
-- a CHECK that fails.
--
-- A CHECK runs its functions as whoever is writing the row, so the ones the
-- constraints use are granted to service_role at the bottom of this file. The
-- definer functions never need that (they run as the owner), but an admin
-- script or the dashboard writing as service_role would otherwise fail every
-- insert and update with "permission denied for function card_tags_ok".

-- A JSON string whose value is in the list.
create or replace function private.card_json_in(p_value jsonb, p_allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when jsonb_typeof(p_value) = 'string' then (p_value #>> '{}') = any (p_allowed)
           else false
         end;
$$;

-- A JSON string of the form #rrggbb.
create or replace function private.card_json_hex(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when jsonb_typeof(p_value) = 'string' then (p_value #>> '{}') ~ '^#[0-9a-fA-F]{6}$'
           else false
         end;
$$;

-- A JSON number that is a whole number within [p_min, p_max]. CASE rather than
-- AND, because AND does not promise to evaluate left to right and the cast
-- would raise on a string.
create or replace function private.card_json_int_between(p_value jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when jsonb_typeof(p_value) = 'number' then
             (p_value #>> '{}')::numeric between p_min and p_max
             and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
           else false
         end;
$$;

create or replace function private.card_json_keys_within(p_value jsonb, p_allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when jsonb_typeof(p_value) = 'object' then
             not exists (select 1 from jsonb_object_keys(p_value) k where k <> all (p_allowed))
           else false
         end;
$$;


-- The theme is a small, closed document: a preset plus overrides, every value
-- from a fixed list or a hex colour. No raw CSS, no URLs, nothing free-form --
-- which is what lets the renderer turn it into CSS custom properties without
-- sanitising anything. Unknown keys are refused rather than ignored, so a typo
-- in the client fails loudly instead of being silently dropped on save. The
-- 2000-character cap bounds what a hand-built request can store.
create or replace function private.card_theme_is_valid(p_theme jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_part jsonb;
  v_key  text;
begin
  if p_theme is null or jsonb_typeof(p_theme) <> 'object' then
    return false;
  end if;

  if length(p_theme::text) > 2000 then
    return false;
  end if;

  if not private.card_json_keys_within(
           p_theme,
           array['preset', 'layout', 'colors', 'background', 'font', 'buttons', 'avatar', 'density']) then
    return false;
  end if;

  if not private.card_json_in(
           p_theme -> 'preset',
           array['shpe-classic', 'sunrise', 'midnight', 'paper', 'washu', 'engineer', 'glass']) then
    return false;
  end if;

  if p_theme ? 'layout' and not private.card_json_in(
           p_theme -> 'layout', array['classic', 'banner', 'split', 'minimal', 'badge']) then
    return false;
  end if;

  if p_theme ? 'colors' then
    v_part := p_theme -> 'colors';
    if not private.card_json_keys_within(
             v_part, array['background', 'surface', 'text', 'muted', 'accent', 'accentText']) then
      return false;
    end if;
    for v_key in select k from jsonb_object_keys(v_part) k loop
      if not private.card_json_hex(v_part -> v_key) then
        return false;
      end if;
    end loop;
  end if;

  if p_theme ? 'background' then
    v_part := p_theme -> 'background';
    if not private.card_json_keys_within(
             v_part, array['type', 'from', 'to', 'angle', 'dim', 'pattern']) then
      return false;
    end if;
    if not private.card_json_in(v_part -> 'type', array['solid', 'gradient', 'image', 'pattern']) then
      return false;
    end if;
    if v_part ? 'from' and not private.card_json_hex(v_part -> 'from') then
      return false;
    end if;
    if v_part ? 'to' and not private.card_json_hex(v_part -> 'to') then
      return false;
    end if;
    if v_part ? 'angle' and not private.card_json_int_between(v_part -> 'angle', 0, 360) then
      return false;
    end if;
    if v_part ? 'dim' and not private.card_json_int_between(v_part -> 'dim', 0, 80) then
      return false;
    end if;
    if v_part ? 'pattern' and not private.card_json_in(
             v_part -> 'pattern', array['dots', 'grid', 'topo', 'diagonal']) then
      return false;
    end if;
  end if;

  if p_theme ? 'font' then
    v_part := p_theme -> 'font';
    if not private.card_json_keys_within(v_part, array['heading', 'body']) then
      return false;
    end if;
    for v_key in select k from jsonb_object_keys(v_part) k loop
      if not private.card_json_in(
               v_part -> v_key,
               array['libre-franklin', 'inter', 'dm-sans', 'space-grotesk', 'nunito',
                     'playfair-display', 'dm-serif-display', 'jetbrains-mono']) then
        return false;
      end if;
    end loop;
  end if;

  if p_theme ? 'buttons' then
    v_part := p_theme -> 'buttons';
    if not private.card_json_keys_within(v_part, array['shape', 'style', 'arrangement', 'icons']) then
      return false;
    end if;
    if v_part ? 'shape' and not private.card_json_in(
             v_part -> 'shape', array['pill', 'rounded', 'square']) then
      return false;
    end if;
    if v_part ? 'style' and not private.card_json_in(
             v_part -> 'style', array['filled', 'outline', 'soft', 'glass']) then
      return false;
    end if;
    if v_part ? 'arrangement' and not private.card_json_in(
             v_part -> 'arrangement', array['list', 'icon-grid']) then
      return false;
    end if;
    if v_part ? 'icons' and jsonb_typeof(v_part -> 'icons') <> 'boolean' then
      return false;
    end if;
  end if;

  if p_theme ? 'avatar' then
    v_part := p_theme -> 'avatar';
    if not private.card_json_keys_within(v_part, array['shape', 'ring']) then
      return false;
    end if;
    if v_part ? 'shape' and not private.card_json_in(
             v_part -> 'shape', array['circle', 'rounded', 'square', 'hidden']) then
      return false;
    end if;
    if v_part ? 'ring' and jsonb_typeof(v_part -> 'ring') <> 'boolean' then
      return false;
    end if;
  end if;

  if p_theme ? 'density' and not private.card_json_in(
           p_theme -> 'density', array['compact', 'comfortable']) then
    return false;
  end if;

  return true;
exception
  -- Belt and braces: whatever shape of JSON arrives, the answer is "invalid",
  -- never an error out of a CHECK constraint.
  when others then
    return false;
end;
$$;


-- The ordered list of content blocks shown. A block that is not listed is
-- hidden; listing one twice is meaningless, so it is refused.
create or replace function private.card_sections_are_valid(p_sections jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    return false;
  end if;

  if jsonb_array_length(p_sections) > 8 then
    return false;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_sections) e
     where not private.card_json_in(
             e, array['status', 'links', 'about', 'education', 'shpe', 'skills', 'languages', 'featured'])
  ) then
    return false;
  end if;

  return (select count(distinct e #>> '{}') from jsonb_array_elements(p_sections) e)
         = jsonb_array_length(p_sections);
exception
  when others then
    return false;
end;
$$;


-- 3-30 characters of a-z, 0-9 and single hyphens, starting and ending with a
-- letter or digit. Identical to HANDLE_PATTERN in model.ts. Postgres' ARE
-- engine supports the lookahead.
create or replace function private.card_handle_shape_ok(p_handle text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_handle ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$', false);
$$;


-- Media columns hold storage PATHS, never URLs, so a card can only ever load
-- images from this project's own bucket -- no tracking pixels, no third-party
-- image hosts. And the folder must be the card owner's: without that, a member
-- could point their card at an image another member uploaded. The storage
-- policies in 20260914000002 make the same folder rule hold for uploads.
create or replace function private.card_media_path_ok(p_member uuid, p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is null
      or coalesce(
           p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
           and split_part(p_path, '/', 1) = p_member::text,
           false);
$$;


-- Same rules as isLinkValueValid() in model.ts. https only for everything that
-- is a URL: no javascript:, data:, or http:. The renderer re-checks every href
-- through safeExternalHref as well, but this is the line that matters, because
-- it holds however the request was built. Phone numbers need at least seven
-- digits so "(((-)))" is not a phone number. Email refuses, besides @ and
-- whitespace, every character that would make "mailto:<value>" more than an
-- address: a scheme (:), a path, a query (?cc=), a fragment, markup, or a list
-- separator. So "javascript:x@y.co" and "a@b.co?bcc=c@d.co" can't be stored.
create or replace function private.card_link_value_ok(p_kind text, p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    length(p_value) between 1 and 500
    and case p_kind
          when 'email' then p_value ~ '^[^@[:space:]:/?#&<>",;\\]+@[^@[:space:]:/?#&<>",;\\]+\.[^@[:space:]:/?#&<>",;\\]+$'
          when 'phone' then p_value ~ '^\+?[0-9 ().-]{7,20}$'
                            and length(regexp_replace(p_value, '[^0-9]', '', 'g')) >= 7
          else p_value ~* '^https://[^\s<>"'']+$'
        end,
    false);
$$;


create or replace function private.card_link_kind_ok(p_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_kind = any (array[
    'linkedin', 'github', 'email', 'phone', 'website', 'portfolio', 'resume', 'instagram',
    'x', 'tiktok', 'youtube', 'handshake', 'devpost', 'calendly', 'discord', 'custom'
  ]), false);
$$;


-- Skills and languages: a bounded list of short, non-blank tags.
create or replace function private.card_tags_ok(p_tags text[], p_max_items integer, p_max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tags is not null
     and cardinality(p_tags) <= p_max_items
     and not exists (
       select 1 from unnest(p_tags) t
        where t is null or length(btrim(t)) < 1 or length(t) > p_max_length
     );
$$;


-- ── Tables ──────────────────────────────────────────────────────────────────

-- Every handle ever claimed, and who claimed it. Never reassigned: a member who
-- renames keeps the old handle, and it redirects to their current one, so a
-- chip written last year still works. The (handle, member_id) unique key exists
-- for member_cards' composite foreign key below.
--
-- member_id cascades so that deleting an account is still one statement, but
-- the handles do not become free when it does: the trigger on profiles further
-- down copies them into reserved_card_handles first.
create table if not exists public.card_handles (
  handle     text primary key,
  member_id  uuid not null references public.profiles (id) on delete cascade,
  claimed_at timestamptz not null default now(),

  constraint card_handles_handle_member_key unique (handle, member_id),
  constraint card_handles_handle_shape
    check (handle ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$')
);

create index if not exists card_handles_member_idx on public.card_handles (member_id);

comment on table public.card_handles is
  'Every card handle ever claimed, with its owner. Never reassigned; old handles '
  'redirect to the owner''s current one, and a deleted member''s handles are '
  'retired into reserved_card_handles. Only an officer release frees one. '
  'Unreachable from any client role.';


-- Words kept free: routes, the brand, and role names that might one day mean
-- "whoever holds this office" (plan section 12). Exactly RESERVED_HANDLES in
-- model.ts. The shape check here is looser than a claimable handle's, because a
-- few entries ("c", "me", "qr", "vp") are shorter than any handle can be --
-- reserved anyway, so that relaxing the minimum length later cannot quietly
-- open them up.
create table if not exists public.reserved_card_handles (
  handle text primary key,
  reason text,

  constraint reserved_card_handles_handle_shape
    check (handle ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,29}$')
);

insert into public.reserved_card_handles (handle, reason)
select h, 'route'
  from unnest(array[
    'about', 'admin', 'administrator', 'api', 'app', 'apps', 'assets', 'auth', 'c', 'card',
    'cards', 'contact', 'dashboard', 'edit', 'events', 'help', 'home', 'images', 'join', 'login',
    'logout', 'me', 'member', 'members', 'my', 'new', 'nfc', 'null', 'portal', 'privacy', 'qr',
    'register', 'root', 'security', 'settings', 'signup', 'static', 'support', 'system', 'terms',
    'test', 'undefined', 'www'
  ]) as h
union all
select h, 'brand'
  from unnest(array[
    'chapter', 'national', 'official', 'shpe', 'shpe-washu', 'sponsor', 'sponsors', 'sponsorship',
    'washu', 'washu-shpe', 'washushpe', 'wustl', 'leadership', 'team', 'staff'
  ]) as h
union all
select h, 'role'
  from unnest(array[
    'eboard', 'exec', 'executive', 'officer', 'officers', 'president', 'vice-president', 'vp',
    'treasurer', 'secretary', 'external', 'internal', 'external-representative',
    'internal-representative', 'moderator', 'mod'
  ]) as h
on conflict (handle) do nothing;

-- Rows with reason 'retired: account deleted' are added at runtime, by the
-- trigger on profiles, and are not in model.ts: they are other people's old
-- addresses, and the editor learns about them from check_card_handle().
comment on table public.reserved_card_handles is
  'Handles nobody can claim: the fixed words mirrored by RESERVED_HANDLES in '
  'src/features/cards/model.ts, plus the handles of deleted accounts (reason '
  '''retired: account deleted''). This table is the control.';


-- One card per member.
--
-- created_by is null or equal to member_id when the member made the card, and
-- an officer's id when an officer did. officer_created records the same fact
-- permanently: created_by is set null if that officer's account is ever
-- deleted, and "an officer set this card up" must not quietly turn false then
-- -- the member would lose the banner telling them so, and the officer list
-- would stop counting the card as unopened. Every created_by_officer the
-- client sees comes from officer_created, never from created_by.
--
-- member_opened_at is the member's first save (or first publish): null means
-- officer-made and not yet opened, which is what the starter rule in
-- get_public_card() keys on. It keys on that alone, so that a row nobody
-- opened fails closed whatever else is true of it.
create table if not exists public.member_cards (
  member_id        uuid primary key references public.profiles (id) on delete cascade,
  handle           text not null,
  is_published     boolean not null default false,
  allow_indexing   boolean not null default false,

  hidden_at        timestamptz,
  hidden_reason    text,

  created_by       uuid references public.profiles (id) on delete set null,
  officer_created  boolean not null default false,
  member_opened_at timestamptz,
  chip_handle      text,
  chip_written_at  timestamptz,

  display_name     text not null,
  pronouns         text,
  headline         text,
  organization     text default 'Washington University in St. Louis',
  status_line      text,
  bio              text,
  location         text,
  skills           text[] not null default '{}',
  languages        text[] not null default '{}',

  avatar_path      text,
  banner_path      text,
  background_path  text,

  show_major             boolean not null default true,
  show_graduation_year   boolean not null default true,
  show_member_since      boolean not null default false,
  show_national_member   boolean not null default true,
  show_chapter_position  boolean not null default true,

  theme            jsonb not null default '{"preset":"shpe-classic"}'::jsonb,
  sections         jsonb not null default '["status","featured","links","about","education","shpe"]'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint member_cards_handle_key unique (handle),

  -- The card's current handle is always one its owner holds. This is what
  -- makes "point my card at someone else's old handle" impossible at the
  -- schema level rather than only in save_my_card().
  constraint member_cards_handle_owned
    foreign key (handle, member_id) references public.card_handles (handle, member_id),

  constraint member_cards_handle_shape
    check (handle ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$'),
  constraint member_cards_chip_handle_shape
    check (chip_handle is null or chip_handle ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$'),

  -- Hidden always comes with a reason, and unhiding clears both.
  constraint member_cards_hidden_reason
    check ((hidden_at is null) = (hidden_reason is null)
           and coalesce(length(hidden_reason), 0) <= 300),

  constraint member_cards_lengths check (
        length(btrim(display_name)) between 1 and 80
    and coalesce(length(pronouns), 0)     <= 30
    and coalesce(length(headline), 0)     <= 100
    and coalesce(length(organization), 0) <= 100
    and coalesce(length(status_line), 0)  <= 120
    and coalesce(length(bio), 0)          <= 600
    and coalesce(length(location), 0)     <= 80
  ),
  constraint member_cards_skills_valid    check (private.card_tags_ok(skills, 15, 30)),
  constraint member_cards_languages_valid check (private.card_tags_ok(languages, 8, 30)),

  constraint member_cards_media_paths check (
        private.card_media_path_ok(member_id, avatar_path)
    and private.card_media_path_ok(member_id, banner_path)
    and private.card_media_path_ok(member_id, background_path)
  ),

  constraint member_cards_theme_valid    check (private.card_theme_is_valid(theme)),
  constraint member_cards_sections_valid check (private.card_sections_are_valid(sections))
);

comment on table public.member_cards is
  'One business card per member. Unreachable from any client role: read through '
  'get_public_card() / get_my_card(), written through save_my_card() and the '
  'audited admin_* functions.';


-- Links, ordered. Email and phone live here too, so a member can put them in
-- any order. A child table rather than a jsonb array so that every link is
-- checked by a constraint and has a stable id -- insights count clicks per link
-- id, which is why save_my_card() upserts by id instead of replacing the set.
create table if not exists public.member_card_links (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.member_cards (member_id) on delete cascade,
  kind        text not null,
  label       text,
  value       text not null,
  sort_order  integer not null,
  is_featured boolean not null default false,
  is_visible  boolean not null default true,

  constraint member_card_links_kind  check (private.card_link_kind_ok(kind)),
  constraint member_card_links_value check (private.card_link_value_ok(kind, value)),
  constraint member_card_links_label check (
    label is null or (length(btrim(label)) between 1 and 40)
  )
);

create index if not exists member_card_links_member_idx
  on public.member_card_links (member_id, sort_order);

-- One featured link per card: it renders as the big primary button.
create unique index if not exists member_card_links_one_featured
  on public.member_card_links (member_id) where is_featured;

comment on table public.member_card_links is
  'Links on a member''s card, in order. Values are https URLs, emails or phone '
  'numbers, enforced by CHECK. Written only through save_my_card().';


-- Officer-assigned titles. The only source of the verified "WashU SHPE ·
-- President" line on a card: a member can write anything in their headline,
-- but it renders as plain text with no badge, and nothing a member can call
-- writes here.
create table if not exists public.chapter_positions (
  member_id  uuid primary key references public.profiles (id) on delete cascade,
  title      text not null,
  sort_order integer not null default 100,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),

  constraint chapter_positions_title_length check (length(btrim(title)) between 2 and 60)
);

comment on table public.chapter_positions is
  'Officer-assigned chapter positions, shown verified on business cards. Written '
  'only through admin_set_chapter_position().';


-- Insights are daily counters: no IP addresses, no user agents, no per-visit
-- rows. Bounded at members x days x sources however much traffic a card gets,
-- which matters on a 500 MB database that strangers can write to.
create table if not exists public.card_daily_stats (
  member_id uuid    not null references public.member_cards (member_id) on delete cascade,
  day       date    not null,
  source    text    not null,
  views     integer not null default 0,
  saves     integer not null default 0,
  shares    integer not null default 0,

  primary key (member_id, day, source),
  constraint card_daily_stats_source check (source in ('nfc', 'qr', 'link')),
  constraint card_daily_stats_nonnegative check (views >= 0 and saves >= 0 and shares >= 0)
);

create table if not exists public.card_link_daily_clicks (
  link_id uuid    not null references public.member_card_links (id) on delete cascade,
  day     date    not null,
  clicks  integer not null default 0,

  primary key (link_id, day),
  constraint card_link_daily_clicks_nonnegative check (clicks >= 0)
);

comment on table public.card_daily_stats is
  'Per-card daily view/save/share counters by source. No per-visit data.';
comment on table public.card_link_daily_clicks is
  'Per-link daily click counters. Survives saves because links are upserted by id.';


-- Handles an officer took away from a member. Releasing a handle deletes it
-- from card_handles so the person it really belongs to can claim it -- and
-- without this table, the member it was taken from could claim it straight
-- back, on purpose or just by saving from an editor they had open during the
-- reset. A row here refuses that one member and nobody else: everyone else
-- sees the handle as available, as the release intends.
create table if not exists public.card_handle_blocks (
  handle     text not null,
  member_id  uuid not null references public.profiles (id) on delete cascade,
  reason     text not null,
  blocked_by uuid references public.profiles (id) on delete set null,
  blocked_at timestamptz not null default now(),

  primary key (handle, member_id)
);

comment on table public.card_handle_blocks is
  'Handles an officer released from a member, which that member may not claim '
  'again. Everyone else can. Written only by admin_release_card_handle() and '
  'admin_reset_card_handle(); unreachable from any client role.';


-- RLS on, zero policies, no grants, on every table. Supabase's default
-- privileges hand ALL on a new public table to anon and authenticated, so the
-- revoke is what actually closes them; RLS with no policies is the second lock.
alter table public.card_handles           enable row level security;
alter table public.reserved_card_handles  enable row level security;
alter table public.member_cards           enable row level security;
alter table public.member_card_links      enable row level security;
alter table public.chapter_positions      enable row level security;
alter table public.card_daily_stats       enable row level security;
alter table public.card_link_daily_clicks enable row level security;
alter table public.card_handle_blocks     enable row level security;

revoke all on public.card_handles           from public, anon, authenticated;
revoke all on public.reserved_card_handles  from public, anon, authenticated;
revoke all on public.member_cards           from public, anon, authenticated;
revoke all on public.member_card_links      from public, anon, authenticated;
revoke all on public.chapter_positions      from public, anon, authenticated;
revoke all on public.card_daily_stats       from public, anon, authenticated;
revoke all on public.card_link_daily_clicks from public, anon, authenticated;
revoke all on public.card_handle_blocks     from public, anon, authenticated;


-- ── A deleted member's handles are retired, not freed ───────────────────────
--
-- Deleting an account cascades through profiles to card_handles. Left alone,
-- that would free every handle the member ever held, and the next person to
-- claim one would inherit their written chip, their printed QR codes and the
-- card URL inside every contact a recruiter saved from them -- all opening a
-- stranger's card under the chapter's name.
--
-- A BEFORE DELETE trigger on profiles, rather than one on card_handles, because
-- it asks the question that matters directly: "this person is going away". A
-- trigger on card_handles would have to infer that from whether the profile
-- row is still visible mid-cascade, which depends on the order foreign-key
-- actions run in. This one fires on every path that removes a profile --
-- admin_delete_member(), deleting the auth user from the dashboard, a plain
-- DELETE -- and on none of the paths that free a handle on purpose: an officer
-- release deletes card_handles rows while the profile stays.
--
-- Only handles that can be out in the world are retired: the card is
-- published, a chip was recorded for it, or it has ever been viewed (a view is
-- only counted while a card is public, so any stats row means its address was
-- live at some point and may be on a printed QR code or in someone's
-- contacts). A draft that never resolved for anyone -- typically the duplicate
-- or junk account admin_delete_member() exists to clean up -- has nothing out
-- there to protect, so its handles are freed, and the person's real account
-- can still have them. When a card qualifies, all its owner's handles go:
-- old ones redirected while it was live.
--
-- Definer, because whoever deletes the auth user (Supabase's auth admin role,
-- or the dashboard) has no rights on these tables.
create or replace function private.retire_card_handles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
       select 1 from public.member_cards c
        where c.member_id = old.id
          and (c.is_published or c.chip_written_at is not null))
     or exists (
       select 1 from public.card_daily_stats s where s.member_id = old.id)
  then
    insert into public.reserved_card_handles (handle, reason)
    select h.handle, 'retired: account deleted'
      from public.card_handles h
     where h.member_id = old.id
    on conflict (handle) do nothing;
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_retire_card_handles on public.profiles;
create trigger profiles_retire_card_handles
  before delete on public.profiles
  for each row execute function private.retire_card_handles();


-- ── Who is calling ──────────────────────────────────────────────────────────
--
-- The member-side functions all start here. Signed in, and either let in (not
-- pending) or an officer -- the same line 20260911000001 draws for every other
-- piece of member data. A pending account can be had by anyone with an address
-- at an allowed domain, so it must not be able to claim a handle that would
-- then look official.

create or replace function private.require_card_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not private.is_approved_member(v_caller) and not private.is_officer(v_caller) then
    raise exception 'Not authorised to use business cards' using errcode = '42501';
  end if;

  return v_caller;
end;
$$;


-- ── Handle suggestions ──────────────────────────────────────────────────────
--
-- One implementation, used by the My Card pre-fill and by officer creation, so
-- the two cannot drift apart.
--
-- Accents are folded without the unaccent extension (no extension dependency,
-- and it works in the PGlite test harness), in three steps:
--
--   1. normalize(NFD) splits every precomposed letter into its base letter and
--      combining marks: "é" -> "e" + U+0301, "ễ" -> "e" + U+0302 + U+0303,
--      "ơ" -> "o" + U+031B. Browsers submit names composed (NFC), so without
--      this Vietnamese names came out as "nguy-n" -- and a bulk-created handle
--      is what gets written to a chip.
--   2. Every combining mark is dropped, whatever letter it was on.
--   3. An explicit map handles the letters Unicode does not decompose because
--      they are letters in their own right: ß æ œ þ become two letters, and
--      đ ħ ı ł ŀ ø ŧ ð ſ ŋ become their nearest a-z letter.
--
-- Apostrophes vanish rather than splitting a name ("O'Neil" -> "oneil"), and
-- everything else outside a-z0-9 becomes a single hyphen. A name in a script
-- with no Latin reading (Cyrillic, CJK, Arabic) folds to nothing; the callers
-- give that member a neutral member-xxxxxx handle instead.
--
-- Never derived from the email: "d.gonzalez" would publish a member's wustl.edu
-- username, and member emails are never public.

create or replace function private.card_handle_fold(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
           regexp_replace(
             lower(
               translate(
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                   regexp_replace(
                     normalize(coalesce(p_text, ''), NFD),
                     '[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯''’`]', '', 'g'),
                   'ß', 'ss'), 'ẞ', 'ss'), 'æ', 'ae'), 'Æ', 'ae'), 'œ', 'oe'), 'Œ', 'oe'),
                   'þ', 'th'), 'Þ', 'th'), 'ĳ', 'ij'), 'Ĳ', 'ij'), 'ŉ', 'n'),
                 'đĐħĦıłŁŀĿøØŧŦðÐſŋŊ',
                 'ddhhilllloottddsnn'
               )
             ),
             '[^a-z0-9]+', '-', 'g'
           ),
           '-'
         );
$$;

-- Whether a name is blank, counting the invisible spaces a pasted name can
-- carry (no-break, zero-width, ideographic) as blank too. Only a blank name is
-- "no name": a name in any script, even one with nothing a handle can use,
-- is a name, and its owner still gets a card.
create or replace function private.card_name_is_blank(p_first text, p_last text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           coalesce(p_first, '') || coalesce(p_last, ''),
           '[\s   -‍    ⁠　﻿]', '', 'g') = '';
$$;

-- Shortens a slug to at most p_max characters, cutting at a hyphen so that
-- "maria-jose-garcia-lopez-hernandez" loses whole words rather than ending in
-- half of one. A single word longer than the limit is simply truncated.
create or replace function private.card_handle_cut(p_slug text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when length(p_slug) <= p_max then p_slug
           when substr(p_slug, p_max + 1, 1) = '-' then btrim(left(p_slug, p_max), '-')
           when position('-' in left(p_slug, p_max)) > 0
             then btrim(substring(left(p_slug, p_max) from '^(.*)-'), '-')
           else left(p_slug, p_max)
         end;
$$;

-- The first word of a name that has anything left after folding. Words are
-- split on whitespace and hyphens, so "Ana-Lucia" -> "ana" and "Garcia Lopez"
-- -> "garcia".
create or replace function private.card_handle_first_word(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select private.card_handle_fold(w)
       from regexp_split_to_table(coalesce(p_name, ''), '[\s-]+') with ordinality as t (w, o)
      where private.card_handle_fold(w) <> ''
      order by o
      limit 1),
    '');
$$;

-- Usable: the right shape, not reserved, never claimed by anyone (current or
-- old handles alike), and not already proposed earlier in the same run.
create or replace function private.card_handle_usable(p_handle text, p_exclude text[] default '{}')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.card_handle_shape_ok(p_handle)
     and not (p_handle = any (coalesce(p_exclude, '{}'::text[])))
     and not exists (select 1 from public.reserved_card_handles r where r.handle = p_handle)
     and not exists (select 1 from public.card_handles h where h.handle = p_handle);
$$;

-- p_exclude plus every handle an officer released from this member. Those are
-- free for everyone else, so card_handle_usable() accepts them -- but offering
-- one back to the member it was taken from would undo the release.
create or replace function private.card_handle_exclusions(p_member uuid, p_exclude text[] default '{}')
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_exclude, '{}'::text[])
         || coalesce((select array_agg(b.handle) from public.card_handle_blocks b
                       where b.member_id = p_member), '{}'::text[]);
$$;

-- The handle for a member whose name gives nothing to work with (it is all in
-- a script the fold cannot read, or every candidate is somehow taken):
-- "member-" and six hex characters. Derived from the member id rather than
-- random, so a bulk preview proposes the same handle the real run then
-- creates, and the My Card pre-fill does not change on every load. The id is
-- already public in the card's image paths, so this reveals nothing new. Each
-- n gives a different candidate; null only if a hundred in a row are taken.
create or replace function private.card_fallback_handle(p_member uuid, p_exclude text[] default '{}')
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exclude   text[] := private.card_handle_exclusions(p_member, p_exclude);
  v_candidate text;
  v_n         integer;
begin
  for v_n in 0..99 loop
    v_candidate := 'member-' || substr(md5(p_member::text || ':' || v_n::text), 1, 6);
    if private.card_handle_usable(v_candidate, v_exclude) then
      return v_candidate;
    end if;
  end loop;
  return null;
end;
$$;

-- Candidates, in order:
--   1. first word of first name + first word of last name   maria-garcia
--   2. the full name, if it differs and fits whole           maria-jose-garcia-lopez
--   3. with the two-digit class year                         maria-garcia-28
--   4. -2, -3, ...                                           maria-garcia-2
--   5. member-xxxxxx, when the name folds to nothing         member-3f9a1c
-- If one name is blank the other is used alone. Both blank returns null rather
-- than a meaningless handle; callers report that as "add a name first". Every
-- other member gets a handle: a name the fold cannot read is still a name, and
-- leaving its owner without a card would quietly drop them from card-writing
-- night. Handles an officer released from this member are never suggested.
create or replace function private.suggest_card_handle(p_member uuid, p_exclude text[] default '{}')
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile   public.profiles;
  v_exclude   text[];
  v_base      text;
  v_full      text;
  v_suffix    text;
  v_candidate text;
  v_n         integer;
begin
  select * into v_profile from public.profiles p where p.id = p_member;
  if not found then
    return null;
  end if;

  if private.card_name_is_blank(v_profile.first_name, v_profile.last_name) then
    return null;
  end if;

  v_exclude := private.card_handle_exclusions(p_member, p_exclude);

  v_base := private.card_handle_cut(
              concat_ws('-',
                        nullif(private.card_handle_first_word(v_profile.first_name), ''),
                        nullif(private.card_handle_first_word(v_profile.last_name), '')),
              30);
  if v_base is null or v_base = '' then
    return private.card_fallback_handle(p_member, v_exclude);
  end if;

  if private.card_handle_usable(v_base, v_exclude) then
    return v_base;
  end if;

  v_full := private.card_handle_fold(concat_ws(' ', v_profile.first_name, v_profile.last_name));
  if v_full <> v_base and length(v_full) <= 30 and private.card_handle_usable(v_full, v_exclude) then
    return v_full;
  end if;

  if v_profile.graduation_year is not null then
    v_suffix := '-' || lpad((v_profile.graduation_year % 100)::text, 2, '0');
    v_candidate := private.card_handle_cut(v_base, 30 - length(v_suffix)) || v_suffix;
    if private.card_handle_usable(v_candidate, v_exclude) then
      return v_candidate;
    end if;
  end if;

  -- Bounded so a pathological state cannot spin forever; a chapter would need
  -- ten thousand members sharing a name to reach the end.
  for v_n in 2..10000 loop
    v_suffix := '-' || v_n::text;
    v_candidate := private.card_handle_cut(v_base, 30 - length(v_suffix)) || v_suffix;
    if private.card_handle_usable(v_candidate, v_exclude) then
      return v_candidate;
    end if;
  end loop;

  return private.card_fallback_handle(p_member, v_exclude);
end;
$$;


-- ── Shapes returned to the client ───────────────────────────────────────────
--
-- One builder per TypeScript type in src/types/database.ts, so every function
-- that returns a MemberCard returns the same keys. Not security definer: they
-- are only ever called from definer functions, and EXECUTE is revoked below.

-- Whether a recorded chip still resolves to this card. A chip carries one
-- handle forever. A rename keeps that handle in card_handles, so it redirects;
-- an officer's handle reset deletes it, so the chip is dead and needs
-- rewriting. Officers and the member both need to tell those two apart.
-- null when an officer recorded no chip. A card row is null (left join) in
-- admin_list_cards for members without a card, which also yields null.
create or replace function private.card_chip_handle_active(c public.member_cards)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
           when c.chip_handle is null then null
           else exists (
             select 1 from public.card_handles h
              where h.handle = c.chip_handle
                and h.member_id = c.member_id)
         end;
$$;

-- MemberCard. created_by itself is not exposed, only whether it was an officer
-- -- and that comes from officer_created, which outlives the officer's account.
create or replace function private.member_card_json(c public.member_cards)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'member_id',             c.member_id,
    'handle',                c.handle,
    'is_published',          c.is_published,
    'allow_indexing',        c.allow_indexing,
    'hidden_at',             c.hidden_at,
    'hidden_reason',         c.hidden_reason,
    'created_by_officer',    c.officer_created,
    'member_opened_at',      c.member_opened_at,
    'chip_handle',           c.chip_handle,
    -- Whether the chip still lands on this card: true while chip_handle is one
    -- of the member's handles (current or an old one that redirects), false
    -- once an officer's handle reset deleted it. null when no chip is recorded.
    'chip_handle_active',    private.card_chip_handle_active(c),
    'chip_written_at',       c.chip_written_at,
    'display_name',          c.display_name,
    'pronouns',              c.pronouns,
    'headline',              c.headline,
    'organization',          c.organization,
    'status_line',           c.status_line,
    'bio',                   c.bio,
    'location',              c.location,
    'skills',                to_jsonb(c.skills),
    'languages',             to_jsonb(c.languages),
    'avatar_path',           c.avatar_path,
    'banner_path',           c.banner_path,
    'background_path',       c.background_path,
    'show_major',            c.show_major,
    'show_graduation_year',  c.show_graduation_year,
    'show_member_since',     c.show_member_since,
    'show_national_member',  c.show_national_member,
    'show_chapter_position', c.show_chapter_position,
    'theme',                 c.theme,
    'sections',              c.sections,
    'created_at',            c.created_at,
    'updated_at',            c.updated_at
  );
$$;

-- CardProfileFields: the profile facts a card can show, read live.
create or replace function private.card_profile_json(p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'first_name',               p.first_name,
    'last_name',                p.last_name,
    'major',                    p.major,
    'secondary_major',          p.secondary_major,
    'graduation_year',          p.graduation_year,
    'degree_level',             p.degree_level,
    'member_since',             p.member_since,
    'national_member_verified', p.shpe_national_member = 'verified',
    'membership_status',        p.membership_status
  );
$$;

-- MyCardState: what the editor loads, and what every member write returns so
-- the editor can reset its form to exactly what was stored.
create or replace function private.my_card_state(p_member uuid, p_enabled boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled',  p_enabled,
    'card',     (select private.member_card_json(c) from public.member_cards c
                  where c.member_id = p_member),
    'links',    coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'id',          l.id,
                           'kind',        l.kind,
                           'label',       l.label,
                           'value',       l.value,
                           'sort_order',  l.sort_order,
                           'is_featured', l.is_featured,
                           'is_visible',  l.is_visible
                         ) order by l.sort_order, l.id)
                    from public.member_card_links l
                   where l.member_id = p_member), '[]'::jsonb),
    'position', (select cp.title from public.chapter_positions cp where cp.member_id = p_member),
    'profile',  (select private.card_profile_json(p) from public.profiles p where p.id = p_member)
  );
$$;

-- The one definition of "a stranger may see this card". get_public_card() and
-- record_card_event() both use it, so a card that does not resolve cannot be
-- counted either.
create or replace function private.card_is_public(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.cards_enabled()
     and exists (
       select 1
         from public.member_cards c
         join public.profiles p on p.id = c.member_id
        where c.member_id = p_member
          and c.is_published
          and c.hidden_at is null
          and p.membership_status in ('active', 'alumni', 'inactive')
     );
$$;


-- Whether a card's design shows the member's photo: not the "hidden" shape,
-- and not a layout that draws none (Minimal, which the Paper preset uses by
-- default). Mirrors storedThemeShowsPhoto() in src/features/cards/photoVisibility.ts,
-- including its preset defaults: Paper is the only preset whose default layout
-- has no photo, and no preset defaults to the hidden shape.
-- src/features/cards/__tests__/photoVisibilitySql.test.ts fails if a preset
-- changes and this list doesn't. The theme CHECK guarantees layout and shape
-- are valid values or absent, so no other fallback is needed.
create or replace function private.card_theme_shows_photo(p_theme jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not (
    coalesce(p_theme ->> 'layout',
             case p_theme ->> 'preset' when 'paper' then 'minimal' else 'classic' end) = 'minimal'
    or coalesce(p_theme -> 'avatar' ->> 'shape', '') = 'hidden'
  );
$$;

revoke execute on function private.card_theme_shows_photo(jsonb) from public, anon, authenticated;


-- ── Public: read a card ─────────────────────────────────────────────────────
--
-- anon and authenticated. Three outcomes, and the first is deliberately vague:
--
--   not_found  bad shape, unknown, unpublished, hidden, pending or suspended
--              owner, or the feature switched off -- all the same answer
--   redirect   an old handle of a visible card; the page replaces the URL, so
--              an old chip lands on the current handle
--   ok         the card, cut to what it chose to show
--
-- What a card shows is decided here and nowhere else, and viewModel.ts's
-- toPreviewCard() mirrors it so the editor preview is honest:
--
--   education  major + second major when show_major; class year when
--              show_graduation_year; degree level when either; null when
--              nothing is left
--   shpe       the officer-assigned position when show_chapter_position;
--              member since when show_member_since; the National badge only
--              when show_national_member AND an officer verified it
--   links      visible links only, in order -- hidden ones never leave
--   photo      avatar_path only when the design shows it. A photo hidden by the
--              "No photo" shape or a photoless layout stays saved (switching
--              back brings it back), but its address never leaves the database,
--              so the hidden face isn't one view-source away
--
-- The starter rule: an officer-made card the member has not opened shows only
-- name, school, education and position, whatever the row holds. An officer
-- cannot fill in the rest (admin_create_card writes nothing else), but the rule
-- does not rely on that -- it is enforced on the way out as well.

create or replace function public.get_public_card(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handle    text := lower(btrim(p_handle));
  v_owner     uuid;
  v_card      public.member_cards;
  v_profile   public.profiles;
  v_position  text;
  v_starter   boolean;
  v_major     text;
  v_secondary text;
  v_year      integer;
  v_degree    public.degree_level;
  v_education jsonb;
  v_links     jsonb;
begin
  if not private.card_handle_shape_ok(v_handle) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select h.member_id into v_owner from public.card_handles h where h.handle = v_handle;
  if v_owner is null or not private.card_is_public(v_owner) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_card    from public.member_cards c where c.member_id = v_owner;
  select * into v_profile from public.profiles p     where p.id = v_owner;

  if v_card.handle <> v_handle then
    return jsonb_build_object('status', 'redirect', 'handle', v_card.handle);
  end if;

  v_starter := v_card.member_opened_at is null;

  select cp.title into v_position from public.chapter_positions cp where cp.member_id = v_owner;

  -- Blank counts as absent. Profiles are written through blankToNull, but a
  -- direct PATCH can still store '', and toPreviewCard() treats '' as absent,
  -- so the live card and the editor preview must agree.
  v_major     := case when v_card.show_major then nullif(btrim(v_profile.major), '') end;
  v_secondary := case when v_card.show_major then nullif(btrim(v_profile.secondary_major), '') end;
  v_year      := case when v_card.show_graduation_year then v_profile.graduation_year end;
  v_degree    := case when v_card.show_major or v_card.show_graduation_year
                      then v_profile.degree_level end;
  v_education := case
                   when v_major is not null or v_secondary is not null or v_year is not null
                     then jsonb_build_object(
                            'major',           v_major,
                            'secondary_major', v_secondary,
                            'graduation_year', v_year,
                            'degree_level',    v_degree)
                 end;

  if v_starter then
    return jsonb_build_object(
      'status', 'ok',
      'card', jsonb_build_object(
        'handle',          v_card.handle,
        'display_name',    v_card.display_name,
        'pronouns',        null,
        'headline',        null,
        'organization',    v_card.organization,
        'status_line',     null,
        'bio',             null,
        'location',        null,
        'skills',          '[]'::jsonb,
        'languages',       '[]'::jsonb,
        'avatar_path',     null,
        'banner_path',     null,
        'background_path', null,
        'theme',           '{"preset":"shpe-classic"}'::jsonb,
        'sections',        '["status","featured","links","about","education","shpe"]'::jsonb,
        'allow_indexing',  false,
        'is_starter',      true,
        'education',       v_education,
        'shpe', jsonb_build_object(
          'position',                 case when v_card.show_chapter_position then v_position end,
          'member_since',             null,
          'national_member_verified', false,
          'is_alumni',                false
        ),
        'links',           '[]'::jsonb
      )
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          l.id,
           'kind',        l.kind,
           'label',       l.label,
           'value',       l.value,
           'is_featured', l.is_featured
         ) order by l.sort_order, l.id), '[]'::jsonb)
    into v_links
    from public.member_card_links l
   where l.member_id = v_owner
     and l.is_visible;

  return jsonb_build_object(
    'status', 'ok',
    'card', jsonb_build_object(
      'handle',          v_card.handle,
      'display_name',    v_card.display_name,
      'pronouns',        v_card.pronouns,
      'headline',        v_card.headline,
      'organization',    v_card.organization,
      'status_line',     v_card.status_line,
      'bio',             v_card.bio,
      'location',        v_card.location,
      'skills',          to_jsonb(v_card.skills),
      'languages',       to_jsonb(v_card.languages),
      'avatar_path',     case when private.card_theme_shows_photo(v_card.theme)
                              then v_card.avatar_path end,
      'banner_path',     v_card.banner_path,
      'background_path', v_card.background_path,
      'theme',           v_card.theme,
      'sections',        v_card.sections,
      'allow_indexing',  v_card.allow_indexing,
      'is_starter',      false,
      'education',       v_education,
      'shpe', jsonb_build_object(
        'position',                 case when v_card.show_chapter_position then v_position end,
        'member_since',             case when v_card.show_member_since then v_profile.member_since end,
        'national_member_verified', v_card.show_national_member
                                    and v_profile.shpe_national_member = 'verified',
        'is_alumni',                v_profile.membership_status = 'alumni'
      ),
      'links',           v_links
    )
  );
end;
$$;

revoke execute on function public.get_public_card(text) from public, anon, authenticated;
grant execute on function public.get_public_card(text) to anon, authenticated;


-- ── Public: count a visit ───────────────────────────────────────────────────
--
-- anon and authenticated, and it never fails: a count that errors would only
-- ever get in the way of the person standing there with the card. Everything it
-- does not like is a silent no-op -- unknown event or source, unknown handle,
-- a card that is not visible, the owner looking at their own card, a link that
-- is not a visible link on that card (or any link on a starter card, which
-- shows none).
--
-- At worst someone inflates a card's numbers. The plan accepts that: it only
-- ever increments a counter, the rows are bounded per day, and nothing about a
-- visitor is stored. The day is chapter-local, the same clock the leaderboard
-- uses, so "today" in Insights is the member's today.

create or replace function public.record_card_event(
  p_handle  text,
  p_event   text,
  p_source  text,
  p_link_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_handle text := lower(btrim(p_handle));
  v_owner  uuid;
  v_day    date := (now() at time zone 'America/Chicago')::date;
begin
  if p_event is null or p_event not in ('view', 'save', 'share', 'link_click') then
    return;
  end if;
  if p_source is null or p_source not in ('nfc', 'qr', 'link') then
    return;
  end if;
  if not private.card_handle_shape_ok(v_handle) then
    return;
  end if;

  select h.member_id into v_owner from public.card_handles h where h.handle = v_handle;
  if v_owner is null then
    return;
  end if;

  -- Owners checking their own card are not an audience.
  if v_owner = auth.uid() then
    return;
  end if;

  if not private.card_is_public(v_owner) then
    return;
  end if;

  if p_event = 'link_click' then
    if p_link_id is null or not exists (
      select 1
        from public.member_card_links l
        join public.member_cards c on c.member_id = l.member_id
       where l.id = p_link_id
         and l.member_id = v_owner
         and l.is_visible
         and c.member_opened_at is not null
    ) then
      return;
    end if;

    insert into public.card_link_daily_clicks (link_id, day, clicks)
    values (p_link_id, v_day, 1)
    on conflict (link_id, day) do update
      set clicks = public.card_link_daily_clicks.clicks + 1;
    return;
  end if;

  insert into public.card_daily_stats (member_id, day, source, views, saves, shares)
  values (v_owner, v_day, p_source,
          (p_event = 'view')::integer,
          (p_event = 'save')::integer,
          (p_event = 'share')::integer)
  on conflict (member_id, day, source) do update
    set views  = public.card_daily_stats.views  + excluded.views,
        saves  = public.card_daily_stats.saves  + excluded.saves,
        shares = public.card_daily_stats.shares + excluded.shares;
end;
$$;

revoke execute on function public.record_card_event(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_card_event(text, text, text, uuid) to anon, authenticated;


-- ── My Card: read ───────────────────────────────────────────────────────────
--
-- Switched off, a member learns that and nothing else, like the leaderboard.
-- An officer still gets their card, so they can set theirs up and preview the
-- feature before turning it on.

create or replace function public.get_my_card()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member  uuid := private.require_card_member();
  v_enabled boolean := private.cards_enabled();
begin
  if not v_enabled and not private.is_officer(v_member) then
    return jsonb_build_object('enabled', false);
  end if;

  return private.my_card_state(v_member, v_enabled);
end;
$$;

revoke execute on function public.get_my_card() from public, anon, authenticated;
grant execute on function public.get_my_card() to authenticated;


-- The editor's pre-fill: the current handle if the member already has a card
-- (an officer may have made one), otherwise a fresh suggestion -- a
-- member-xxxxxx one if their name has nothing a handle can use, so the field
-- is never empty for someone who has a name.
create or replace function public.suggest_my_card_handle()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := private.require_card_member();
  v_handle text;
begin
  select c.handle into v_handle from public.member_cards c where c.member_id = v_member;
  return coalesce(v_handle, private.suggest_card_handle(v_member));
end;
$$;

revoke execute on function public.suggest_my_card_handle() from public, anon, authenticated;
grant execute on function public.suggest_my_card_handle() to authenticated;


-- Live availability while typing. Signed-in members only, so the namespace
-- cannot be enumerated anonymously -- and "taken" says nothing about whose it
-- is or whether that card is published.
--
-- The caller's current handle answers "yours" even if the word has since been
-- reserved: they already hold it, and saving their card without renaming it
-- must keep working.
--
-- "removed" means an officer released this handle from the caller's card. It
-- comes first, so the member is told why rather than seeing "available" for a
-- handle save_my_card() will then refuse. Only the caller ever sees it; to
-- everyone else the same handle is available.
create or replace function public.check_card_handle(p_handle text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := private.require_card_member();
  v_handle text := lower(btrim(p_handle));
  v_owner  uuid;
begin
  if not private.card_handle_shape_ok(v_handle) then
    return 'invalid';
  end if;

  if exists (select 1 from public.card_handle_blocks b
              where b.handle = v_handle and b.member_id = v_member) then
    return 'removed';
  end if;

  if exists (select 1 from public.member_cards c
              where c.member_id = v_member and c.handle = v_handle) then
    return 'yours';
  end if;

  if exists (select 1 from public.reserved_card_handles r where r.handle = v_handle) then
    return 'reserved';
  end if;

  select h.member_id into v_owner from public.card_handles h where h.handle = v_handle;
  if v_owner is null then
    return 'available';
  end if;

  return case when v_owner = v_member then 'yours' else 'taken' end;
end;
$$;

revoke execute on function public.check_card_handle(text) from public, anon, authenticated;
grant execute on function public.check_card_handle(text) to authenticated;


-- ── My Card: save ───────────────────────────────────────────────────────────
--
-- Input helpers. Each raises a plain 22023 for a request the editor would never
-- build (a number where text belongs), so a hand-crafted request gets a clear
-- refusal instead of a cast error.

create or replace function private.card_input_text(p_input jsonb, p_key text, p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_input -> p_key;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_value) <> 'string' then
    raise exception '% has to be text', p_label using errcode = '22023';
  end if;
  return nullif(btrim(v_value #>> '{}', E' \t\r\n'), '');
end;
$$;

create or replace function private.card_input_bool(
  p_input jsonb, p_key text, p_label text, p_default boolean default null
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_input -> p_key;
begin
  if v_value is null and p_default is not null then
    return p_default;
  end if;
  if jsonb_typeof(v_value) is distinct from 'boolean' then
    raise exception '% has to be on or off', p_label using errcode = '22023';
  end if;
  return (v_value #>> '{}')::boolean;
end;
$$;

-- Trims each tag and drops blanks, then enforces the limits.
create or replace function private.card_input_tags(
  p_input jsonb, p_key text, p_noun text, p_max_items integer, p_max_length integer
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_input -> p_key;
  v_item  jsonb;
  v_text  text;
  v_out   text[] := '{}';
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(v_value) <> 'array' then
    raise exception 'Send your %s as a list', p_noun using errcode = '22023';
  end if;

  for v_item in select e from jsonb_array_elements(v_value) e loop
    if jsonb_typeof(v_item) <> 'string' then
      raise exception 'Each % has to be text', p_noun using errcode = '22023';
    end if;
    v_text := btrim(v_item #>> '{}', E' \t\r\n');
    continue when v_text = '';
    if length(v_text) > p_max_length then
      raise exception 'Keep each % to % characters or fewer', p_noun, p_max_length
        using errcode = '22023';
    end if;
    v_out := v_out || v_text;
  end loop;

  if cardinality(v_out) > p_max_items then
    raise exception 'You can list up to % %s', p_max_items, p_noun using errcode = '22023';
  end if;

  return v_out;
end;
$$;

create or replace function private.card_require_length(p_value text, p_max integer, p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is not null and length(p_value) > p_max then
    raise exception 'Keep your % to % characters or fewer', p_label, p_max using errcode = '22023';
  end if;
  return p_value;
end;
$$;


-- Creates or updates the caller's card and replaces its links, in one
-- transaction. Everything is validated with a message a member can act on
-- before anything is written; the CHECK constraints are the backstop, not the
-- first line.
--
-- p_card must carry exactly the MemberCardInput keys. Unknown keys are refused
-- rather than ignored -- otherwise a client could probe for columns like
-- created_by or hidden_at and find out which ones silently do nothing.
--
-- Handles: a new handle is claimed into card_handles (capped at five per
-- member, ever) and the old one stays the member's, redirecting. Switching back
-- to a handle they held before is free. A unique_violation from a concurrent
-- claim is reported as "taken", which is what it is.
--
-- Links are upserted by id, so a link that survives an edit keeps its click
-- history. Ids must be the caller's own links: an id from someone else's card
-- is refused, not adopted.

create or replace function public.save_my_card(p_card jsonb, p_links jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member      uuid := private.require_card_member();
  v_enabled     boolean := private.cards_enabled();
  v_keys        constant text[] := array[
    'handle', 'display_name', 'pronouns', 'headline', 'organization', 'status_line', 'bio',
    'location', 'skills', 'languages', 'avatar_path', 'banner_path', 'background_path',
    'show_major', 'show_graduation_year', 'show_member_since', 'show_national_member',
    'show_chapter_position', 'theme', 'sections', 'allow_indexing'
  ];
  v_link_keys   constant text[] := array['id', 'kind', 'label', 'value', 'is_featured', 'is_visible'];
  v_key         text;
  v_existing    public.member_cards;
  v_handle      text;
  v_owner       uuid;
  v_held        integer;

  v_display     text;
  v_pronouns    text;
  v_headline    text;
  v_org         text;
  v_status_line text;
  v_bio         text;
  v_location    text;
  v_skills      text[];
  v_languages   text[];
  v_avatar      text;
  v_banner      text;
  v_background  text;
  v_theme       jsonb;
  v_sections    jsonb;

  v_link        jsonb;
  v_index       integer;
  v_link_id     uuid;
  v_link_ids    uuid[] := '{}';
  v_kind        text;
  v_label       text;
  v_value       text;
  v_featured    boolean;
  v_visible     boolean;
  v_featured_n  integer := 0;
  v_clean       jsonb := '[]'::jsonb;
begin
  if not v_enabled and not private.is_officer(v_member) then
    raise exception 'Business cards aren''t open yet' using errcode = '22023';
  end if;

  -- Serialises a member's own concurrent saves, so the five-handle cap and the
  -- link upsert see a consistent picture.
  perform pg_advisory_xact_lock(hashtextextended('member_card:' || v_member::text, 0));

  -- ── The card ──

  if p_card is null or jsonb_typeof(p_card) <> 'object' then
    raise exception 'Send the card as an object' using errcode = '22023';
  end if;

  select k into v_key from jsonb_object_keys(p_card) k where k <> all (v_keys) limit 1;
  if v_key is not null then
    raise exception 'Unknown card field: %', v_key using errcode = '22023';
  end if;

  select k into v_key from unnest(v_keys) k where not (p_card ? k) limit 1;
  if v_key is not null then
    raise exception 'The card is missing %', v_key using errcode = '22023';
  end if;

  v_display := private.card_input_text(p_card, 'display_name', 'Your name');
  if v_display is null then
    raise exception 'Enter the name to show on your card' using errcode = '22023';
  end if;
  v_display     := private.card_require_length(v_display, 80, 'name');
  v_pronouns    := private.card_require_length(private.card_input_text(p_card, 'pronouns', 'Pronouns'), 30, 'pronouns');
  v_headline    := private.card_require_length(private.card_input_text(p_card, 'headline', 'Your headline'), 100, 'headline');
  v_org         := private.card_require_length(private.card_input_text(p_card, 'organization', 'Your organization'), 100, 'organization');
  v_status_line := private.card_require_length(private.card_input_text(p_card, 'status_line', 'Your status'), 120, 'status');
  v_bio         := private.card_require_length(private.card_input_text(p_card, 'bio', 'Your bio'), 600, 'bio');
  v_location    := private.card_require_length(private.card_input_text(p_card, 'location', 'Your location'), 80, 'location');

  v_skills    := private.card_input_tags(p_card, 'skills', 'skill', 15, 30);
  v_languages := private.card_input_tags(p_card, 'languages', 'language', 8, 30);

  if (select count(distinct lower(s)) from unnest(v_skills) s) <> cardinality(v_skills) then
    raise exception 'Each skill can only be listed once' using errcode = '22023';
  end if;

  v_avatar     := private.card_input_text(p_card, 'avatar_path', 'The photo');
  v_banner     := private.card_input_text(p_card, 'banner_path', 'The banner');
  v_background := private.card_input_text(p_card, 'background_path', 'The background image');
  if not private.card_media_path_ok(v_member, v_avatar)
     or not private.card_media_path_ok(v_member, v_banner)
     or not private.card_media_path_ok(v_member, v_background) then
    raise exception 'That image didn''t upload correctly. Try again.' using errcode = '22023';
  end if;

  v_theme := p_card -> 'theme';
  if not private.card_theme_is_valid(v_theme) then
    raise exception 'That card design isn''t valid. Pick a preset and try again.' using errcode = '22023';
  end if;

  v_sections := p_card -> 'sections';
  if not private.card_sections_are_valid(v_sections) then
    raise exception 'That block order isn''t valid. Each block can appear once.' using errcode = '22023';
  end if;

  -- Booleans are read here so a bad one fails before anything is written.
  perform private.card_input_bool(p_card, 'show_major', 'Show major');
  perform private.card_input_bool(p_card, 'show_graduation_year', 'Show class year');
  perform private.card_input_bool(p_card, 'show_member_since', 'Show member since');
  perform private.card_input_bool(p_card, 'show_national_member', 'Show National membership');
  perform private.card_input_bool(p_card, 'show_chapter_position', 'Show chapter position');
  perform private.card_input_bool(p_card, 'allow_indexing', 'Search engine visibility');

  -- ── The links ──

  if p_links is null or jsonb_typeof(p_links) <> 'array' then
    raise exception 'Send the links as a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_links) > 20 then
    raise exception 'A card can have up to 20 links' using errcode = '22023';
  end if;

  for v_link, v_index in
    select e, (o - 1)::integer from jsonb_array_elements(p_links) with ordinality as t (e, o)
  loop
    if jsonb_typeof(v_link) <> 'object' then
      raise exception 'Each link has to be an object' using errcode = '22023';
    end if;

    select k into v_key from jsonb_object_keys(v_link) k where k <> all (v_link_keys) limit 1;
    if v_key is not null then
      raise exception 'Unknown link field: %', v_key using errcode = '22023';
    end if;

    v_kind := case when jsonb_typeof(v_link -> 'kind') = 'string' then v_link ->> 'kind' end;
    if not private.card_link_kind_ok(v_kind) then
      raise exception 'Unknown link type' using errcode = '22023';
    end if;

    v_value := private.card_input_text(v_link, 'value', 'A link');
    if v_value is null then
      raise exception 'Add the link or remove that row' using errcode = '22023';
    end if;
    if length(v_value) > 500 then
      raise exception 'That link is too long' using errcode = '22023';
    end if;
    if not private.card_link_value_ok(v_kind, v_value) then
      raise exception '%',
        case v_kind
          when 'email' then 'Enter a valid email address'
          when 'phone' then 'Enter a phone number, like +1 314 555 0123'
          else 'Links have to be full addresses starting with https://'
        end
        using errcode = '22023';
    end if;

    v_label := private.card_input_text(v_link, 'label', 'A link label');
    if v_label is not null and length(v_label) > 40 then
      raise exception 'Keep link labels to 40 characters or fewer' using errcode = '22023';
    end if;

    v_featured := private.card_input_bool(v_link, 'is_featured', 'Featured', false);
    v_visible  := private.card_input_bool(v_link, 'is_visible', 'Visible', true);
    if v_featured then
      v_featured_n := v_featured_n + 1;
    end if;

    v_link_id := null;
    if v_link ? 'id' and jsonb_typeof(v_link -> 'id') <> 'null' then
      begin
        v_link_id := (v_link ->> 'id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'That link isn''t on your card' using errcode = '22023';
      end;
      if v_link_id = any (v_link_ids) then
        raise exception 'The same link is listed twice' using errcode = '22023';
      end if;
      if not exists (select 1 from public.member_card_links l
                      where l.id = v_link_id and l.member_id = v_member) then
        raise exception 'That link isn''t on your card' using errcode = '22023';
      end if;
      v_link_ids := v_link_ids || v_link_id;
    end if;

    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'id',          v_link_id,
      'kind',        v_kind,
      'label',       v_label,
      'value',       v_value,
      'sort_order',  v_index,
      'is_featured', v_featured,
      'is_visible',  v_visible
    ));
  end loop;

  if v_featured_n > 1 then
    raise exception 'Only one link can be featured' using errcode = '22023';
  end if;

  -- ── The handle ──

  select * into v_existing from public.member_cards c where c.member_id = v_member for update;

  v_handle := lower(private.card_input_text(p_card, 'handle', 'The handle'));
  if not private.card_handle_shape_ok(v_handle) then
    raise exception 'Handles are 3 to 30 letters, numbers and single hyphens, starting and ending with a letter or number'
      using errcode = '22023';
  end if;

  if v_existing.handle is distinct from v_handle then
    -- Before anything else, so a member whose editor was open when an officer
    -- released their handle gets told so on their next save, instead of
    -- silently claiming it back.
    if exists (select 1 from public.card_handle_blocks b
                where b.handle = v_handle and b.member_id = v_member) then
      raise exception 'An officer removed that handle from your card. Pick a different one.'
        using errcode = '22023';
    end if;

    if exists (select 1 from public.reserved_card_handles r where r.handle = v_handle) then
      raise exception 'That handle is reserved' using errcode = '22023';
    end if;

    select h.member_id into v_owner from public.card_handles h where h.handle = v_handle;

    if v_owner is not null and v_owner <> v_member then
      raise exception 'That handle is taken' using errcode = '22023';
    end if;

    if v_owner is null then
      select count(*)::integer into v_held from public.card_handles h where h.member_id = v_member;
      if v_held >= 5 then
        raise exception 'You''ve used 5 handles, which is the most a card can have. Pick one you''ve used before.'
          using errcode = '22023';
      end if;

      begin
        insert into public.card_handles (handle, member_id) values (v_handle, v_member);
      exception
        when unique_violation then
          raise exception 'That handle is taken' using errcode = '22023';
      end;
    end if;
  end if;

  -- ── Write ──

  insert into public.member_cards as c (
    member_id, handle, created_by, member_opened_at,
    display_name, pronouns, headline, organization, status_line, bio, location,
    skills, languages, avatar_path, banner_path, background_path,
    show_major, show_graduation_year, show_member_since, show_national_member,
    show_chapter_position, theme, sections, allow_indexing
  ) values (
    v_member, v_handle, v_member, now(),
    v_display, v_pronouns, v_headline, v_org, v_status_line, v_bio, v_location,
    v_skills, v_languages, v_avatar, v_banner, v_background,
    private.card_input_bool(p_card, 'show_major', 'Show major'),
    private.card_input_bool(p_card, 'show_graduation_year', 'Show class year'),
    private.card_input_bool(p_card, 'show_member_since', 'Show member since'),
    private.card_input_bool(p_card, 'show_national_member', 'Show National membership'),
    private.card_input_bool(p_card, 'show_chapter_position', 'Show chapter position'),
    v_theme, v_sections,
    private.card_input_bool(p_card, 'allow_indexing', 'Search engine visibility')
  )
  on conflict (member_id) do update set
    handle                = excluded.handle,
    display_name          = excluded.display_name,
    pronouns              = excluded.pronouns,
    headline              = excluded.headline,
    organization          = excluded.organization,
    status_line           = excluded.status_line,
    bio                   = excluded.bio,
    location              = excluded.location,
    skills                = excluded.skills,
    languages             = excluded.languages,
    avatar_path           = excluded.avatar_path,
    banner_path           = excluded.banner_path,
    background_path       = excluded.background_path,
    show_major            = excluded.show_major,
    show_graduation_year  = excluded.show_graduation_year,
    show_member_since     = excluded.show_member_since,
    show_national_member  = excluded.show_national_member,
    show_chapter_position = excluded.show_chapter_position,
    theme                 = excluded.theme,
    sections              = excluded.sections,
    allow_indexing        = excluded.allow_indexing,
    -- The first save by the member is what turns an officer-made starter card
    -- into theirs.
    member_opened_at      = coalesce(c.member_opened_at, now()),
    updated_at            = now();

  -- Links: drop the ones left out, clear the featured flag so moving it from
  -- one link to another cannot trip the one-featured index mid-statement, then
  -- upsert in order.
  delete from public.member_card_links l
   where l.member_id = v_member
     and not (l.id = any (v_link_ids));

  update public.member_card_links l
     set is_featured = false
   where l.member_id = v_member
     and l.is_featured;

  for v_link in select e from jsonb_array_elements(v_clean) e loop
    if jsonb_typeof(v_link -> 'id') = 'string' then
      update public.member_card_links l
         set kind        = v_link ->> 'kind',
             label       = v_link ->> 'label',
             value       = v_link ->> 'value',
             sort_order  = (v_link ->> 'sort_order')::integer,
             is_featured = (v_link ->> 'is_featured')::boolean,
             is_visible  = (v_link ->> 'is_visible')::boolean
       where l.id = (v_link ->> 'id')::uuid
         and l.member_id = v_member;
    else
      insert into public.member_card_links
        (member_id, kind, label, value, sort_order, is_featured, is_visible)
      values (
        v_member,
        v_link ->> 'kind',
        v_link ->> 'label',
        v_link ->> 'value',
        (v_link ->> 'sort_order')::integer,
        (v_link ->> 'is_featured')::boolean,
        (v_link ->> 'is_visible')::boolean
      );
    end if;
  end loop;

  return private.my_card_state(v_member, v_enabled);
end;
$$;

revoke execute on function public.save_my_card(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_my_card(jsonb, jsonb) to authenticated;


-- Publishing counts as opening: a member who publishes an officer-made card
-- as-is has made a decision about it, so the starter rule stops applying.
create or replace function public.set_my_card_published(p_published boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member  uuid := private.require_card_member();
  v_enabled boolean := private.cards_enabled();
begin
  if p_published is null then
    raise exception 'Say whether your card should be published' using errcode = '22023';
  end if;

  if not v_enabled and not private.is_officer(v_member) then
    raise exception 'Business cards aren''t open yet' using errcode = '22023';
  end if;

  update public.member_cards c
     set is_published     = p_published,
         member_opened_at = coalesce(c.member_opened_at, now()),
         updated_at       = now()
   where c.member_id = v_member;

  if not found then
    raise exception 'Save your card first' using errcode = '22023';
  end if;

  return private.my_card_state(v_member, v_enabled);
end;
$$;

revoke execute on function public.set_my_card_published(boolean) from public, anon, authenticated;
grant execute on function public.set_my_card_published(boolean) to authenticated;


-- ── My Card: insights ───────────────────────────────────────────────────────
--
-- The last p_days chapter-local days, today included, zero-filled so the chart
-- does not have to invent missing days. Every current link appears, zero clicks
-- included, in the order they show on the card. Only ever the caller's own.

create or replace function public.get_my_card_insights(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := private.require_card_member();
  v_today  date := (now() at time zone 'America/Chicago')::date;
  v_start  date;
  v_totals jsonb;
  v_daily  jsonb;
  v_links  jsonb;
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Choose between 1 and 365 days' using errcode = '22023';
  end if;

  v_start := v_today - (p_days - 1);

  select jsonb_build_object(
           'views',  coalesce(sum(s.views), 0)::integer,
           'saves',  coalesce(sum(s.saves), 0)::integer,
           'shares', coalesce(sum(s.shares), 0)::integer,
           'nfc',    coalesce(sum(s.views) filter (where s.source = 'nfc'), 0)::integer,
           'qr',     coalesce(sum(s.views) filter (where s.source = 'qr'), 0)::integer,
           'link',   coalesce(sum(s.views) filter (where s.source = 'link'), 0)::integer
         )
    into v_totals
    from public.card_daily_stats s
   where s.member_id = v_member
     and s.day between v_start and v_today;

  select jsonb_agg(jsonb_build_object(
           'day',    to_char(d.day, 'YYYY-MM-DD'),
           'views',  coalesce(x.views, 0),
           'saves',  coalesce(x.saves, 0),
           'shares', coalesce(x.shares, 0)
         ) order by d.day)
    into v_daily
    from (select g::date as day
            from generate_series(v_start::timestamp, v_today::timestamp, interval '1 day') g) d
    left join (
      select s.day,
             sum(s.views)::integer  as views,
             sum(s.saves)::integer  as saves,
             sum(s.shares)::integer as shares
        from public.card_daily_stats s
       where s.member_id = v_member
         and s.day between v_start and v_today
       group by s.day
    ) x on x.day = d.day;

  select coalesce(jsonb_agg(jsonb_build_object(
           'link_id', l.id,
           'kind',    l.kind,
           'label',   l.label,
           'clicks',  coalesce((
                        select sum(k.clicks)::integer
                          from public.card_link_daily_clicks k
                         where k.link_id = l.id
                           and k.day between v_start and v_today), 0)
         ) order by l.sort_order, l.id), '[]'::jsonb)
    into v_links
    from public.member_card_links l
   where l.member_id = v_member;

  return jsonb_build_object(
    'days',   p_days,
    'totals', v_totals,
    'daily',  coalesce(v_daily, '[]'::jsonb),
    'links',  v_links
  );
end;
$$;

revoke execute on function public.get_my_card_insights(integer) from public, anon, authenticated;
grant execute on function public.get_my_card_insights(integer) to authenticated;


-- ── Officer tools ───────────────────────────────────────────────────────────
--
-- Every one calls require_officer() as its first statement, before any work,
-- and every one that changes something writes an audit row. Officer rather than
-- admin, like the leaderboard switch: these are the day-to-day calls of the
-- people running card-writing night.
--
-- What officers can NOT do is as deliberate as what they can: no function here
-- writes a card's text, links, contact details or images. After creating a
-- card, an officer's only powers over it are hide, handle release (and reset,
-- which is releasing the current one) and recording that a chip was written.
--
-- Audit rows about a card carry the member's display name and current handle
-- (private.card_audit_subject), so the log says whose card it was without
-- anyone having to look the id up -- and still says so after the member is
-- gone.

create or replace function private.card_audit_subject(p_member uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'display_name', coalesce(
                      (select c.display_name from public.member_cards c where c.member_id = p_member),
                      (select nullif(btrim(concat_ws(' ', nullif(btrim(p.first_name), ''),
                                                          nullif(btrim(p.last_name), ''))), '')
                         from public.profiles p where p.id = p_member)),
    'handle',       (select c.handle from public.member_cards c where c.member_id = p_member)
  );
$$;

-- Every member who is not pending, with or without a card, so the table can
-- show who still needs one.
create or replace function public.admin_list_cards()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_officer();
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_rows  jsonb;
begin
  with views as (
    select s.member_id, sum(s.views)::integer as views
      from public.card_daily_stats s
     where s.day > v_today - 30
     group by s.member_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id',          p.id,
           'first_name',         p.first_name,
           'last_name',          p.last_name,
           'email',              p.email,
           'membership_status',  p.membership_status,
           'handle',             c.handle,
           'status',             case
                                   when c.member_id is null       then 'none'
                                   when c.hidden_at is not null   then 'hidden'
                                   when c.is_published            then 'published'
                                   when c.officer_created and c.member_opened_at is null
                                                                  then 'officer_unopened'
                                   else 'member'
                                 end,
           'is_published',       coalesce(c.is_published, false),
           'hidden_at',          c.hidden_at,
           'hidden_reason',      c.hidden_reason,
           'created_by_officer', coalesce(c.officer_created, false),
           'member_opened_at',   c.member_opened_at,
           'chip_handle',        c.chip_handle,
           'chip_handle_active', private.card_chip_handle_active(c),
           'chip_written_at',    c.chip_written_at,
           -- Every handle the member holds besides the current one, oldest
           -- first. Each still redirects to the card, so an officer needs to
           -- see them to release one that impersonates someone.
           'old_handles',        case
                                   when c.member_id is null then '[]'::jsonb
                                   else coalesce((
                                     select jsonb_agg(h.handle order by h.claimed_at, h.handle)
                                       from public.card_handles h
                                      where h.member_id = c.member_id
                                        and h.handle <> c.handle), '[]'::jsonb)
                                 end,
           'position',           cp.title,
           'views_30d',          coalesce(v.views, 0),
           'updated_at',         c.updated_at
         ) order by p.last_name, p.first_name, p.id), '[]'::jsonb)
    into v_rows
    from public.profiles p
    left join public.member_cards c       on c.member_id = p.id
    left join public.chapter_positions cp on cp.member_id = p.id
    left join views v                     on v.member_id = p.id
   where p.membership_status <> 'pending';

  return jsonb_build_object('enabled', private.cards_enabled(), 'rows', v_rows);
end;
$$;

revoke execute on function public.admin_list_cards() from public, anon, authenticated;
grant execute on function public.admin_list_cards() to authenticated;


create or replace function public.admin_suggest_card_handle(p_member_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.require_officer();
  v_handle text;
begin
  if not exists (select 1 from public.profiles p where p.id = p_member_id) then
    raise exception 'We couldn''t find that member' using errcode = '22023';
  end if;

  select c.handle into v_handle from public.member_cards c where c.member_id = p_member_id;
  return coalesce(v_handle, private.suggest_card_handle(p_member_id));
end;
$$;

revoke execute on function public.admin_suggest_card_handle(uuid) from public, anon, authenticated;
grant execute on function public.admin_suggest_card_handle(uuid) to authenticated;


-- The one place an officer-made card is written, shared by the single and bulk
-- paths. Name and school only -- organization and everything else take the
-- column defaults. member_opened_at stays null so the starter rule applies,
-- unless the officer is making their own card, which is just the member making
-- it. A unique_violation propagates so the bulk path can move on to the next
-- candidate handle. officer_created is set here and nowhere else.
create or replace function private.insert_officer_card(
  p_member  uuid,
  p_handle  text,
  p_actor   uuid,
  p_publish boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select btrim(left(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')), 80))
    into v_name
    from public.profiles p
   where p.id = p_member;

  -- An officer cannot hand a member back a handle an officer released from
  -- them, any more than the member can take it back themselves.
  if exists (select 1 from public.card_handle_blocks b
              where b.handle = p_handle and b.member_id = p_member) then
    raise exception 'That handle was removed from this member''s card' using errcode = '22023';
  end if;

  -- A handle this member already holds (from an earlier card) is theirs to
  -- reuse; anyone else's raises unique_violation.
  insert into public.card_handles (handle, member_id)
  values (p_handle, p_member)
  on conflict (handle) do nothing;

  if not exists (select 1 from public.card_handles h
                  where h.handle = p_handle and h.member_id = p_member) then
    raise exception 'That handle is taken' using errcode = 'unique_violation';
  end if;

  insert into public.member_cards
    (member_id, handle, display_name, created_by, officer_created, member_opened_at, is_published)
  values
    (p_member, p_handle, v_name, p_actor,
     p_actor is distinct from p_member,
     case when p_actor = p_member then now() end,
     coalesce(p_publish, false));
end;
$$;


create or replace function public.admin_create_card(
  p_member_id uuid,
  p_handle    text default null,
  p_publish   boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.require_officer();
  v_profile public.profiles;
  v_publish boolean := coalesce(p_publish, false);
  v_handle  text := lower(nullif(btrim(p_handle), ''));
  v_owner   uuid;
begin
  select * into v_profile from public.profiles p where p.id = p_member_id;
  if not found then
    raise exception 'We couldn''t find that member' using errcode = '22023';
  end if;

  if v_profile.membership_status = 'pending' then
    raise exception 'That member hasn''t been approved yet' using errcode = '22023';
  end if;

  if exists (select 1 from public.member_cards c where c.member_id = p_member_id) then
    raise exception 'That member already has a card' using errcode = '22023';
  end if;

  -- Only a truly blank name. A name the fold cannot read (written in another
  -- script, say) still gets a card, with a member-xxxxxx handle.
  if private.card_name_is_blank(v_profile.first_name, v_profile.last_name) then
    raise exception 'Add a name to their profile first' using errcode = '22023';
  end if;

  if v_handle is not null then
    if not private.card_handle_shape_ok(v_handle) then
      raise exception 'Handles are 3 to 30 letters, numbers and single hyphens, starting and ending with a letter or number'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.reserved_card_handles r where r.handle = v_handle) then
      raise exception 'That handle is reserved' using errcode = '22023';
    end if;
    select h.member_id into v_owner from public.card_handles h where h.handle = v_handle;
    if v_owner is not null and v_owner <> p_member_id then
      raise exception 'That handle is taken' using errcode = '22023';
    end if;
  else
    -- Never null here: the name is not blank, so the worst case is the
    -- member-xxxxxx fallback, and that is null only if a hundred of those
    -- are taken.
    v_handle := private.suggest_card_handle(p_member_id);
    if v_handle is null then
      raise exception 'We couldn''t find a free handle for them. Type one in.' using errcode = '22023';
    end if;
  end if;

  begin
    perform private.insert_officer_card(p_member_id, v_handle, v_actor, v_publish);
  exception
    when unique_violation then
      if exists (select 1 from public.member_cards c where c.member_id = p_member_id) then
        raise exception 'That member already has a card' using errcode = '22023';
      end if;
      raise exception 'That handle is taken' using errcode = '22023';
  end;

  perform public.write_audit_log(
    v_actor, 'card.created', 'member', p_member_id,
    private.card_audit_subject(p_member_id)
      || jsonb_build_object('handle', v_handle, 'published', v_publish)
  );

  return jsonb_build_object(
    'ok',           true,
    'member_id',    p_member_id,
    'handle',       v_handle,
    'is_published', v_publish
  );
end;
$$;

revoke execute on function public.admin_create_card(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_create_card(uuid, text, boolean) to authenticated;


-- Card-writing night: a card for every active member who lacks one.
--
-- Dry run is the default, and writes nothing -- it is the preview the officer
-- confirms. Handles already proposed in this run are excluded from later
-- suggestions, so two members with the same name get distinct handles in the
-- preview as well as for real.
--
-- If a handle is claimed between the suggestion and the insert (another
-- officer running the same thing, a member saving mid-run), the unique key on
-- card_handles settles it and that member moves on to their next candidate
-- instead of failing the batch. Each attempt runs in its own subtransaction,
-- so a failed one leaves nothing behind.
--
-- Members with a blank name are skipped and listed rather than given a
-- meaningless handle. Everyone else gets a card -- a name the fold cannot read
-- gets a member-xxxxxx handle -- so no eligible member is ever left out of
-- both lists. If a member's handles keep being taken from under the run, the
-- whole batch stops with an error rather than quietly leaving them out. One
-- audit row for the batch, not one per member.

create or replace function public.admin_create_missing_cards(
  p_publish boolean default false,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := public.require_officer();
  v_publish   boolean := coalesce(p_publish, false);
  v_dry_run   boolean := coalesce(p_dry_run, true);
  v_member    record;
  v_name      text;
  v_proposed  text[] := '{}';
  v_candidate text;
  v_handle    text;
  v_attempt   integer;
  v_created   jsonb := '[]'::jsonb;
  v_skipped   jsonb := '[]'::jsonb;
  v_count     integer := 0;
begin
  for v_member in
    select p.id, p.first_name, p.last_name, p.email
      from public.profiles p
     where p.membership_status = 'active'
       and not exists (select 1 from public.member_cards c where c.member_id = p.id)
     order by p.last_name, p.first_name, p.id
  loop
    if private.card_name_is_blank(v_member.first_name, v_member.last_name) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'member_id', v_member.id,
        'name',      '',
        'email',     v_member.email,
        'reason',    'no_name'
      ));
      continue;
    end if;

    v_name := concat_ws(' ', nullif(btrim(v_member.first_name), ''), nullif(btrim(v_member.last_name), ''));

    v_handle  := null;
    v_attempt := 0;

    loop
      v_attempt   := v_attempt + 1;
      v_candidate := private.suggest_card_handle(v_member.id, v_proposed);

      -- The name is not blank, so a null here means every candidate,
      -- fallbacks included, is gone -- or the retries below ran out.
      if v_candidate is null or v_attempt > 10 then
        raise exception 'Handles kept being taken while this ran, so nothing was created. Run it again.'
          using errcode = '22023';
      end if;

      if v_dry_run then
        v_handle := v_candidate;
        exit;
      end if;

      begin
        perform private.insert_officer_card(v_member.id, v_candidate, v_actor, v_publish);
        v_handle := v_candidate;
        exit;
      exception
        when unique_violation then
          -- They got a card some other way while this ran: nothing to do.
          exit when exists (select 1 from public.member_cards c where c.member_id = v_member.id);
          v_proposed := v_proposed || v_candidate;
      end;
    end loop;

    if v_handle is not null then
      v_proposed := v_proposed || v_handle;
      v_count    := v_count + 1;
      v_created  := v_created || jsonb_build_array(jsonb_build_object(
        'member_id', v_member.id,
        'name',      v_name,
        'handle',    v_handle
      ));
    end if;
  end loop;

  if not v_dry_run and v_count > 0 then
    perform public.write_audit_log(
      v_actor, 'card.bulk_created', 'system', null,
      jsonb_build_object('count', v_count, 'published', v_publish)
    );
  end if;

  return jsonb_build_object(
    'dry_run',   v_dry_run,
    'published', v_publish,
    'created',   v_created,
    'skipped',   v_skipped
  );
end;
$$;

revoke execute on function public.admin_create_missing_cards(boolean, boolean) from public, anon, authenticated;
grant execute on function public.admin_create_missing_cards(boolean, boolean) to authenticated;


-- Records which handle each chip carries, so the admin list shows who still
-- needs one and the member's editor can warn them before renaming away from it.
--
-- p_handles, when given, is the handle the officer actually wrote to each
-- chip, pairwise with p_member_ids -- the one on the exported sheet and in the
-- confirm dialog. Recording the card's handle as of now instead would be wrong
-- whenever the member renamed between the export and the click: the chip
-- carries the old handle, and the record would name one that is not on it.
-- A given handle is recorded only if the member holds it (current or old);
-- otherwise that member is left untouched and listed in `skipped`, as is
-- anyone without a card. Without p_handles, each card's current handle is
-- recorded.
create or replace function public.admin_mark_chips_written(
  p_member_ids uuid[],
  p_handles    text[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.require_officer();
  v_updated uuid[];
  v_skipped uuid[];
begin
  if p_member_ids is null or cardinality(p_member_ids) = 0 then
    raise exception 'Choose at least one member' using errcode = '22023';
  end if;

  if p_handles is not null and cardinality(p_handles) <> cardinality(p_member_ids) then
    raise exception 'Send one handle for each member' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(p_member_ids) m where m is null)
     or (select count(distinct m) from unnest(p_member_ids) m) <> cardinality(p_member_ids) then
    raise exception 'List each member once' using errcode = '22023';
  end if;

  with wanted as (
    select x.member_id, lower(btrim(x.handle)) as handle
      from unnest(p_member_ids,
                  coalesce(p_handles, array_fill(null::text, array[cardinality(p_member_ids)])))
           as x (member_id, handle)
  ),
  updated as (
    update public.member_cards c
       set chip_handle     = case when p_handles is null then c.handle else w.handle end,
           chip_written_at = now()
      from wanted w
     where c.member_id = w.member_id
       and (p_handles is null
            or exists (select 1 from public.card_handles h
                        where h.handle = w.handle and h.member_id = c.member_id))
    returning c.member_id
  )
  select coalesce(array_agg(u.member_id order by u.member_id), '{}') into v_updated from updated u;

  select coalesce(array_agg(m order by o), '{}') into v_skipped
    from unnest(p_member_ids) with ordinality as t (m, o)
   where not (m = any (v_updated));

  if cardinality(v_updated) > 0 then
    perform public.write_audit_log(
      v_actor, 'card.chips_written', 'system', null,
      jsonb_build_object(
        'count',         cardinality(v_updated),
        'skipped_count', cardinality(v_skipped),
        'member_ids',    to_jsonb(v_updated))
    );
  end if;

  return jsonb_build_object(
    'ok',      true,
    'count',   cardinality(v_updated),
    'skipped', to_jsonb(v_skipped)
  );
end;
$$;

revoke execute on function public.admin_mark_chips_written(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.admin_mark_chips_written(uuid[], text[]) to authenticated;


-- Moderation. A hidden card resolves as not_found, like any other card that
-- should not be seen. The member sees the reason in their editor, so it has to
-- be one -- and it goes to the audit log.
create or replace function public.admin_set_card_hidden(
  p_member_id uuid,
  p_hidden    boolean,
  p_reason    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.require_officer();
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_hidden is null then
    raise exception 'Say whether the card should be hidden' using errcode = '22023';
  end if;

  if not exists (select 1 from public.member_cards c where c.member_id = p_member_id) then
    raise exception 'That member doesn''t have a card' using errcode = '22023';
  end if;

  if p_hidden then
    if v_reason is null or length(v_reason) < 3 or length(v_reason) > 300 then
      raise exception 'Say why you''re hiding this card (3 to 300 characters)' using errcode = '22023';
    end if;

    update public.member_cards c
       set hidden_at     = coalesce(c.hidden_at, now()),
           hidden_reason = v_reason,
           updated_at    = now()
     where c.member_id = p_member_id;
  else
    v_reason := null;
    update public.member_cards c
       set hidden_at     = null,
           hidden_reason = null,
           updated_at    = now()
     where c.member_id = p_member_id;
  end if;

  perform public.write_audit_log(
    v_actor,
    case when p_hidden then 'card.hidden' else 'card.unhidden' end,
    'member', p_member_id,
    private.card_audit_subject(p_member_id) || jsonb_build_object('reason', v_reason)
  );

  return jsonb_build_object('ok', true, 'hidden', p_hidden);
end;
$$;

revoke execute on function public.admin_set_card_hidden(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_card_hidden(uuid, boolean, text) to authenticated;


-- For an impersonating or offensive handle. Releasing a handle DELETES it
-- rather than keeping it as history: the point is that it stops resolving to
-- the member, and becomes free for the person it actually belongs to. It does
-- not redirect. It works on any handle the member holds -- an old one keeps
-- redirecting to them forever otherwise, so a member could squat on someone
-- else's name just by renaming away from it.
--
-- Two things make the release stick:
--   * a card_handle_blocks row, so the member cannot claim it back -- not on
--     purpose, and not by saving from an editor that was open at the time;
--   * if it was the card's current handle, the card first moves to the
--     member's next suggestion (never a handle released from them, never one
--     anyone holds), or member-xxxxxx when their name gives nothing to use.
--
-- p_handle null means the card's current handle, read under the lock, so a
-- reset cannot race a rename and release the wrong one. Shared by
-- admin_release_card_handle() and admin_reset_card_handle(); the callers check
-- the officer, the reason and the audit row. Returns ReleaseCardHandleResult.
create or replace function private.release_card_handle(
  p_member uuid,
  p_handle text,
  p_reason text,
  p_actor  uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_handle  text;
  v_new     text;
  v_exclude text[];
  v_attempt integer := 0;
begin
  -- The same lock save_my_card() takes, then the card row: a save in flight
  -- either finishes first or sees the release, never half of it.
  perform pg_advisory_xact_lock(hashtextextended('member_card:' || p_member::text, 0));
  select c.handle into v_current from public.member_cards c where c.member_id = p_member for update;

  v_handle := coalesce(lower(btrim(p_handle)), v_current);

  if v_handle is null or not exists (
       select 1 from public.card_handles h where h.handle = v_handle and h.member_id = p_member) then
    raise exception 'That handle isn''t one of this member''s handles' using errcode = '22023';
  end if;

  if v_handle = v_current then
    v_exclude := array[v_handle];

    loop
      v_attempt := v_attempt + 1;
      v_new := coalesce(private.suggest_card_handle(p_member, v_exclude),
                        -- Blank name: a neutral handle, never anything from the email.
                        private.card_fallback_handle(p_member, v_exclude));
      if v_new is null or v_attempt > 10 then
        raise exception 'Couldn''t find a free handle. Try again.' using errcode = '22023';
      end if;

      begin
        insert into public.card_handles (handle, member_id) values (v_new, p_member);
        exit;
      exception
        when unique_violation then
          v_exclude := v_exclude || v_new;
      end;
    end loop;

    update public.member_cards c
       set handle     = v_new,
           updated_at = now()
     where c.member_id = p_member;
  end if;

  delete from public.card_handles h where h.handle = v_handle and h.member_id = p_member;

  insert into public.card_handle_blocks (handle, member_id, reason, blocked_by)
  values (v_handle, p_member, p_reason, p_actor)
  on conflict (handle, member_id) do nothing;

  return jsonb_build_object(
    'ok',          true,
    'handle',      v_handle,
    'was_current', v_new is not null,
    'new_handle',  v_new
  );
end;
$$;


create or replace function public.admin_release_card_handle(
  p_member_id uuid,
  p_handle    text,
  p_reason    text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.require_officer();
  v_reason text := nullif(btrim(p_reason), '');
  v_handle  text := nullif(lower(btrim(p_handle)), '');
  v_result  jsonb;
  v_subject jsonb;
begin
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'Say why you''re releasing this handle (3 to 300 characters)' using errcode = '22023';
  end if;

  if v_handle is null then
    raise exception 'Choose the handle to release' using errcode = '22023';
  end if;

  v_result  := private.release_card_handle(p_member_id, v_handle, v_reason, v_actor);
  v_subject := private.card_audit_subject(p_member_id);

  perform public.write_audit_log(
    v_actor, 'card.handle_released', 'member', p_member_id,
    jsonb_build_object(
      'display_name',   v_subject -> 'display_name',
      'current_handle', v_subject -> 'handle',
      'handle',         v_result -> 'handle',
      'was_current',    v_result -> 'was_current',
      'new_handle',     v_result -> 'new_handle',
      'reason',         v_reason)
  );

  return v_result;
end;
$$;

revoke execute on function public.admin_release_card_handle(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_release_card_handle(uuid, text, text) to authenticated;


-- Releasing the card's current handle: the member moves to their next
-- suggested handle. Kept as its own function because it is the common case and
-- its result says which handle went and which replaced it.
create or replace function public.admin_reset_card_handle(p_member_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.require_officer();
  v_reason text := nullif(btrim(p_reason), '');
  v_result jsonb;
begin
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'Say why you''re resetting this handle (3 to 300 characters)' using errcode = '22023';
  end if;

  if not exists (select 1 from public.member_cards c where c.member_id = p_member_id) then
    raise exception 'That member doesn''t have a card' using errcode = '22023';
  end if;

  v_result := private.release_card_handle(p_member_id, null, v_reason, v_actor);

  perform public.write_audit_log(
    v_actor, 'card.handle_reset', 'member', p_member_id,
    private.card_audit_subject(p_member_id) || jsonb_build_object(
      'old_handle', v_result ->> 'handle',
      'new_handle', v_result ->> 'new_handle',
      'reason',     v_reason)
  );

  return jsonb_build_object('ok', true, 'old_handle', v_result ->> 'handle', 'handle', v_result ->> 'new_handle');
end;
$$;

revoke execute on function public.admin_reset_card_handle(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_reset_card_handle(uuid, text) to authenticated;


-- The verified position line. A blank title clears it.
create or replace function public.admin_set_chapter_position(p_member_id uuid, p_title text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.require_officer();
  v_title    text := nullif(btrim(p_title), '');
  v_previous text;
begin
  if not exists (select 1 from public.profiles p where p.id = p_member_id) then
    raise exception 'We couldn''t find that member' using errcode = '22023';
  end if;

  if v_title is null then
    delete from public.chapter_positions cp
     where cp.member_id = p_member_id
    returning cp.title into v_previous;

    if v_previous is not null then
      perform public.write_audit_log(
        v_actor, 'card.position_cleared', 'member', p_member_id,
        private.card_audit_subject(p_member_id) || jsonb_build_object('title', v_previous)
      );
    end if;

    return jsonb_build_object('ok', true, 'title', null);
  end if;

  if length(v_title) < 2 or length(v_title) > 60 then
    raise exception 'Positions are 2 to 60 characters, like "President"' using errcode = '22023';
  end if;

  insert into public.chapter_positions (member_id, title, granted_by, granted_at)
  values (p_member_id, v_title, v_actor, now())
  on conflict (member_id) do update
    set title      = excluded.title,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at;

  perform public.write_audit_log(
    v_actor, 'card.position_set', 'member', p_member_id,
    private.card_audit_subject(p_member_id) || jsonb_build_object('title', v_title)
  );

  return jsonb_build_object('ok', true, 'title', v_title);
end;
$$;

revoke execute on function public.admin_set_chapter_position(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_chapter_position(uuid, text) to authenticated;


-- A boolean-only setter, for the same reason as admin_set_leaderboard_enabled:
-- admin_set_app_setting() takes any jsonb, and this switch should only ever
-- hold true or false.
create or replace function public.admin_set_cards_enabled(p_enabled boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_officer();
begin
  if p_enabled is null then
    raise exception 'Say whether business cards should be on or off' using errcode = '22023';
  end if;

  insert into public.app_settings (key, value, updated_by)
  values ('cards_enabled', to_jsonb(p_enabled), v_actor)
  on conflict (key) do update
     set value      = excluded.value,
         updated_by = excluded.updated_by;

  perform public.write_audit_log(
    v_actor,
    case when p_enabled then 'cards.enabled' else 'cards.disabled' end,
    'setting', null,
    jsonb_build_object('key', 'cards_enabled')
  );

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

revoke execute on function public.admin_set_cards_enabled(boolean) from public, anon, authenticated;
grant execute on function public.admin_set_cards_enabled(boolean) to authenticated;


-- ── Private helpers: nobody calls these directly ────────────────────────────
--
-- Functions get EXECUTE for PUBLIC by default, and `private` has USAGE for
-- authenticated, so without these revokes a member could call
-- private.suggest_card_handle() on someone else's id, or insert_officer_card()
-- -- which is security definer -- and make a card for anyone. They are reached
-- only from the definer functions above, which run as the owner.

revoke execute on function private.cards_enabled()                                 from public, anon, authenticated;
revoke execute on function private.card_json_in(jsonb, text[])                     from public, anon, authenticated;
revoke execute on function private.card_json_hex(jsonb)                            from public, anon, authenticated;
revoke execute on function private.card_json_int_between(jsonb, integer, integer)  from public, anon, authenticated;
revoke execute on function private.card_json_keys_within(jsonb, text[])            from public, anon, authenticated;
revoke execute on function private.card_theme_is_valid(jsonb)                      from public, anon, authenticated;
revoke execute on function private.card_sections_are_valid(jsonb)                  from public, anon, authenticated;
revoke execute on function private.card_handle_shape_ok(text)                      from public, anon, authenticated;
revoke execute on function private.card_media_path_ok(uuid, text)                  from public, anon, authenticated;
revoke execute on function private.card_chip_handle_active(public.member_cards)     from public, anon, authenticated;
revoke execute on function private.card_link_value_ok(text, text)                  from public, anon, authenticated;
revoke execute on function private.card_link_kind_ok(text)                         from public, anon, authenticated;
revoke execute on function private.card_tags_ok(text[], integer, integer)          from public, anon, authenticated;
revoke execute on function private.require_card_member()                           from public, anon, authenticated;
revoke execute on function private.card_handle_fold(text)                          from public, anon, authenticated;
revoke execute on function private.card_handle_cut(text, integer)                  from public, anon, authenticated;
revoke execute on function private.card_handle_first_word(text)                    from public, anon, authenticated;
revoke execute on function private.card_handle_usable(text, text[])                from public, anon, authenticated;
revoke execute on function private.suggest_card_handle(uuid, text[])               from public, anon, authenticated;
revoke execute on function private.member_card_json(public.member_cards)           from public, anon, authenticated;
revoke execute on function private.card_profile_json(public.profiles)              from public, anon, authenticated;
revoke execute on function private.my_card_state(uuid, boolean)                    from public, anon, authenticated;
revoke execute on function private.card_is_public(uuid)                            from public, anon, authenticated;
revoke execute on function private.card_input_text(jsonb, text, text)              from public, anon, authenticated;
revoke execute on function private.card_input_bool(jsonb, text, text, boolean)     from public, anon, authenticated;
revoke execute on function private.card_input_tags(jsonb, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function private.card_require_length(text, integer, text)        from public, anon, authenticated;
revoke execute on function private.insert_officer_card(uuid, text, uuid, boolean)  from public, anon, authenticated;
revoke execute on function private.card_name_is_blank(text, text)                  from public, anon, authenticated;
revoke execute on function private.card_handle_exclusions(uuid, text[])            from public, anon, authenticated;
revoke execute on function private.card_fallback_handle(uuid, text[])              from public, anon, authenticated;
revoke execute on function private.card_audit_subject(uuid)                        from public, anon, authenticated;
revoke execute on function private.release_card_handle(uuid, text, text, uuid)     from public, anon, authenticated;
revoke execute on function private.retire_card_handles()                           from public, anon, authenticated;

-- The validators the CHECK constraints call, and the card_json_* helpers those
-- call in turn (as the same role -- and card_theme_is_valid's catch-all would
-- turn a permission error there into a misleading CHECK violation). Pure
-- functions of their arguments, so granting them exposes nothing; service_role
-- needs them because a CHECK runs as the writing role. Members still have no
-- execute on any of them.
grant execute on function private.card_tags_ok(text[], integer, integer)          to service_role;
grant execute on function private.card_media_path_ok(uuid, text)                  to service_role;
grant execute on function private.card_theme_is_valid(jsonb)                      to service_role;
grant execute on function private.card_sections_are_valid(jsonb)                  to service_role;
grant execute on function private.card_link_kind_ok(text)                         to service_role;
grant execute on function private.card_link_value_ok(text, text)                  to service_role;
grant execute on function private.card_json_in(jsonb, text[])                     to service_role;
grant execute on function private.card_json_hex(jsonb)                            to service_role;
grant execute on function private.card_json_int_between(jsonb, integer, integer)  to service_role;
grant execute on function private.card_json_keys_within(jsonb, text[])            to service_role;

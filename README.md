# WashU SHPE

The Washington University in St. Louis chapter of the Society of Hispanic Professional Engineers — public website and member portal.

One React application serves three audiences:

```
PUBLIC WEBSITE          →  prospective members, sponsors, community, alumni
  ↓ Member Login
MEMBER PORTAL (/portal) →  events, check-in, points, history, resources, business card
  ↓ Admin Portal
OFFICER PORTAL (/admin) →  event & attendance management, points, analytics, audit log
```

Plus one public page per member: a **business card** at `/card/<handle>`, the address written
to their NFC card (see [Business cards](#business-cards)). And one public form per event: the
**attendance form** at `/attend/<token>`, which officers share at a meeting so a newcomer without
an account still gets counted (see [Attendance form](#attendance-form)).

The product loop the whole system exists to make reliable:

**Discover an event → attend it → check in → earn points → see your progress.**

---

## Contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Creating the first administrator](#creating-the-first-administrator)
- [Development accounts](#development-accounts)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security model](#security-model)
- [Chapter configuration](#chapter-configuration)
- [Attendance form](#attendance-form)
- [Admin password reset links](#admin-password-reset-links)
- [Business cards](#business-cards)
- [Project layout](#project-layout)
- [Deferred and future work](#deferred-and-future-work)

---

## Architecture

```
                    React SPA (Vite)
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
   Public pages      Member portal      Admin portal
   (no backend)           │                  │
                          └────────┬─────────┘
                                   │
                            @supabase/supabase-js
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
   Supabase Auth          PostgreSQL + RLS        SECURITY DEFINER functions
   (sessions, email)      (every table gated)     (check-in, corrections, roles)
```

**The application is a static bundle.** All privileged logic lives in the database as
PostgreSQL functions, guarded by Row Level Security. There is no application server to run,
host or pay for — Netlify serves files, Supabase does the rest.

Four small Netlify functions sit beside the bundle. Three hold no privilege: a daily ping that
stops the free Supabase project from pausing and an edge function that adds link-preview tags to
card pages, both using only the public anon key, and a `health` check that touches nothing at
all. The fourth, `admin-password-reset-link`, is the one place the service role key is used: it
creates a password reset link for an admin to hand to a member, after the database has checked,
with the admin's own session, that they may. The site works without any of them; without that
one, admins just can't create reset links (see [Netlify functions](#netlify-functions)).

Three consequences worth knowing before you change anything:

1. **The client is never trusted.** Points, attendance, roles and event codes are all written
   by `SECURITY DEFINER` functions that re-check the caller's identity and role. Hiding a
   button changes nothing about what a request can do.
2. **Points are a ledger, not a counter.** `point_transactions` is append-only in practice;
   totals are always derived. A mistake is fixed with a compensating entry, never by editing
   history, so "who changed this and why" stays answerable.
3. **Check-in is one transaction.** Attendance and its point award are inserted by a single
   function call. You cannot end up with attendance and no points, or points and no
   attendance. `UNIQUE(event_id, member_id)` — not application logic — is what makes duplicate
   attendance impossible under double-taps, retries and racing tabs.

### Data model

```
auth.users ──1:1── profiles ──1:N── member_roles          (member | officer | admin)
                      │
                      ├──1:N── event_attendance ──N:1── events ──N:1── event_categories
                      │                                   │              academic_terms
                      │                                   └──1:1── event_checkin_secrets
                      │                                             (salted SHA-256, RLS with
                      │                                              zero policies)
                      └──1:N── point_transactions  (the ledger)
                                        │
                    ┌───────────────────┴───────────────────┐
              member progress                        admin analytics
```

Supporting tables: `announcements`, `resources`, `app_settings`, `notification_preferences`,
`checkin_attempts` (durable brute-force throttle), `admin_audit_log`, `points_leaderboard`
(the daily leaderboard snapshot, reachable only through `get_points_leaderboard()`),
`event_attendance_links` and `event_attendance_submissions` (the
[attendance form](#attendance-form): one secret link per event, and every response it accepted
or an officer entered).

[Business cards](#business-cards) add seven tables. Like the leaderboard snapshot, every one has
RLS on, zero policies and no grants to any client role, so the card functions are the only way
in:

```
profiles ──0:1── member_cards ──1:N── member_card_links ──1:N── card_link_daily_clicks
   │                  │
   │                  └──1:N── card_daily_stats        (daily counters per source; no per-visit rows)
   │
   ├──1:N── card_handles        (every handle the member has held; old ones redirect, and
   │                             the card's current handle is always one of them)
   └──0:1── chapter_positions   (officer-set titles: the only source of the ✔ position line)

reserved_card_handles           route, brand and role words nobody can claim
```

Card photos live in the `card-media` Storage bucket under `<member id>/<random uuid>.webp`. Cards
store those paths, never URLs.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript, Vite 7 |
| Routing | React Router 7, nested layouts, route-level code splitting |
| Styling | Tailwind CSS v4 + `src/styles/colors.css` (SHPE brand variables) |
| Data | TanStack Query 5 |
| Forms | React Hook Form + Zod 4 |
| Backend | Supabase — PostgreSQL, Auth, Row Level Security, database functions |
| Tests | Vitest + Testing Library (frontend), pgTAP (database) |
| Hosting | Netlify (free tier) |

Dates are handled with the platform's `Intl` API against an explicit
`America/Chicago` timezone. No date library is needed and daylight saving is correct by
construction.

---

## Local setup

Requires **Node 20+** and, for the portal, **Docker** (for the local Supabase stack).

```bash
git clone https://github.com/GabbiGabster/SHPE_Website.git
cd SHPE_Website
npm install
cp .env.example .env.local
```

### Public site only

```bash
npm run dev
```

The public pages work with no configuration at all. `/portal` renders a clear
"not configured yet" notice rather than crashing.

### With the member portal

The Supabase CLI is a pinned devDependency, so `npm install` already fetched it. You need
Docker running, then:

```bash
npx supabase start
```

First run pulls several GB of images and takes a few minutes.

It prints an API URL and an anon key. Put them in `.env.local`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the anon key supabase start printed>
VITE_SITE_URL=http://localhost:5173
VITE_BASE_PATH=/
```

Apply the schema and load development data:

```bash
npm run db:reset      # applies every migration, then seed.sql
npm run dev
```

Stop the stack with `npx supabase stop` when you are done; it keeps its data between runs.

Sign in at <http://localhost:5173/login> with any of the
[development accounts](#development-accounts).

Useful local URLs: Studio <http://localhost:54323>, mail catcher (confirmation and
password-reset links) <http://localhost:54324>.

---

## Environment variables

Copy `.env.example` to `.env.local`. **Anything prefixed `VITE_` is compiled into the browser
bundle and is public.**

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | for the portal | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | for the portal | Public anon key — see below |
| `VITE_BASE_PATH` | no | Defaults to `/` (Netlify). Set to `/SHPE_Website/` only for a sub-path host |
| `VITE_SITE_URL` | recommended; **required in production** | Canonical origin used to build auth redirect URLs and every business-card URL: chip addresses, QR codes, the NFC programming sheet. On Netlify it must be the production origin in every deploy context (see [Netlify functions](#netlify-functions)) |
| `VITE_ALLOWED_EMAIL_DOMAINS` | no | Client-side registration hint; defaults to `wustl.edu` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL` | no | Fallbacks the Netlify functions read when the `VITE_` names aren't available to them (`SITE_URL` only by the reset-link function). The same public values |
| `SUPABASE_SERVICE_ROLE_KEY` | for [admin reset links](#admin-password-reset-links); never in the app | Bypasses RLS entirely. Read by `netlify/functions/admin-password-reset-link.ts` and nothing else. Not needed locally: the function doesn't run under `npm run dev`, and its tests stub Supabase |

**The anon key is meant to be public.** It identifies the project; it authorises nothing.
Security comes from Supabase Auth plus Row Level Security. The *service role* key is the
opposite: it bypasses RLS completely and must never appear in a `VITE_` variable, in the
repo, or in a browser. Exactly one piece of shipped code reads it, server-side: the reset-link
function, which uses it only after the database has confirmed the caller is an admin.

Where secrets live:

| Secret | Where it goes |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` | Netlify → Site configuration → Environment variables, where the Netlify functions can read them at runtime: on a plan with scopes, include the **Functions** scope ("All scopes", the default, does) |
| `VITE_ALLOWED_EMAIL_DOMAINS` | Netlify environment variables |
| `SUPABASE_SERVICE_ROLE_KEY` | Netlify → Site configuration → Environment variables, marked as containing secret values, with a value for the **Production** deploy context only. If the plan offers scopes, the **Functions** scope only; without them, builds can see it too (see [Netlify functions](#netlify-functions)). Redeploy after adding or changing it. Never under a `VITE_` name, never in this repo or in `netlify.toml` |

CI does not need any of them: the build must succeed without Supabase configured, and does.

---

## Database

Migrations are in `supabase/migrations/`, applied in filename order:

| File | Contents |
| --- | --- |
| `…_001_initial_member_schema.sql` | Enums, tables, indexes, constraints |
| `…_002_functions_and_triggers.sql` | Role predicates, term resolution, code hashing, triggers |
| `…_003_rls_policies.sql` | Row Level Security, grants, derived views |
| `…_004_checkin_and_admin_rpc.sql` | Check-in, points summary, dashboard |
| `…_005_admin_rpc.sql` | Officer/admin operations, analytics |
| `…_006_reference_data.sql` | Categories, terms, chapter settings, existing public documents |
| `…_007_public_events.sql` | `is_public` flag, anonymous read access to the chapter calendar |

```bash
npm run db:reset    # local: drop, re-migrate, re-seed
npm run db:push     # hosted: apply pending migrations
npm run db:test     # pgTAP suites
```

**Never change production tables by hand.** Add a migration; that is what keeps local,
CI and production the same shape.

`supabase/seed.sql` is development fixtures only. It is not a migration and is never applied
to a hosted project. Every person in it is invented.

### Key database functions

| Function | Who may call it | What it does |
| --- | --- | --- |
| `check_in_with_code(code)` | any member | Resolves the event from the code, validates, writes attendance + points atomically |
| `check_in_to_event(event, code)` | any member | Same, when the event is already known |
| `get_member_dashboard(term)` | any member | The whole dashboard in one round trip |
| `get_member_points_summary(member, term, year)` | self, or officers | Totals, category breakdown, percentile |
| `admin_rotate_event_code(event)` | officer | Issues a code, returns the plaintext **once** |
| `admin_add_attendance(event, member)` | officer | Manual check-in through the same transactional path |
| `admin_remove_attendance(id, reason)` | officer | Removes attendance **and** posts a compensating correction |
| `get_attendance_form(token)` | anyone, signed in or not | The event's title, time and place and whether its form is `open`, `not_open`, `closed` or `cancelled`. An unknown, malformed or draft-event link gets the same `not_found` |
| `submit_event_attendance(token, first, last, email)` | anyone | Accepts a response during the check-in window, up to 1,000 new ones per link. If an account has that email, checks that member in through the same transactional path as every check-in; otherwise the response waits for one. Same answer either way |
| `admin_create_attendance_link(event)` | officer | Makes the event's attendance link if it has none. Never replaces one: if a link exists, another officer's included, it returns that one with `created: false`. Audited when it makes one, without the token |
| `admin_rotate_attendance_link(event)` | officer | Replaces the link (or makes the first one): the old one stops working at once, and the new one starts a fresh count towards the 1,000. Audited, without the token |
| `admin_attendance_link(event)` | officer | Reads the current link back. Unlike a check-in code, it isn't show-once |
| `admin_add_attendance_submission(event, first, last, email)` | officer | Records someone by name and email, with no window check. Checks them in now if an account has that email (method `manual`, verified by the officer), otherwise it waits like a form response. Returns `checked_in`, `waiting` or `already_recorded`; audited when it records or checks in anyone |
| `admin_link_attendance_submission(submission, member)` | officer | Puts a waiting response on a member's record, points included, as if the addresses had matched; audited |
| `admin_delete_attendance_submission(submission)` | officer | Deletes a response that is still waiting (spam); audited. One already on a record is attendance, removed with `admin_remove_attendance` |
| `admin_delete_waiting_submissions(event, before)` | officer | Deletes, in one step, the waiting responses that came through the form before a moment (in practice, when a leaked link was replaced). Keeps responses on someone's record and ones officers entered. Audited with the count |
| `admin_password_reset_target(member)` | admin only | Called by the reset-link function with the admin's own session. Refuses anyone else and the admin's own id; returns the member's sign-in address |
| `admin_log_password_reset_link(member)` | admin only | The audit row the reset-link function must write before it returns a link. Never sees the link |
| `admin_adjust_points(member, amount, reason)` | officer | New ledger entry; reason required and audited |
| `admin_set_role(member, role, granted)` | admin only | The only path to officer/admin |
| `get_chapter_officers()` | approved members | Meet your officers: each `chapter_positions` holder's title, name, major, class year, email and LinkedIn, in Leadership-page order |
| `admin_set_membership_status(member, status)` | officer | Preserves all history |
| `admin_analytics(term)` | officer | Chapter aggregates, computed in SQL |
| `get_points_leaderboard(scope)` | approved members | Top 25 plus the caller's own place, from a daily snapshot. While hidden, members get `{ "enabled": false }` and nothing else |
| `admin_set_leaderboard_enabled(enabled)` | officer | Shows or hides the leaderboard; audited |
| `admin_refresh_points_leaderboard()` | officer | Rebuilds the snapshot now instead of tonight; audited |
| `get_public_card(handle)` | anyone, signed in or not | A live card's public fields; `redirect` with the current handle for an old one; otherwise `not_found`. Unpublished, hidden, pending, suspended, switched-off and nonexistent cards all get the same `not_found`, so none can be probed |
| `record_card_event(handle, event, source, link)` | anyone | Adds one to a daily counter: a view, contact save, share or link click, by source (`nfc`, `qr`, `link`). Silently ignores unknown handles and events, links not on the card, and owners viewing their own card |
| `get_my_card()` | approved members | The caller's card, drafts and hidden links included, plus verified position and profile fields, for the editor. While cards are switched off, members get `{ "enabled": false }` and nothing else; officers still get theirs |
| `suggest_my_card_handle()` | approved members | The caller's current handle, or a suggested one (`firstname-lastname`) from `private.suggest_card_handle()` |
| `check_card_handle(handle)` | approved members | `available` / `yours` / `taken` / `reserved` / `removed` (an officer took it from this member) / `invalid`. Not granted to anon, so the namespace can't be enumerated |
| `save_my_card(card, links)` | approved members | Validates every field and writes the card and its links in one transaction. Links are upserted by id, so click history survives a save. A new handle is claimed and the old one kept (at most 5 per member, ever). The first save marks the card as opened by its owner |
| `set_my_card_published(published)` | approved members | Publishes or unpublishes the caller's card |
| `get_my_card_insights(days)` | approved members | Views by source, saves, shares and clicks per link over the last 1–365 days (St. Louis time), one row per day, zero-filled |
| `admin_list_cards()` | officer | Every approved member, with or without a card: handle and old handles, card status, chip status (including whether the chip's handle still resolves), position, 30-day views |
| `admin_suggest_card_handle(member)` | officer | The handle a new card for that member would get, or their current one |
| `admin_create_card(member, handle, publish)` | officer | A card with the member's name and school and nothing else. Unpublished unless `publish` makes it a starter card; audited |
| `admin_create_missing_cards(publish, dry_run)` | officer | The same for every active member without a card. `dry_run` (the default) returns the proposed handles and the skipped members and writes nothing; the real run is audited |
| `admin_mark_chips_written(members, handles)` | officer | Records which handle each member's NFC chip carries, and when. Given the handles the officer exported, it records those, and skips anyone who no longer holds theirs; audited |
| `admin_set_card_hidden(member, hidden, reason)` | officer | Moderation: a hidden card resolves as `not_found`. Reason required; audited |
| `admin_set_cards_published(members, published)` | officer | Publishes or unpublishes one card or many, the same switch the owner has. Doesn't mark a starter card as opened, and doesn't override a hide, a blocked membership or the feature switch. Only cards that change are written; each is audited. Members without a card come back as `skipped` |
| `admin_release_card_handle(member, handle, reason)` | officer | Takes one handle, current or old, away from a member: it stops redirecting to them, anyone else may claim it, and they can never take it back. Releasing the current handle moves the card to the member's next suggestion. Reason required; audited |
| `admin_reset_card_handle(member, reason)` | officer | Releases the member's current handle (the same as above for that handle); audited |
| `admin_set_chapter_position(member, title)` | officer | Sets or clears the verified title a card shows with a ✔; audited |
| `admin_set_cards_enabled(enabled)` | officer | Turns business cards on or off; audited |

### Officer positions are titles, not permissions

A member's position (President, Treasurer, ...) is stored once, in `chapter_positions`, and shows
in two places: **Officers** (Meet your officers) in My SHPE, with each officer's email and
LinkedIn, and the ✔ line on their business card. Officers set it from
**Admin → Members → (member) → Administration**, picking from the public Leadership page's
titles, or type any title in **Admin → Business Cards**. Board titles are listed in Leadership-page
order however they're spelled; any other title comes after them.

A position grants and revokes nothing. Officer access is still the `officer` role under **Roles**,
and no policy or function reads a position. One position per member; several members may share
one (co-chairs). The public Leadership page still reads `src/data/leaders.json`.

### The leaderboard is a daily snapshot

The leaderboard in My SHPE reads from `points_leaderboard`, a snapshot rebuilt **once a day**
rather than aggregated from the ledger on every visit. If `pg_cron` is enabled, the
`refresh-points-leaderboard` job rebuilds it at 06:05 UTC. Without `pg_cron` (the default), the
first visit after midnight Central rebuilds it instead. Either way it's built at most once a day,
and an advisory lock stops two simultaneous visitors from both rebuilding it. Points earned today
appear on the board tomorrow. My Points is always live. Officers can force a rebuild from
**Admin → Leaderboard** after correcting attendance.

It ships hidden. Members see neither the board nor its menu link until an officer turns it on
from **Admin → Leaderboard**, where they can preview it first.

Ranked means an active membership and a positive point total for the period, which is the same
cohort as the percentile on My Points. Ties share a place (1, 1, 3), and a tie at 25th place is
shown in full rather than cut off alphabetically.

---

## Creating the first administrator

There is deliberately **no "make me admin" button**. Registration always produces a plain
member; elevation is an explicit, audited act.

Bootstrap the first admin once, by hand:

1. Register normally through `/register` (or create the user in the Supabase dashboard).
2. Open the Supabase dashboard → **SQL Editor** and run:

```sql
insert into public.member_roles (member_id, role)
select id, 'admin' from public.profiles where email = 'you@wustl.edu'
on conflict (member_id, role) do nothing;
```

3. Sign out and back in. `/admin` is now available.

From then on, every other officer and admin is granted through **Admin → Members → the
member → Administration**, which is role-checked in the database and written to the audit log.

To onboard a member whose email is not on an approved domain, add their address to the
allow-list first:

```sql
select public.admin_set_app_setting(
  'manual_email_allowlist',
  '["alum@example.org"]'::jsonb
);
```

---

## Development accounts

Created by `supabase/seed.sql`, local database only. Password for all of them:
**`shpe-dev-password`**

| Email | Roles |
| --- | --- |
| `admin@example.test` | admin + officer + member |
| `officer@example.test` | officer + member |
| `member@example.test` | member |

Plus 25 further fictional members with attendance and point history.

The seed also creates an event that is **live right now** — *General Body Meeting #3* — with
the check-in code **`SHPEDEV1`**, so the whole loop is testable the moment you finish setup.

The same event has an [attendance form](#attendance-form) with a fixed, obviously fake token, at
<http://localhost:5173/attend/deadbeefdeadbeefdeadbeefdeadbeef>. Replacing it from the roster
works as usual; the fixed token is only what you start with. Its roster starts with two responses
waiting for an account, and neither address belongs to one:

- **Valentina Cruz** answered as `valentina.cruz+gbm@example.test` and hasn't registered.
  Register locally as `valentina.cruz@example.test` (the `+tag` doesn't matter) to watch the
  signup claim check her in.
- **Lucia Marin** answered with a personal address, `lucia.m.personal@example.com`, instead of
  her account's `lucia.marin@example.test`. That's what linking a response by hand is for: link
  it to Lucia Marin.

Check-in, by code or by form, stays open until 30 minutes after the event ends, about an hour
and three quarters after you seed. `npm run db:reset` seeds it again with a fresh window.

---

## Testing

```bash
npm test              # Vitest, once
npm run test:watch
npm run test:coverage
npm run db:test       # pgTAP, needs `supabase start`
```

**Frontend (`src/**/*.test.ts(x)`)** covers the logic where a mistake is expensive:
timezone conversion across both daylight-saving boundaries, event status transitions, every
form schema, error-message mapping, CSV escaping (including spreadsheet formula injection),
`.ics` generation, and the check-in page — including that repeated taps issue exactly one
request. For business cards: vCard escaping, line folding and CRLF endings; theme contrast
checks; link normalization; handle rules matching the SQL; and the public card page in each of
its states. The reset-link Netlify function runs for real against a stubbed Supabase: the admin
check comes first, the service key goes only to Supabase Auth and the admin's token never does,
and a link that couldn't be audited is never returned.

**Database (`supabase/tests/*.test.sql`)** is where the security claims are actually proven.
These run against the live local database — which is already seeded — so count assertions are
scoped to each suite's own fixture rows rather than assuming an empty schema:

- `checkin.test.sql` — valid/invalid codes, before and after the window, cancelled and draft
  events, inactive members, **duplicate check-in awarding no second set of points**, direct
  attendance inserts being refused, and an officer correction netting points back to zero
  while preserving the original ledger entry.
- `rls.test.sql` — the authorisation matrix, attempted the way an attacker would: as the
  `authenticated` role with a member's JWT, issuing the query directly. A member cannot read
  another member's ledger, cannot insert attendance, cannot award themselves points, cannot
  grant themselves a role, cannot read a check-in hash, and cannot reinstate their own
  suspended membership. An officer cannot grant roles; an admin cannot revoke their own.
- `leaderboard.test.sql` — the leaderboard ships hidden, and the switch is enforced by the
  database (a member asking while it is hidden gets no rows, and the snapshot tables have no
  grants). The board
  is a snapshot: points earned after the day's build do not appear until the next one. It also
  covers who is ranked, ties, the top-25 cut-off, and that no member id or email is returned.
- `cards.test.sql` — business cards. `anon` cannot select any card table, and `not_found` is
  identical for unpublished, hidden, pending, suspended, switched-off and nonexistent cards. Old
  handles redirect and can't be claimed by anyone else; the 5-handle cap holds; reserved and
  malformed handles are refused. `javascript:`, `data:` and `http:` links and invalid themes are
  rejected. A starter card's public payload holds only the allowed fields, saving links keeps
  their ids (so click history survives), and owner views aren't counted. Handle suggestions fold
  accents and fall through collisions in order. Only officers can create cards, every officer
  action writes an audit row, and storage policies keep each member inside their own folder.
- `card_publishing.test.sql` — officers publishing and unpublishing cards. Members can't; every
  change is audited once, however often a card is listed; a starter card stays a starter card;
  hiding still wins; and the owner can publish again after an officer unpublishes.
- `attendance_form.test.sql` — the attendance form. `anon` can't touch either table directly and
  members can't read responses. An unknown, malformed or draft-event link gets the same
  `not_found`, and responses are refused outside the check-in window. A response whose email
  matches an account (ignoring case and `+tags`) is checked in with method `form` and the
  event's points, a repeat awards nothing, and the answer is identical whether or not the address
  matched. A waiting response is claimed, points included, when an account is created with that
  address. A second officer pressing Create gets the first one's link back, untouched and not
  audited again; replacing the link kills the old one; only officers can create, read, link or
  delete, and every officer action is audited. Past its cap a link takes no new address, while
  one it already has still gets the usual answer, and an officer can still enter someone by
  hand; a replacement takes new addresses again. Someone whose attendance an officer removed is
  checked in again, on a new attendance row, by sending the form again. A response an officer
  entered becomes `manual` attendance verified by them, now or at signup. Clearing out a
  replaced link deletes only its waiting form responses, keeping officer entries, anyone on the
  roster and what came through the new link, and is audited once with the count.
- `password_reset_links.test.sql` — the database's half of admin reset links. `anon`, members
  and officers are refused, an admin can't target themselves, an unknown member is `P0002`, the
  address returned is the one the member signs in with, and logging writes one audit row that
  holds no link.

---

## Deployment

**Production is Netlify.** Connect the repository once in the Netlify UI; `netlify.toml`
carries the build command, the SPA rewrite and every security header. Pushes to `main` deploy
automatically, and `.github/workflows/ci.yml` runs lint, typecheck, build and tests on every
pull request and on `main`. The [environment variables](#environment-variables) are set in the
Netlify UI too. `SUPABASE_SERVICE_ROLE_KEY` is the only secret among them, and only admin reset
links need it.

### Why not GitHub Pages

The chapter moved off Pages, and the reason is worth keeping written down: **GitHub Pages
cannot set HTTP response headers.** The Content-Security-Policy, HSTS, `X-Frame-Options` and
`Permissions-Policy` in `netlify.toml` are simply inert there. Serving a portal that holds
member attendance and contact details from a host where you cannot set a CSP is the weakest
link in an otherwise careful design. Cost was never the deciding factor — both are free at
chapter scale.

Nothing is locked in. `base` is still env-driven, so a sub-path static host is one variable
away:

```bash
VITE_BASE_PATH=/SHPE_Website/ npm run build   # then publish dist/ anywhere
```

There is **no deep-link fallback any more.** The generated `404.html` and the inline decoder
that went with it were removed (see the comment in `vite.config.ts`), because the decoder forced
`'unsafe-inline'` into `script-src`. On a host without an SPA rewrite rule, every deep link
gets that host's own 404 page, and that includes every `/card/<handle>` and `/attend/<token>`:
chip taps, QR scans and shared links are always cold deep links. Restore both halves of the
shim, with a `sha256-…` hash of the decoder in the CSP, before using such a host.

On a host that does rewrite unknown paths to `index.html`, business cards and the attendance
form work, because both pages need only the bundle and Supabase. Either way, what's lost is
everything in [Netlify functions](#netlify-functions): link previews, server-side redirects for
old handles (the page redirects in the browser instead), the keep-alive ping, the health check,
and admin password reset links.

### Running costs

$0 at chapter scale. Netlify's free tier and Supabase's free tier both have roughly two orders
of magnitude of headroom for ~200 members.

The one thing to plan for: **Supabase pauses free projects after about a week of inactivity**,
and un-pausing is a manual click in the dashboard. Weekly events keep it awake during term.
Summer break is the risk, and it is exactly when members tap their business cards at
internships and career fairs: a paused project means every card shows an error.

So `keep-supabase-awake`, a Netlify Scheduled Function, calls `get_app_config` with the anon key
once a day, which counts as activity. It is not a GitHub Actions cron because GitHub disables
scheduled workflows in a public repository after 60 days without a commit, which is about the
length of a summer. The ping prevents a pause; it cannot undo one. If its log shows failures day
after day, open the Supabase dashboard and restore the project by hand. Supabase Pro
(~$25/month) removes the question entirely and also buys daily backups — worth considering once
there are a couple of years of member records in there.

The `card-meta` edge function is the only metered compute that grows with traffic: one
invocation per card page load. At chapter scale that is a rounding error against Netlify's free
allowance, but check the plan's current limits if cards ever see real traffic. The reset-link
function runs only when an admin creates a link, and `health` only when something calls it.

### Netlify functions

Four functions, all optional extras on top of the static site. Only `admin-password-reset-link`
holds a secret, and none of them decides anything about access; the database still does that.

| Function | Runs | What it does |
| --- | --- | --- |
| `netlify/functions/keep-supabase-awake.ts` | Daily at 00:00 UTC, published deploys only (not previews) | Calls `get_app_config` so the free project never sits idle long enough to pause. Logs success or failure, never the key |
| `netlify/functions/health.ts` | Any request to `/.netlify/functions/health` | A liveness check: answers `{ "status": "ok", "timestamp": … }` with `Cache-Control: no-store` and `Access-Control-Allow-Origin: *` (204 to a preflight). It never calls Supabase and reads no variables, so it only says that Netlify is running this site's functions. Past 100 requests a minute from one IP it answers 429, but that count lives in one warm instance's memory, so it's best effort, not a real limit. Nothing in the app calls it |
| `netlify/functions/admin-password-reset-link.ts` | `POST /.netlify/functions/admin-password-reset-link`, when an admin creates a [reset link](#admin-password-reset-links) | Asks the database, with the admin's own session, whether they may (`admin_password_reset_target`); asks Supabase Auth for a single-use recovery token with the service role key; records it with `admin_log_password_reset_link`; only then returns the link. Same-origin only (no CORS headers), `Cache-Control: no-store`, and never logs the token, the link, the admin's session or any key |
| `netlify/edge-functions/card-meta.ts` | Every `GET /card/<handle>` | Writes the card's title, description, photo and robots rule into `<head>` for link previews, plus the stylesheets for the card's fonts so the name appears in its own face from the first paint; 301s an old handle to the current one; 404 plus `noindex` for a card that isn't live. **Fails open**: on any error, a missing variable, or Supabase taking over 1.5 s, the page is served untouched |

All but `health` read `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the edge function and
the reset-link function also read `VITE_SITE_URL`) **at runtime**, so those three must be set in
Netlify → Site configuration → Environment variables where functions can see them. Values in
`netlify.toml` reach the build only, never a function. On a plan with scopes, that means
including the **Functions** scope ("All scopes", the default, does); on a plan without them,
every variable already reaches functions. With the variables missing, the keep-alive logs an
error naming them, the edge function quietly does nothing, and the reset-link function tells the
admin links aren't set up.

**`SUPABASE_SERVICE_ROLE_KEY` is read by `admin-password-reset-link` and nothing else.** Set it
in the same place, tick "Contains secret values", and give it a value for the **Production**
deploy context only: a deploy preview or branch deploy runs a branch's code, functions included,
before anyone has reviewed it, and that code shouldn't hold the key. Never give it a `VITE_`
name: that would compile it into the public bundle.

Scopes, where the plan has them, narrow it further: give it the **Functions** scope only and the
build never sees it. Not every Netlify plan offers scopes, and on one without them (the free
plan this site runs on, at the time of writing) the key is visible to builds as well, so anything
that runs during a build, a build plugin included, could read it. Don't add build plugins you
don't trust. Scopes never keep it from functions, though: any function code deployed to a
context that has the key can read it, which is why only the Production context gets a value.

**Functions read environment variables as of their deploy.** After adding or changing the key,
trigger a new deploy (**Deploys → Trigger deploy**) before expecting a reset link to work; the
deploy already live keeps the values it started with. Without the key, everything but reset links
works as before, and a deploy preview just says reset links aren't set up there. The reset-link
function builds its links on `VITE_SITE_URL`, falling back to the origin the admin is using, and
refuses a plain-http address anywhere but localhost.

To check the ping, open the function under **Logs & metrics → Functions** in the Netlify UI and
use **Run now**; its log line says whether Supabase answered.

If production still says reset links aren't set up after a new deploy, or that Supabase didn't
create the link, open `admin-password-reset-link` in the same place. Its log names each variable
it couldn't read (never a value), so it shows whether the key is reaching the function at all,
and a key Supabase refuses shows up as `generate_link` answering 401 or 403.

**`VITE_SITE_URL` must be the production origin in every deploy context, previews included.**
Card URLs, QR codes and the NFC programming sheet are built from it, so a programming sheet
exported from a preview still produces `https://washushpe.org/card/...` addresses. A chip
written with a deploy-preview address would break the day that preview is deleted, and fixing
it means rewriting the chip by hand. (Auth emails sent from a preview then link to production
too, which is expected.)

### Supabase redirect URLs

Under **Authentication → URL Configuration**, set the site URL and add every origin that will
receive an auth link, including the base path where one applies:

```
https://gabbigabster.github.io/SHPE_Website/login
https://gabbigabster.github.io/SHPE_Website/reset-password
https://<your-netlify-site>/login
https://<your-netlify-site>/reset-password
http://localhost:5173/login
http://localhost:5173/reset-password
```

Confirmation and password-reset emails that land on an unlisted URL fail silently, and it is
an unpleasant thing to debug.

[Admin reset links](#admin-password-reset-links) need nothing here: they open this site's
`/reset-password` page directly and never pass through a Supabase redirect.

### Content Security Policy

`netlify.toml` carries the CSP. Supabase needs `connect-src https://*.supabase.co
wss://*.supabase.co` and `img-src https://*.supabase.co`. These are scoped to
`supabase.co` — do not relax the policy to `*` to make something load.

Business cards needed no CSP change. Card photos come from the `card-media` bucket under
`img-src https://*.supabase.co`, card fonts from Google Fonts (already allowed), and QR codes and
contact files are generated in the browser, so no new origin is contacted. The `card-meta` edge
function injects only `<title>`, `<meta>` and `<link>` tags, never an inline script, so
`script-src` stays without `'unsafe-inline'`.

The attendance form and the reset-link function needed no CSP change either. The form is one more
page of the bundle calling Supabase, its QR code is drawn in the browser, and the function is
called on the site's own origin, which `connect-src 'self'` already allows. `/attend/*` gets an
`X-Robots-Tag: noindex, nofollow` header, because its link is a credential.

`Permissions-Policy` still has `camera=()`. Scanning a check-in QR code with the site's own camera
is architected for but not built; the day a scanner ships, that becomes `camera=(self)` and
nothing else changes. The attendance form's QR code doesn't need it: the phone's own camera app
reads it and simply opens the link.

These headers are why production is Netlify: a static host that cannot set them leaves every
one of them off.

---

## Security model

| Concern | How it is handled |
| --- | --- |
| Authentication | Supabase Auth. The official client owns tokens; no hand-rolled storage, nothing in URLs, nothing logged |
| Authorisation | `member_roles` + RLS + `require_officer()`/`require_admin()` inside every privileged function |
| Route guards | `RequireAuth` / `RequireRole` are UX, not security. Every route behind them is independently enforced in the database |
| Check-in codes | Salted SHA-256, in a table with RLS enabled and **zero policies**. Plaintext is shown to the officer once and never stored |
| Code guessing | ~320,000 combinations, plus a durable per-member throttle (`checkin_attempts`) of 8 failures per 10 minutes |
| Duplicate attendance | `UNIQUE(event_id, member_id)`, enforced by the database under any concurrency |
| Point tampering | No `INSERT`/`UPDATE`/`DELETE` policy on `point_transactions` for anyone. `updateMyPoints(999999)` has no policy to satisfy |
| Role escalation | No write policy on `member_roles` at all. `admin_set_role()` is the only path, and it is admin-only and audited |
| Profile tampering | RLS decides which *rows*; a trigger decides which *columns*. Members cannot change their own membership status, email, or mark themselves a verified National member |
| Email domain | Enforced in the database on signup, configurable, with an explicit allow-list for exceptions. The client-side check is only for a faster error message |
| Auditability | `admin_audit_log` records role changes, point adjustments, attendance corrections, status changes, code rotations, attendance-form links, the people officers add by name and email, the waiting responses officers link or delete, password reset links, and every officer action on business cards — with actor, timestamp, and reason |
| Attendance form | The link is the credential: 122 random bits, stored where no client role can select it, read back only by officers, replaceable in seconds, and never replaced by a second officer pressing Create. It works only inside the event's check-in window and takes at most 1,000 new responses before it has to be replaced. Every accepted response gets the same answer whether or not its email has an account, so the form can't be used to find out who does. What it accepts on purpose is in [Attendance form](#attendance-form) |
| Admin reset links | Admin only, decided by the database with the admin's own session, never for themselves. The service role key lives only in the Netlify function that asks Supabase Auth for the token. Every link is audited before it is shown, works once, expires in about an hour, and is cancelled by the next one. The link itself is never stored or logged |
| Error messages | Structured codes mapped to member-facing sentences. No SQLSTATE, PostgREST body or stack trace ever reaches a user |
| Public calendar | `anon` reads events through a column-level GRANT plus a row policy (`status <> 'draft' AND is_public`). Organiser contacts, capacity and check-in windows are not in the grant, so they cannot be selected at all |
| Privacy | Member emails and attendance are never public. Points are shown to other members only on the members-only leaderboard: name, rank, total and event count for the top 25. It ships hidden until an officer turns it on, and pending accounts never see it. Portal pages are `noindex, nofollow`; page titles are generic. A business card is the one public page about a member, and it shows only what they chose to put on it |
| Public cards | The card tables have RLS on, zero policies and no grants. A stranger sees a card only through `get_public_card()`, which returns what the card displays and nothing else: drafts, hidden links, moderation notes and the account email never leave the database. Unpublished, hidden, pending, suspended, switched-off and nonexistent cards all return the same `not_found`, and handle checks need a sign-in, so the namespace can't be probed. Cards are `noindex` unless the member opts in |
| Card content | No HTML, markdown or raw CSS anywhere: every field renders as text. Links must be `https://` (a CHECK constraint, plus app-built `mailto:`/`tel:`), and every href passes `safeExternalHref` again at render time. Themes are validated jsonb, hex colors and fixed lists only, unknown keys rejected |
| Impersonation | The ✔ position line comes only from `chapter_positions`, which only officers set; a self-written headline renders as plain text with no badge. Handles are first come, first served by approved members only, role and brand words are reserved, and officers can hide a card or release any handle a member holds, current or old, both audited. A released handle is blocked for that member for good, so they can't simply claim it back |
| Officer-made cards | An officer can create a card, and publish it as a starter card, but it only ever shows the member's name, school, major, class year and verified position. Officers can't add contact details, links, photos or text; after creation their only powers over a card are hiding it and releasing its handles. Contact details are never copied from a profile, by anyone |
| Card media paths | Cards store storage paths, never URLs. The database requires `<owner id>/<uuid>.webp` (or `.jpg`/`.png`) inside the owner's own folder, and the page and the edge function build image URLs only from paths of that shape, so a card can't load a tracking pixel or an image from an arbitrary host. Storage policies allow uploads only into the member's own folder (30 files at most, and not while suspended), 2 MB and images only, and photos are re-encoded in the browser first, which strips EXIF including GPS. When an admin deletes a member, their photos are removed from the bucket too |
| Chip tampering | An unlocked NFC chip can be rewritten by any phone that taps it, turning a member's card into a phishing link under SHPE's name. Every chip is password-protected after writing (see [NFC chips](#nfc-chips)) |
| Card insights | Daily counters only: no IP addresses, no user agents, no per-visit rows. Owners viewing their own card aren't counted. `record_card_event()` can only add one to a counter, so the worst abuse is inflating someone's view count |

Historical records are not deleted to fix mistakes. Events with attendance cannot be deleted
at all (`ON DELETE RESTRICT`, plus a delete policy limited to admins and drafts); they are
cancelled. Members are deactivated, not erased.

---

## Chapter configuration

Policy that leadership might reasonably change lives in `app_settings`, not in source. Change
it through **Admin** or with `admin_set_app_setting()`:

| Key | Default | Meaning |
| --- | --- | --- |
| `allowed_email_domains` | `["wustl.edu"]` | Who may self-register. Empty array disables the restriction |
| `manual_email_allowlist` | `[]` | Individual exceptions |
| `default_membership_status` | `"active"` | Set to `"pending"` to require officer approval before check-in |
| `checkin_allowed_statuses` | `["active"]` | Which statuses may check in |
| `membership_requirements_enabled` | `false` | Whether the Membership page evaluates requirements |
| `membership_requirements` | `[]` | Requirement definitions (see below) |
| `leaderboard_enabled` | `false` | Whether members can see the points leaderboard. Ships off; officers turn it on in **Admin → Leaderboard** |
| `cards_enabled` | `false` | Whether business cards are live at `/card/<handle>` and members can open **My Card**. Ships off; officers turn it on in **Admin → Business Cards**, and can set up their own card and create cards for members before then. Enforced by the database, not the menu |

**Active-member requirements ship disabled and empty on purpose.** WashU SHPE has not defined
official requirements, and this system does not invent chapter policy. When leadership decides
on them, an admin turns the feature on and describes them as data — no deploy:

```sql
select public.admin_set_app_setting('membership_requirements_enabled', 'true'::jsonb);
select public.admin_set_app_setting('membership_requirements', '[
  {"id":"gbm",     "label":"Attend 2 GBMs",              "type":"category_events",
   "category_slug":"general-body-meeting", "target":2},
  {"id":"prof",    "label":"Attend 1 professional event","type":"category_events",
   "category_slug":"professional-development", "target":1},
  {"id":"points",  "label":"Earn 30 points",             "type":"total_points", "target":30}
]'::jsonb);
```

Event categories and academic terms are likewise data. Adding a category or a new semester
never requires a code change.

---

## Bulk event import

Officers can enter a semester at once from a spreadsheet: **Admin → Events → Import CSV**.

| Required | Optional |
| --- | --- |
| `title`, `category`, `start`, `end` | `location`, `points`, `status`, `is_public`, `description`, `capacity`, `organizer_name`, `organizer_email` |

- Dates are `YYYY-MM-DD HH:MM` in **St. Louis time**. `9/18/2026` is rejected rather than
  guessed at — US and international ordering disagree, and a wrong guess moves an event by a
  month.
- `category` matches a slug or a display name, case-insensitively.
- **Rows import as drafts** unless `status` says otherwise. A bulk import is where one typo
  becomes twelve, so nothing goes live until an officer has reviewed the list and published it.
- Invalid rows are skipped, not fatal: a typo on line 3 does not cost you the other eleven
  events. The preview shows each row with its parsed date or its specific problem before
  anything is written.
- Header spelling is forgiving (`Start Time`, `start_time`, `START TIME` all work), and columns
  the importer does not recognise are reported rather than silently dropped.

The whole thing parses in the browser and inserts through the same RLS-guarded path the event
form uses — no new backend, and no elevated privileges. There is a **Download a template**
button in the dialog.

CSV *export* exists for attendance rosters, the member roster and the point ledger, with
formula-injection escaping so a member-supplied field cannot execute when an officer opens the
file in Excel.

---

## Attendance form

The code check-in asks a lot of someone at their first meeting: an account on a wustl.edu
address, the join code or an officer's approval, then a code typed inside the window. Each step
is there for a reason, and together they mean a newcomer's first event usually goes unrecorded.
So each event can also have an **attendance form**: one secret link, `/attend/<token>`, that asks
for a first name, a last name and an email address, and nothing else. No account needed. The
schema and its reasoning are in `20260918000002_attendance_form.sql`.

**Sharing it.** In **Admin → Attendance → (the event)**, create the event's attendance link,
then copy it, show its QR code full screen on the projector, or download the QR code for slides.
Officers can read the link back at any time (it isn't show-once like a check-in code), so the
same QR code works all meeting. Creating never replaces a link: if two officers press it before
a meeting, the second gets the link the first already made, so a QR code already on a screen
keeps working.

**Replacing** the link is a separate action that asks first. The old link stops working
immediately, along with every copy of its QR code: that's what to do if a link leaks. Another
officer's roster page that's open, a full-screen QR code included, re-reads the link every minute
and switches to the new one by itself. The new link starts its own count towards the cap below,
so replacing also brings the form back for everyone if the old link was flooded.

**When it takes responses.** Only during the event's check-in window, the same
`check_in_opens_at` to `check_in_closes_at` the code uses, and only for published events. Outside
the window the page says when it opens or that it has closed. A draft event's link looks like no
link at all.

**What happens to a response:**

- If an account already has that email (ignoring case and `+tags`, as everywhere else), the
  person is checked in on the spot, with method `form` and the event's points, through the same
  transactional path as every other check-in. Someone already checked in isn't awarded twice.
- Otherwise the response **waits**. When an account is later created with that email, or a
  profile's email changes to it, a trigger checks the new member in, points included, and the
  audit log records it as the system's doing. A failed claim never blocks a registration.
- Either way the person sees the same thank-you, so the form can't be used to find out who has
  an account.
- One response per email per event. Sending it again writes nothing new, with one exception: if
  the earlier response isn't on anyone's roster and the address has an account, that person is
  checked in. So someone whose form attendance an officer removed is checked in again if they
  send the form again while it's open, the same as anyone sending it for the first time.

**Adding someone by hand.** Officers can add anyone to the event by name and email from its
roster: a newcomer without an account, someone without a phone, or someone who missed the window
(there's no window check). **Add attendee** only lists active members; this reaches everyone,
someone whose account is still pending included. It goes through the same matching as the
form: if an account has that address, the person is checked in on the spot, as `manual`
attendance verified by that officer, the same as Add attendee; otherwise the response waits and
is claimed at signup like any other.
Unlike the public form, it says which happened, since officers can already look members up. It's
audited, and it doesn't count towards the link's cap.

**Waiting responses** are listed on the event's roster, which refreshes itself while check-in is
open, so new responses and check-ins appear without a reload. An officer can **link** one to a
member by hand (someone who used a personal address but has an account on their school one),
which checks that member in exactly as if the addresses had matched, or **delete** it (spam).
Both are audited. A response already on a member's record is attendance: remove it with the
usual correction, which reverses the points and asks why.

**After replacing a leaked link**, whatever was scripted through it is still on the waiting list,
so the roster offers to delete, in one audited step, the waiting responses that came through the
form before the replacement. Responses already on someone's record and responses officers added
by hand are kept. Real people who used the old link and have no account yet go too, which is why
it asks before deleting anything.

**What it deliberately accepts:**

- Anyone holding the link can submit any address, a member's included, and that member is checked
  in. That's the price of not asking for an account, and it's bounded: the link works only during
  the window, takes at most 1,000 responses, and can be replaced in seconds, and attendance can
  be removed with an audited correction. While the link still works, though, sending the form
  again puts removed attendance back, so replace the link too if it's being abused.
- Matching ignores membership status. The point is to record people before they're members, so a
  pending account, or one created later, gets its attendance like anyone else.
- A waiting response goes to whoever registers that address. Email confirmation is off, so someone
  could register a classmate's address and inherit their waiting attendance, but they could
  equally have typed that address into the form, so nothing new is exposed.
- Each link takes at most 1,000 new responses, counted since it was made or last replaced. A
  general body meeting brings in a couple of hundred people; a thousand is someone scripting the
  form. Past that the form takes no new addresses and tells people to ask an officer, while an
  address it already has still gets the usual answer. Responses officers add don't count, and
  replacing the link starts the count again.

The form is `noindex, nofollow`, both in the page and in an `X-Robots-Tag` header for crawlers
that don't run JavaScript. It needs no Netlify function, so it works on any host that serves the
bundle with an SPA rewrite.

---

## Admin password reset links

The emailed reset link fails often enough to matter: WashU's mail filtering quarantines it or
opens it before the member does, and a PKCE link only works in the browser that asked for it. So
an **admin** can create a reset link on **Admin → Members → (the member) → Administration** and
send it however works: a text, Slack, in person. The database's half is in
`20260918000003_admin_password_reset_links.sql`, the rest in
`netlify/functions/admin-password-reset-link.ts`.

- **Admins only, never for themselves.** Officers don't see it, and the database refuses them
  anyway: the function asks `admin_password_reset_target()` with the admin's own session, so
  `require_admin()` decides, as for every other admin action. An admin changes their own password
  from Settings. Whoever holds a link can set that member's password and sign in as them, which
  is the same class of power as deleting a member or granting a role.
- **Single use, about an hour.** Supabase deletes the token when it's used, and it expires after
  the project's **Email OTP Expiration** (Supabase → Authentication → Providers → Email; one hour
  by default). Supabase keeps one recovery token per account, so a newer link, or the member
  requesting a reset email, cancels the previous one.
- **Audited before it's shown.** Every link is recorded in the audit log as *Password reset link
  created*, with who made it and for whom. If that write fails, the link is thrown away and the
  admin is asked to try again. The link itself is never stored, logged or put in the audit row.
- **Safe to paste into a chat.** It opens this site's `/reset-password` page with the token as
  `token_hash`, and the token is spent only when the member submits a new password, so link
  previews and mail scanners that open it first use up nothing. Supabase's own action link is
  never used: it is spent by simply opening it, and it signs in with the implicit flow, which this
  site's PKCE client rejects.
- **Needs the Netlify deploy and `SUPABASE_SERVICE_ROLE_KEY`.** Creating the link takes the
  service role key, so it can only happen server-side (see [Netlify functions](#netlify-functions)).
  Under `npm run dev` or on a static host, the Administration tab explains that reset links
  aren't available there; on a deploy without the key (deploy previews included), that they
  aren't set up. Nothing else changes.
- **Tested in pieces locally, end to end in production.** `netlify dev` isn't a way to try it in
  a browser: it applies `netlify.toml`'s headers to the pages it serves, and the production CSP
  blocks the inline preamble Vite's React plugin injects and a local Supabase on
  `http://127.0.0.1:54321`. The function's behaviour is covered by
  `src/services/__tests__/adminPasswordResetLinkFunction.test.ts` (`npm test`), the database's
  half by `supabase/tests/password_reset_links.test.sql` (`npm run db:test`), and the whole flow
  is for trying on the production site once the key is set and a new deploy has picked it up.
- **No rate limit beyond "admins only".** Admins are a handful of trusted people, every link is
  audited, and each one cancels the last. If that stops being enough, the function's header says
  where a limit would go.

---

## Business cards

Every member can build a digital business card in **My SHPE → My Card**. It lives at
`washushpe.org/card/<handle>`, and that is the address written to the NFC chip in their physical
card:

```
https://washushpe.org/card/diego-gonzalez?src=nfc
```

`?src=nfc` lets insights tell chip taps from QR scans (`?src=qr`) and shared links (no
parameter). The card page is one more lazy chunk of the same bundle: full screen, no site
navbar, built from `get_public_card()` alone. Contact files (`.vcf`) and QR codes are generated
in the browser, photos are resized in the browser before upload, and nothing new is hosted or
paid for. The full design, and the reasoning behind it, is in
[`docs/digital-business-cards.md`](docs/digital-business-cards.md). The schema is in
`20260914000001_member_business_cards.sql`, the photo bucket in
`20260914000002_card_media_storage.sql`.

**It ships off.** Until an officer turns it on in **Admin → Business Cards**, members don't see
My Card and every card address shows "not available". Officers can still set up their own card,
create cards for members and preview everything, so the switch can flip the day the physical
cards arrive.

### How a card comes to exist

Two ways, producing the same row under the same rules:

1. **The member opens My Card.** The handle field is pre-filled with a suggestion,
   availability is checked as they type, and their first save claims it. They decide what goes
   on the card. Card email and phone are entered there, separately from the account email; the
   editor says plainly that everything on a card is public.
2. **An officer creates it for them**, usually just before card-writing night so every chip can
   be programmed on the spot. Use **Create card** on the member's row in Admin → Business Cards
   or on their member page, or **Create cards for everyone missing one**, which previews every
   eligible member (approved, `active`, no card) with the handle each would get, lists anyone
   skipped for having no name on their profile, and writes nothing until confirmed. A name that
   yields no usable handle (a non-Latin script, say) gets a neutral `member-…` handle the member
   can change, rather than being left out.

An officer-made card holds the member's name and school, nothing else. Left unpublished (the
default), tapping the chip shows "not available" until the member publishes. Published as a
**starter card**, it shows name, school, major, class year and verified position with an Add to
Contacts button, so a chip works the day it is handed out even if its owner never logs in. When
the member does open My Card, the editor loads that card with a banner explaining who set it up
and where their chip points, and the portal dashboard prompts them until they do.

### Handles and redirects

- **Shape:** 3–30 characters of `a–z`, `0–9` and single hyphens. The database enforces it.
- **Suggestions** start from the first word of the first and last names (`María José García
  López` → `maria-garcia`, `Nguyễn Thị Ánh` → `nguyen-thi`), with accents folded. If that's
  taken they fall through the full name,
  then the class year (`diego-gonzalez-27`), then `-2`, `-3`, and so on. They are never derived
  from the email, which would publish a wustl.edu username. One SQL function,
  `private.suggest_card_handle()`, makes every suggestion, so the editor and the officer tools
  can't disagree.
- **Handles are kept.** A member who renames `diego` → `diego-gonzalez` keeps both, and the old
  one redirects to the new one, so a chip written with the old address keeps working. Nobody
  else can claim it while they hold it. Each member can hold at most 5.
- **Reserved words** (`admin`, `shpe`, `president`, `officers`, …) can't be claimed, so route,
  brand and role addresses stay free for later.
- **Officers can release a handle**, current or old, from **Admin → Business Cards**, for an
  offensive or impersonating one. It stops redirecting, anyone else may claim it, and it is
  blocked for that member for good, so they can't take it straight back (their editor says an
  officer removed it). Releasing the current handle moves the card to a new one, and the admin
  table flags any chip that carried it as needing a rewrite.
- **A deleted member's handles are retired, never reassigned,** if their card was ever live
  (published, a chip recorded, or any views). Their chip, printed QR codes and saved contacts
  would otherwise open a stranger's card, so deleting the account moves every handle it held
  into the reserved list. A draft that was never public, such as one on a duplicate account,
  frees its handle instead, so the person's real account can still have it.
- **The `/card/` path is permanent.** It is written into every chip; changing it means
  rewriting every card by hand.

### Card-writing night

1. In **Admin → Business Cards**, run **Create cards for everyone missing one**. Check the
   preview, choose whether to publish them as starter cards, and confirm.
2. Export the **NFC programming sheet**: a CSV of name, handle and the exact chip URL for each
   member.
3. Write each chip with its URL, then password-protect it (below).
4. Select the rows you wrote and click **Mark chips written**. It records the handles from the
   sheet you exported, so if a member renamed in the meantime they're listed as skipped and you
   can re-export. The table then shows who still needs a chip, and each member's editor knows
   which address their chip carries, so it can remind them when they rename (the redirect keeps
   the chip working) or tell them when an officer released that handle (the chip needs
   rewriting).

Members can also write their own chip: **My Card → Share → Write to my card** uses Web NFC on
Android Chrome. On iPhone, the Share tab explains how to do it with the free NFC Tools app.

### NFC chips

Use blank, rewritable NTAG213, 215 or 216 chips. Even with a 30-character handle a chip URL is
under 70 bytes, well inside the roughly 130 an NTAG213 holds. If the vendor pre-programmed the
chips to point at their own redirect service, rewrite them; a third-party redirect is a
dependency the chapter can't control.

**Password-protect every chip after writing.** An unlocked chip can be rewritten by any phone
that taps it, which would turn a member's card into a phishing link with SHPE's name on it.
NTAG21x chips support a 32-bit write password, and NFC Tools can set one (under *Other*). Use
one chapter password, keep it in the officer handover notes, and officers can still reprogram a
chip later. Locking chips permanently also works, because a member's handles only stop working
if an officer releases one, but a locked chip can never be rewritten or reused.

### Insights

**My Card → Insights** shows views split by source (chip, QR, shared link), contact saves,
shares and clicks per link, over 7 or 30 days. They are daily counters, never per-visit rows:
no IP addresses, no user agents. A browser counts one view per card per 30 minutes, so tapping
the chip twice or reloading doesn't inflate the number, and an owner looking at their own card
isn't counted. Counting is fire-and-forget, so a failed count
never gets in the way of the person standing there with the card.

### Link previews and search engines

Pasting a card link into iMessage, Slack or LinkedIn previews the member, not the chapter
homepage. Preview bots don't run JavaScript, so the `card-meta` edge function writes the card's
name, headline and photo into the page's `<head>` before it leaves Netlify (see
[Netlify functions](#netlify-functions)). If it fails for any reason, the page is served as
usual and only the preview is generic.

Cards are `noindex, nofollow` by default. A member can opt in to search engines from My Card; a
student's phone number turning up in Google is a bad default.

---

## Project layout

```
src/
  auth/            AuthProvider, useAuth, RequireAuth, RequireRole
  components/
    ui/            Button, Card, Field, Dialog, Toast, Table primitives
    shared/        PageHeader, StatCard, EmptyState, ErrorState, ErrorBoundary
    …              existing public-site components (Navbar, Hero, Contact, …)
  features/        events/, attendance/ — feature-specific components and hooks
    cards/         Business cards: model.ts (the shared vocabulary), the one BusinessCard
                   renderer used by the public page and the editor preview, themes, vCard,
                   QR, image upload, Web NFC, and the editor and admin pieces
  hooks/           usePageMeta, useTerms
  layouts/         PublicLayout, AuthLayout, PortalLayout, AdminLayout
  lib/             supabase, config, datetime, eventStatus, errors, validation, csv, ics
  pages/
    …              public pages (Home, Members, Sponsorship, Leadership, GetPluggedIn)
    card/          PublicCard: /card/:handle, full screen, outside every layout
    attend/        AttendanceForm: /attend/:token, the event's no-account check-in form
    auth/          Login, Register, ForgotPassword, ResetPassword
    portal/        Dashboard, Events, EventDetail, CheckIn, Points, History, MyCard, …
    admin/         AdminDashboard, AdminEvents, AdminAttendance, AdminMembers, AdminCards, …
  services/        Data access, one module per domain. Components never call Supabase directly
  types/           database.ts — the schema, mirrored in TypeScript
supabase/
  migrations/      Schema, RLS, functions
  tests/           pgTAP suites
  seed.sql         Development fixtures (never production)
netlify/
  functions/       keep-supabase-awake: the daily ping that stops Supabase pausing
                   health: a liveness check that touches nothing
                   admin-password-reset-link: the one server-side use of the service role key
  edge-functions/  card-meta: link-preview tags and old-handle redirects on /card/*
docs/              digital-business-cards.md, the business card design
```

The edge function imports `features/cards/model.ts`, `photoVisibility.ts` and `fontLinks.ts` by
relative `.ts` path, because Netlify bundles it with Deno, which can't resolve the app's `@/`
imports or packages. Those files must keep to that; `cardMetaEdge.test.ts` walks the imports and
fails if they don't.

Two rules to preserve: **components do not call Supabase directly** (they go through
`services/`), and **query keys are built in `services/queryKeys.ts`** so invalidation after a
mutation stays precise.

### The public site

`/`, `/members`, `/sponsorship`, `/leadership` and `/get-plugged-in` remain public.
Documents that were public stayed public.

**`/members` now renders the chapter calendar from the database**, replacing the embedded
Outlook calendar. There is one schedule: an officer creates an event in `/admin/events` and it
appears on the public calendar, in the member portal, and in the check-in flow. Previously
those were two lists kept in step by hand, and they drifted.

Anonymous visitors reach events through a **column-level GRANT**, not a client-side filter:

| Public sees | Never leaves the portal |
| --- | --- |
| title, description, category, start/end, location, points value, image, status | organiser name and email, capacity, check-in windows, created_by, term, timestamps |

`select *` as `anon` is rejected outright, so adding a sensitive column to `events` cannot
silently publish it. Rows are filtered by policy to `status <> 'draft' AND is_public`.
Cancelled events stay visible and struck through — someone who saw "Career Fair Prep, Nov 3"
is better served by a clear "Cancelled" than by it vanishing.

Each event has an **`is_public` toggle** in the event form (on by default). Turn it off for
exec syncs and anything internal: members still see it in the portal, the public site never
does.

---

## Deferred and future work

Not built, and marked as such rather than stubbed. Nothing here has a dead button in the UI.

- **QR check-in by camera.** Scanning an event's code inside the portal is architected for — a
  scanner would call the same `check_in_to_event` RPC — but not implemented, and `camera=()`
  stays in the Permissions-Policy until it is. The [attendance form](#attendance-form)'s QR code
  is not this: a phone's own camera app reads it and opens a link.
- **Email notifications.** `notification_preferences` exists in the schema; the Settings page
  deliberately shows no toggles for behaviour that does not exist yet.
- **Member directory.** Visibility columns exist and default to opt-out. Emails would never
  be exposed.
- **Event RSVPs, opportunities board, convention module, committees.** Schema leaves room;
  none are built. Check-in remains authoritative for attendance.
- **Subscribable calendar feed.** Members can add individual events to Google Calendar or
  download an `.ics`, but there is no single feed URL to subscribe to. That needs an endpoint
  that generates ICS on request — a Netlify Function would do it.
- **Playwright end-to-end tests.** The critical paths are covered by pgTAP (which tests the
  real guarantees) and Vitest. Browser-level E2E is a reasonable next addition.
- **Historical data import.** `point_transactions.transaction_type = 'migration'` exists to
  preserve provenance when past attendance is eventually imported.
- **Business cards, next ideas.** From the design doc's last phase; none are built:
  - **Role cards.** `/card/president` would always resolve to whoever holds the position, so an
    officer's chip passes to their successor. The role words are already reserved so nobody can
    claim them first.
  - **Leadership page from `chapter_positions`**, instead of the hand-edited
    `src/data/leaders.json`.
  - **Bilingual cards:** an optional Spanish headline and bio with an EN/ES toggle on the card.
  - **Contact exchange:** a visitor leaves their details for the member. It stores strangers'
    data and attracts spam, so it would ship off, and with care.
  - **"Where I'll be next":** a block showing the member's upcoming public SHPE events.
  - **Google Wallet pass.** Free, but needs a Google Cloud issuer account. Apple Wallet needs the
    $99/year developer account, so it is out.
  - **Drag-and-drop block ordering.** Up/down buttons shipped instead: they work with a keyboard
    and a screen reader and need no new dependency.
  - **A vCard function,** only if iOS ever stops opening the browser-generated `.vcf`: a tiny
    Netlify Function serving the same text with `Content-Disposition: attachment`.

---

## Contributing

Before opening a pull request:

```bash
npm run lint
npm test
npm run build
npm run db:test   # if you touched anything under supabase/
```

CI runs the first three on every PR. If you change a migration, change
`src/types/database.ts` in the same commit — that file is the schema, mirrored by hand.

Questions: <shpe@wustl.edu>

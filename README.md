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
to their NFC card (see [Business cards](#business-cards)).

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

Two small Netlify functions sit beside the bundle, and neither holds any privilege: a daily
ping that stops the free Supabase project from pausing, and an edge function that adds
link-preview tags to card pages. Both use only the public anon key, and the site works without
either (see [Netlify functions](#netlify-functions)).

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
(the daily leaderboard snapshot, reachable only through `get_points_leaderboard()`).

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
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | no | Fallbacks the Netlify functions read when the `VITE_` names aren't available to them. The same public values |
| `SUPABASE_SERVICE_ROLE_KEY` | never in the app | Bypasses RLS entirely. Server/CLI use only |

**The anon key is meant to be public.** It identifies the project; it authorises nothing.
Security comes from Supabase Auth plus Row Level Security. The *service role* key is the
opposite: it bypasses RLS completely and must never appear in a `VITE_` variable, in the
repo, or in a browser.

Where secrets live:

| Secret | Where it goes |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` | Netlify → Site configuration → Environment variables, with the **Functions** scope included, because the Netlify functions read them at runtime |
| `VITE_ALLOWED_EMAIL_DOMAINS` | Netlify environment variables |
| `SUPABASE_SERVICE_ROLE_KEY` | Nowhere in this repo. Supabase dashboard, or your own shell |

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
| `admin_adjust_points(member, amount, reason)` | officer | New ledger entry; reason required and audited |
| `admin_set_role(member, role, granted)` | admin only | The only path to officer/admin |
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
| `admin_release_card_handle(member, handle, reason)` | officer | Takes one handle, current or old, away from a member: it stops redirecting to them, anyone else may claim it, and they can never take it back. Releasing the current handle moves the card to the member's next suggestion. Reason required; audited |
| `admin_reset_card_handle(member, reason)` | officer | Releases the member's current handle (the same as above for that handle); audited |
| `admin_set_chapter_position(member, title)` | officer | Sets or clears the verified title a card shows with a ✔; audited |
| `admin_set_cards_enabled(enabled)` | officer | Turns business cards on or off; audited |

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
its states.

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

---

## Deployment

**Production is Netlify.** Connect the repository once in the Netlify UI; `netlify.toml`
carries the build command, the SPA rewrite and every security header. Pushes to `main` deploy
automatically, and `.github/workflows/ci.yml` runs lint, typecheck, build and tests on every
pull request and on `main`.

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
gets that host's own 404 page, and that includes every `/card/<handle>`: chip taps, QR scans
and shared links are always cold deep links. Restore both halves of the shim, with a
`sha256-…` hash of the decoder in the CSP, before using such a host.

On a host that does rewrite unknown paths to `index.html`, business cards work, because the
card page needs only the bundle and Supabase. Either way, what's lost is everything in
[Netlify functions](#netlify-functions): link previews, server-side redirects for old handles
(the page redirects in the browser instead), and the keep-alive ping.

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

The `card-meta` edge function is the only metered compute in the design: one invocation per card
page load. At chapter scale that is a rounding error against Netlify's free allowance, but check
the plan's current limits if cards ever see real traffic.

### Netlify functions

Two functions, both optional extras on top of the static site. Neither holds a secret or decides
anything about access; the database still does that.

| Function | Runs | What it does |
| --- | --- | --- |
| `netlify/functions/keep-supabase-awake.ts` | Daily at 00:00 UTC, published deploys only (not previews) | Calls `get_app_config` so the free project never sits idle long enough to pause. Logs success or failure, never the key |
| `netlify/edge-functions/card-meta.ts` | Every `GET /card/<handle>` | Writes the card's title, description, photo and robots rule into `<head>` for link previews; 301s an old handle to the current one; 404 plus `noindex` for a card that isn't live. **Fails open**: on any error, a missing variable, or Supabase taking over 1.5 s, the page is served untouched |

Both read `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the edge function also reads
`VITE_SITE_URL`) **at runtime**, so in Netlify → Site configuration → Environment variables
those three must include the **Functions** scope. "All scopes", the default, does. Values in
`netlify.toml` reach the build only, never a function. With the variables missing, the
keep-alive logs an error naming them and the edge function quietly does nothing.

To check the ping, open the function under **Logs & metrics → Functions** in the Netlify UI and
use **Run now**; its log line says whether Supabase answered.

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

### Content Security Policy

`netlify.toml` carries the CSP. Supabase needs `connect-src https://*.supabase.co
wss://*.supabase.co` and `img-src https://*.supabase.co`. These are scoped to
`supabase.co` — do not relax the policy to `*` to make something load.

Business cards needed no CSP change. Card photos come from the `card-media` bucket under
`img-src https://*.supabase.co`, card fonts from Google Fonts (already allowed), and QR codes and
contact files are generated in the browser, so no new origin is contacted. The `card-meta` edge
function injects only `<title>`, `<meta>` and `<link>` tags, never an inline script, so
`script-src` stays without `'unsafe-inline'`.

`Permissions-Policy` still has `camera=()`. QR check-in is architected for but not built; the
day a scanner ships, that becomes `camera=(self)` and nothing else changes.

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
| Auditability | `admin_audit_log` records role changes, point adjustments, attendance corrections, status changes, code rotations and every officer action on business cards — with actor, timestamp, and reason |
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
  edge-functions/  card-meta: link-preview tags and old-handle redirects on /card/*
docs/              digital-business-cards.md, the business card design
```

The edge function copies two patterns from `features/cards/model.ts` (the handle shape and the
card-media path) rather than importing them, because Netlify bundles it separately and can't
resolve the app's `@/` imports. Change them together.

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

- **QR check-in.** Architected for — a scanner would call the same
  `check_in_to_event` RPC — but not implemented, and `camera=()` stays in the
  Permissions-Policy until it is.
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

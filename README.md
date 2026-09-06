# WashU SHPE

The Washington University in St. Louis chapter of the Society of Hispanic Professional Engineers — public website and member portal.

One React application serves three audiences:

```
PUBLIC WEBSITE          →  prospective members, sponsors, community, alumni
  ↓ Member Login
MEMBER PORTAL (/portal) →  events, check-in, points, history, resources
  ↓ Admin Portal
OFFICER PORTAL (/admin) →  event & attendance management, points, analytics, audit log
```

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
`checkin_attempts` (durable brute-force throttle), `admin_audit_log`.

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
| `VITE_SITE_URL` | recommended | Canonical origin used to build auth redirect URLs |
| `VITE_ALLOWED_EMAIL_DOMAINS` | no | Client-side registration hint; defaults to `wustl.edu` |
| `SUPABASE_SERVICE_ROLE_KEY` | never in the app | Bypasses RLS entirely. Server/CLI use only |

**The anon key is meant to be public.** It identifies the project; it authorises nothing.
Security comes from Supabase Auth plus Row Level Security. The *service role* key is the
opposite: it bypasses RLS completely and must never appear in a `VITE_` variable, in the
repo, or in a browser.

Where secrets live:

| Secret | Where it goes |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` | Netlify → Site configuration → Environment variables |
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
request.

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

`vite.config.ts` **generates** `dist/404.html` with a segment count derived from the base
path, which is the deep-link fallback such a host needs. (A hand-maintained `404.html` used to
sit at the repository root, outside `public/`, so Vite never copied it into `dist` — deep
links and hard refreshes were silently broken. Generating it removes both the copy and the
drift.) Netlify never reaches it, because the `/* → /index.html 200` rewrite handles SPA
routing first.

### Running costs

$0 at chapter scale. Netlify's free tier and Supabase's free tier both have roughly two orders
of magnitude of headroom for ~200 members.

The one thing to plan for: **Supabase pauses free projects after about a week of inactivity**,
and un-pausing is a manual click in the dashboard. Weekly events keep it awake during term;
over summer break it will pause. Either accept that an officer restores it in September, add a
scheduled job that pings the database weekly, or move to Supabase Pro (~$25/month), which also
buys daily backups — worth considering once there are a couple of years of member records in
there.

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
| Auditability | `admin_audit_log` records role changes, point adjustments, attendance corrections, status changes and code rotations — with actor, timestamp, and reason |
| Error messages | Structured codes mapped to member-facing sentences. No SQLSTATE, PostgREST body or stack trace ever reaches a user |
| Public calendar | `anon` reads events through a column-level GRANT plus a row policy (`status <> 'draft' AND is_public`). Organiser contacts, capacity and check-in windows are not in the grant, so they cannot be selected at all |
| Privacy | Member emails, attendance and points are never public. Portal pages are `noindex, nofollow`; page titles are generic |

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

## Project layout

```
src/
  auth/            AuthProvider, useAuth, RequireAuth, RequireRole
  components/
    ui/            Button, Card, Field, Dialog, Toast, Table primitives
    shared/        PageHeader, StatCard, EmptyState, ErrorState, ErrorBoundary
    …              existing public-site components (Navbar, Hero, Contact, …)
  features/        events/, attendance/ — feature-specific components and hooks
  hooks/           usePageMeta, useTerms
  layouts/         PublicLayout, AuthLayout, PortalLayout, AdminLayout
  lib/             supabase, config, datetime, eventStatus, errors, validation, csv, ics
  pages/
    …              public pages (Home, Members, Sponsorship, Leadership, GetPluggedIn)
    auth/          Login, Register, ForgotPassword, ResetPassword
    portal/        Dashboard, Events, EventDetail, CheckIn, Points, History, …
    admin/         AdminDashboard, AdminEvents, AdminAttendance, AdminMembers, …
  services/        Data access, one module per domain. Components never call Supabase directly
  types/           database.ts — the schema, mirrored in TypeScript
supabase/
  migrations/      Schema, RLS, functions
  tests/           pgTAP suites
  seed.sql         Development fixtures (never production)
```

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

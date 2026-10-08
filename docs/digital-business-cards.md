# Digital business cards: implementation plan

Members build their own business card in My SHPE. It's served at
`washushpe.org/card/<handle>`, and that's the URL written to each member's NFC card.

```
NFC card ──tap──▶ https://washushpe.org/card/diego?src=nfc
                          │
                          ▼
            ┌──────────────────────────────┐
            │  (photo)                     │
            │  Diego Gonzalez   he/him     │
            │  WashU SHPE · President  ✔   │  ← ✔ = set by officers, not self-claimed
            │  Washington University in    │
            │  St. Louis · CS '27          │
            │                              │
            │  [ LinkedIn ] [ Email ]      │
            │  [ Phone ]    [ GitHub ]     │
            │  [   Add to Contacts   ]     │
            │                              │
            │  Member of WashU SHPE →      │
            └──────────────────────────────┘
```

Everything here runs on the infrastructure the site already uses: the static bundle on
Netlify, and Supabase (Postgres + RLS + Storage) on the free tiers. It needs no new paid
service and no application server.

> **Status: phases 1–3 are built** (phase 4 remains ideas). The README's *Business cards*
> section describes the feature as shipped. This document is kept as the design record, with
> these changes made during the build and review:
>
> - **Handle moderation is stronger than §5–§6 describe.** Officers can release *any* handle a
>   member holds, current or old (`admin_release_card_handle`; `admin_reset_card_handle` is the
>   current-handle case). A released handle is blocked for that member for good
>   (`card_handle_blocks`, and `check_card_handle` answers `removed`), so it can't simply be
>   claimed back. A deleted member's handles are retired into the reserved list rather than
>   freed if the card was ever live, so their chip never opens a stranger's card; a draft that
>   was never public frees its handle.
> - **Chips:** `admin_list_cards` and `get_my_card` report `chip_handle_active`, so a chip on a
>   released handle shows as needing a rewrite rather than "still redirects".
>   `admin_mark_chips_written` takes the handles from the exported sheet and skips members who
>   renamed since.
> - **Views** count once per card per 30 minutes in a browser, not once per tab session.
> - **Names that fold to no usable handle** (a non-Latin script) get a `member-…` handle instead
>   of being skipped; only blank names are skipped.
> - **Storage:** 30 files per member, no uploads while suspended, and admins can remove a
>   deleted member's photos.
> - A photo the card's design hides is also left out of the contact file and link previews.

---

## 1. The one decision that can't be undone

The URL written to the chip is permanent for practical purposes. Everything else in this
plan (themes, layouts, fields, analytics) can change after the cards ship. The chip URL can't
change unless someone physically rewrites every card.

Recommendation:

- **Write `https://washushpe.org/card/<handle>?src=nfc`.** The path stays as designed. The
  `?src=nfc` lets insights tell taps apart from shared links and QR scans. It adds about 8
  bytes, and an NTAG213 holds about 130.
- **Keep handles forever.** Every handle a member has used stays in `card_handles`, still
  belongs to them, and redirects to their current handle. A member who renames
  `diego` → `diego-gonzalez` keeps a working card. Handles are never given to someone else.
- **Reserve role and brand words now**, so `/card/president` or `/card/shpe` can't be taken
  before we decide what they mean (see §12, role cards).
- **Confirm the cards are blank, rewritable NTAG21x chips.** If the vendor pre-programmed them
  to their own redirect service, that changes the plan.

---

## 2. How it fits the existing architecture

```
                         React SPA (existing bundle)
                                   │
     ┌──────────────────┬──────────┴─────────┬───────────────────┐
     │                  │                    │                   │
 /card/:handle     /portal/card         /admin/cards        (unchanged)
 public, no nav    editor + preview     moderation, switch
     │                  │                    │
     │ get_public_card  │ get_my_card        │ admin_* (audited)
     │ record_card_event│ save_my_card       │
     │ (anon)           │ (approved members) │ (officers)
     └──────────────────┴─────────┬──────────┴───────────────────┘
                                  │
          ┌───────────────────────┼─────────────────────────┐
          │                       │                         │
   member_cards            card_handles             Storage: card-media
   member_card_links       card_daily_stats         (public bucket, owner-
   chapter_positions       card_link_daily_clicks    only writes, ≤2 MB)
   — RLS on, no anon grants; reads and writes go through functions —
```

It follows the conventions the codebase already uses:

- **Tables aren't reachable directly by anon.** Same as `points_leaderboard`: RLS is on and
  public reads go through one `SECURITY DEFINER` function that returns only what a card
  should show. `select *` on a card table as `anon` fails.
- **Writes go through RPCs.** `save_my_card()` validates and writes the card and its links in
  one transaction. Members have no `INSERT`/`UPDATE` grant on the tables, so a tampered request
  has no policy to satisfy.
- **The feature ships off.** An `app_settings` switch `cards_enabled` works like
  `leaderboard_enabled`. Officers turn it on when the cards arrive, and the database enforces
  it.
- **Officer actions are audited** through `write_audit_log()`.
- **Components don't call Supabase.** Everything goes through `src/services/cards.ts`, with
  keys in `queryKeys.ts`.

---

## 3. Staying free

| Piece | Where it runs | Free-tier exposure |
| --- | --- | --- |
| Card page | The existing static bundle on Netlify | Nothing new: it's one more lazy route chunk |
| Card data | Supabase Postgres via RPC | A few KB per member. Anonymous RPC calls are not auth users, so they don't count toward MAU |
| Photos / banners | Supabase Storage, public bucket | ~1 GB storage on free. Images are resized **in the browser** to ≤512 px WebP (~30–80 KB) before upload, because Supabase's server-side image transforms are a paid feature |
| QR codes | Generated in the browser | None. No third-party QR API (that would also need a CSP change) |
| Add to Contacts (.vcf) | Generated in the browser | None |
| Insights | Daily counter rows, no per-visit rows | Bounded: at most members × days × sources |
| Keep-alive ping | Netlify Scheduled Function, daily | A few invocations a month |
| Link previews in iMessage/Slack *(optional, phase 3)* | Netlify Edge Function on `/card/*` | The only metered compute in the design. Tiny at chapter scale, but check the plan's limits |

**The real free-tier risk is Supabase pausing**, not quotas. The README notes that free projects
pause after about a week of inactivity, and summer break is exactly when members tap cards at
internships and career fairs. A paused project means every card shows an error. Fix this in
phase 1, not later:

1. A Netlify Scheduled Function (`netlify/functions/keep-supabase-awake.ts`, daily) calls
   `get_app_config` with the anon key. A daily REST call is the usual workaround. A GitHub
   Actions cron is the obvious alternative, but GitHub disables scheduled workflows in public
   repos after 60 days without activity, which is about the length of summer.
2. The card page handles failure gracefully. If the backend is unreachable, it still shows the
   WashU SHPE brand and a link to `washushpe.org` rather than a blank screen.

Excluded because they cost money: Apple Wallet passes (needs the $99/yr Apple developer
account), server-side image transforms (Supabase Pro), and per-member custom domains.

---

## 4. Data model

New migration: `supabase/migrations/20260914000001_member_business_cards.sql`. It sorts after
the leaderboard migration because this branch is stacked on that PR. The sketch below shows
the shape; the final SQL follows the house style (`set search_path = ''`, comments explaining
*why*).

```sql
-- One card per member. Writes only through save_my_card().
create table public.member_cards (
  member_id        uuid primary key references public.profiles (id) on delete cascade,
  handle           text not null,                 -- current handle; history in card_handles
  is_published     boolean not null default false,
  allow_indexing   boolean not null default false, -- search engines: opt-in, see §9

  -- Moderation (officers only, via admin_set_card_hidden)
  hidden_at        timestamptz,
  hidden_reason    text,

  -- How the card came to exist (§5)
  created_by       uuid references public.profiles (id) on delete set null,
                                                  -- = member_id when they made it themselves
  member_opened_at timestamptz,                   -- member's first save; null = officer-made,
                                                  -- not yet opened
  chip_handle      text,                          -- the handle written to their NFC chip
  chip_written_at  timestamptz,

  -- Identity
  display_name     text not null,                 -- prefilled from profile, editable
  pronouns         text,
  headline         text,                          -- "SWE Intern @ Boeing"
  organization     text default 'Washington University in St. Louis',
  status_line      text,                          -- "Seeking Summer 2027 internships"
  bio              text,                          -- plain text, line breaks only
  location         text,
  skills           text[] not null default '{}',
  languages        text[] not null default '{}',  -- "English", "Español", ...

  -- Media: storage object PATHS, never URLs (see §9)
  avatar_path      text,
  banner_path      text,
  background_path  text,

  -- Live from profile at read time, each opt-in
  show_major             boolean not null default true,
  show_graduation_year   boolean not null default true,
  show_member_since      boolean not null default false,
  show_national_member   boolean not null default true,  -- only if officer-verified
  show_chapter_position  boolean not null default true,

  theme            jsonb not null default '{"preset":"shpe-classic"}',
  sections         jsonb not null default '["status","links","about","education","shpe"]',

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint member_cards_handle_shape
    check (handle ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$'),
  constraint member_cards_theme_valid    check (private.card_theme_is_valid(theme)),
  constraint member_cards_sections_valid check (private.card_sections_are_valid(sections)),
  constraint member_cards_lengths check (
        length(display_name) between 1 and 80
    and coalesce(length(headline), 0)    <= 100
    and coalesce(length(bio), 0)         <= 600
    and coalesce(length(status_line), 0) <= 120
    and cardinality(skills) <= 15 and cardinality(languages) <= 8)
);
create unique index member_cards_handle_key on public.member_cards (handle);

-- Every handle ever claimed. Never reassigned. Old handles redirect to current.
create table public.card_handles (
  handle     text primary key,                -- lowercase, same shape check as above
  member_id  uuid not null references public.profiles (id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create table public.reserved_card_handles (handle text primary key, reason text);

-- Links, ordered. Email and phone live here too so members can order them freely.
create type public.card_link_kind as enum (
  'linkedin','github','email','phone','website','portfolio','resume','instagram',
  'x','tiktok','youtube','handshake','devpost','calendly','discord','custom');

create table public.member_card_links (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.member_cards (member_id) on delete cascade,
  kind        public.card_link_kind not null,
  label       text,                            -- override; default label comes from kind
  value       text not null,                   -- https URL, email, or phone
  sort_order  integer not null,
  is_featured boolean not null default false,  -- rendered as the big primary button
  is_visible  boolean not null default true,
  constraint member_card_links_value check (case kind
    when 'email' then value ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    when 'phone' then value ~  '^\+?[0-9 ().-]{7,20}$'
    else              value ~* '^https://[^\s]+$'   -- https only; no javascript:, data:, http:
  end),
  constraint member_card_links_label_len check (coalesce(length(label), 0) <= 40)
);
-- save_my_card() caps a card at 20 links.

-- Officer-assigned titles. The only source of the ✔ "WashU SHPE · President" line.
create table public.chapter_positions (
  member_id  uuid primary key references public.profiles (id) on delete cascade,
  title      text not null check (length(btrim(title)) between 2 and 60),
  sort_order integer not null default 100,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now()
);

-- Insights: daily counters, no IPs, no user agents, no per-visit rows.
create table public.card_daily_stats (
  member_id uuid not null references public.member_cards (member_id) on delete cascade,
  day       date not null,
  source    text not null check (source in ('nfc','qr','link')),
  views     integer not null default 0,
  saves     integer not null default 0,   -- Add to Contacts
  shares    integer not null default 0,
  primary key (member_id, day, source)
);
create table public.card_link_daily_clicks (
  link_id uuid not null references public.member_card_links (id) on delete cascade,
  day     date not null,
  clicks  integer not null default 0,
  primary key (link_id, day)
);

-- All of the above: RLS on, zero policies, and revoke all from anon/authenticated
-- (Supabase's default privileges grant ALL on new tables, so the revoke is required, as
-- in the leaderboard migration). No client role reads or writes these tables directly:
-- the editor reads through get_my_card() and writes through save_my_card().

insert into public.app_settings (key, value, description) values
  ('cards_enabled', 'false'::jsonb, 'Whether member business cards are live at /card/<handle>.')
on conflict (key) do nothing;
-- and add 'cards_enabled' to get_app_config()'s key list.
```

**Storage.** Create a `card-media` bucket: public, `file_size_limit` 2 MB,
`allowed_mime_types` webp/jpeg/png. Policies on `storage.objects` allow insert, update and
delete only when `(storage.foldername(name))[1] = auth.uid()::text` and the caller is an
approved member. Paths are `card-media/<member_id>/<uuid>.webp`, so they're unguessable.
Put this in its own migration with an `if exists (select 1 from pg_namespace where nspname =
'storage')` guard, so the PGlite pgTAP harness (which has no storage schema) still applies
every migration.

**Why the links are a child table and not a jsonb array:** CHECK constraints validate each
link for free, and insights need stable link ids. That's also why `save_my_card()` **upserts
links by id** rather than deleting and reinserting them. Reinserting would reset every link's
click history on every save.

---

## 5. Getting a card: My Card, or an officer sets one up

A card can come to exist in two ways. Both produce the same row and follow the same handle
rules, so nothing downstream cares which one happened.

**1. The member opens My Card.** The handle field is pre-filled with a suggested handle (see
below). The member keeps it or edits it, availability is checked live, and saving claims it.

**2. An officer creates it for them.** This is for members who haven't opened My Card yet,
usually just before card-writing night, so every chip can be programmed on the spot.

- **One member:** a **Create card** button on that member's row in Admin → Cards, and on
  their member detail page. It shows the suggested handle, which the officer can change.
- **Everyone at once:** **Create cards for everyone missing one.** It first shows a preview of
  every eligible member and the handle each would get, and writes nothing until the officer
  confirms. Eligible means an approved member with `active` status and no card. Members with
  no name on their profile are skipped and listed separately rather than given a meaningless
  handle.
- **What an officer-made card contains:** the member's name from their profile, the school,
  and nothing else personal. No email, phone, links, photo or bio. Officers can't add those;
  only the member can.
- **Published or not:** the officer chooses with one checkbox. The default is unpublished.
  - *Unpublished:* tapping the chip shows the standard "card not available" page until the
    member publishes.
  - *Published as a starter card:* shows the name, school, major and class year, verified
    chapter position if they have one, an Add to Contacts button (name, organization and card
    link only), and the SHPE footer. A chip handed out at card night then works immediately,
    even if its owner never logs in.
- Officers can create cards while the `cards_enabled` switch is still off, so everything is
  ready before launch.

**When the member opens My Card afterwards**, the editor loads the officer-made card rather
than a blank form. A banner explains what happened: *"An officer set up your card on Oct 20.
Your NFC card points to washushpe.org/card/diego-gonzalez. Add your links and publish it."*
The portal dashboard shows the same prompt until they open it. Their first save sets
`member_opened_at`. If they change the handle, the editor reminds them that their chip points
to the old one. The old handle keeps redirecting, so nothing breaks.

### Suggested handles

The suggestion comes from one SQL function, `private.suggest_card_handle(member)`. The My Card
pre-fill (via `suggest_my_card_handle()`) and officer creation both call it, so there's one
implementation and the TypeScript and SQL can't drift apart.

1. **Start from the first word of the first name and the first word of the last name**,
   lowercased. Diego Gonzalez → `diego-gonzalez`. María José García López → `maria-garcia`.
2. **Fold accents with an explicit `translate()` map** (á→a, ñ→n, ç→c, ü→u, and so on)
   rather than the `unaccent` extension. That avoids an extension dependency and keeps the
   function working in the PGlite test harness. Anything else outside `a-z0-9` becomes a
   hyphen, repeated hyphens collapse, and the result is trimmed to 30 characters at a hyphen.
3. **If that's taken, reserved, or in another member's handle history**, try these in order:
   the full name if it fits (`maria-jose-garcia-lopez`), then the class year
   (`diego-gonzalez-27`), then `-2`, `-3`, and so on.
4. **Never use the email address.** `d.gonzalez` would publish the member's wustl.edu
   username, and member emails are never public.

If two officers run bulk creation at once, or a member claims a handle mid-run, the unique key
on `card_handles` settles it. The bulk run moves on to that member's next candidate handle
instead of failing the whole batch.

### Card-writing night

1. An officer runs **Create cards for everyone missing one**, checks the preview, and
   confirms.
2. They export the **NFC programming sheet**: name, handle and the exact chip URL.
3. They write and password-protect the chips.
4. They select the rows they wrote and click **Mark chips written**. That records
   `chip_handle` and `chip_written_at`, so the admin list shows who still needs a chip and
   each member's editor knows which address their chip carries.

---

## 6. Database functions

| Function | Who may call it | What it does |
| --- | --- | --- |
| `get_public_card(handle)` | anon, authenticated | Returns `{status:'ok', card}`, where `card` is `PublicCardData` (links, education and SHPE facts nested inside it; officer-made cards nobody has opened carry `is_starter: true`), `{status:'redirect', handle}` for an old handle, or `{status:'not_found'}`. Unpublished, hidden, pending, suspended, feature-off and nonexistent cards all return the **same** `not_found`, so unpublished handles can't be probed |
| `get_my_card()` | approved members | Own card including drafts and links, for the editor |
| `suggest_my_card_handle()` | approved members | The My Card pre-fill, from `private.suggest_card_handle` (§5) |
| `check_card_handle(handle)` | approved members | `available` / `yours` / `taken` / `reserved` / `removed` / `invalid`. Not available to anon, so the namespace can't be enumerated |
| `save_my_card(card jsonb, links jsonb)` | approved members | Validates everything and upserts the card and links in one transaction. On a handle change, records the old handle in `card_handles`. Capped at 5 handles per member, ever. The member's first save sets `member_opened_at` |
| `set_my_card_published(bool)` | approved members | Publishes or unpublishes |
| `record_card_event(handle, event, source, link_id?)` | anon, authenticated | Increments a daily counter. Unknown handles and events are ignored silently. Owners viewing their own card aren't counted |
| `get_my_card_insights(days)` | approved members | Views by source, saves, shares, clicks per link |
| `admin_list_cards()` | officer | Every approved member, **including those without a card**, with card status, chip status and 30-day views |
| `admin_create_card(member, handle?, publish)` | officer | Creates a card for one member who doesn't have one: name and school only. The handle defaults to the suggestion; `publish` makes it a starter card. Audited |
| `admin_create_missing_cards(publish, dry_run)` | officer | The bulk version, for every eligible member without a card. `dry_run` returns the proposed handles and the skipped members without writing anything. The real run writes one audit entry with the count |
| `admin_mark_chips_written(members[], handles[])` | officer | Records the handle each member's chip carries (the exported one, skipping members who renamed since) and when it was written; audited |
| `admin_set_card_hidden(member, hidden, reason)` | officer | Moderation. A reason is required; audited |
| `admin_release_card_handle(member, handle, reason)` | officer | Releases any handle the member holds, current or old, and blocks it for them for good; releasing the current one assigns their next suggested handle; audited |
| `admin_reset_card_handle(member, reason)` | officer | Releases the current handle (the case above); audited |
| `admin_set_chapter_position(member, title)` | officer | Sets or clears the verified position; audited |
| `admin_set_cards_enabled(bool)` | officer | The feature switch, as a boolean-only setter (same reasoning as `admin_set_leaderboard_enabled`); audited |

Which cards resolve: membership status `active`, `alumni` or `inactive`. Alumni keeping their
card is a feature: it's the alumni network. Status `pending` or `suspended` returns
`not_found`, as does a card an officer has hidden.

---

## 7. Customization

The aim is a lot of control with no raw CSS and no raw HTML. Members choose from validated
options. The theme is a jsonb document checked by `private.card_theme_is_valid()` in the
database and mirrored by a Zod schema in `src/lib/validation.ts`. Unknown keys are rejected.
Colors must match `^#[0-9a-f]{6}$`. Everything else comes from a fixed list.

```jsonc
{
  "preset": "shpe-classic",            // starting point; anything below overrides it
  "layout": "banner",                  // classic | banner | split | minimal | badge |
                                       // profile | editorial | studio | layered |
                                       // letterhead | monogram
  "colors": {
    "background": "#0b1f3a", "surface": "#ffffff", "text": "#1b365d",
    "muted": "#4b5563", "accent": "#e84e1b", "accentText": "#ffffff"
  },
  "background": { "type": "gradient", "from": "#1b365d", "to": "#e84e1b", "angle": 135 },
                                       // solid | gradient | image (+ dim 0–80%) | pattern
  "font":    { "heading": "libre-franklin", "body": "inter" },
  "buttons": { "shape": "pill", "style": "filled", "arrangement": "list", "icons": true,
               "primary": "accent" },
                                       // shape: pill|rounded|square
                                       // style: filled|outline|soft|glass|hairline
                                       // arrangement: list | icon-grid | rows | compact | grouped
                                       // primary: accent | ink (Add to Contacts' fill)
  "avatar":  { "shape": "circle", "ring": true },  // circle | rounded | square | hidden
  "density": "comfortable"             // compact | comfortable | spacious
}
```

> **The professional collection** (`20260916000001_card_design_collection.sql`) added six
> presets, each with a layout of its own, and the options above they are built from. The
> migration only lengthens the lists in `card_theme_is_valid()`: every stored theme stays
> valid and renders as before, because missing fields come from the preset.
> `cardThemeSql.test.ts` fails if those lists and `model.ts` ever disagree.

**What members can customize:**

| Area | Options |
| --- | --- |
| Presets | Two collections in the gallery, each preset drawn as a miniature of its own layout with the member's name in it. **Professional:** Executive (navy, ivory and bronze; portrait beside the name, contact rows, a navy main button), Editorial (serif name under a running head, spacious, numbered rows; a two-page spread on desktop), Studio (white and graphite with one accent; compact header, links grouped into work, professional and social), Slate (charcoal with muted blue; every block on a raised panel), Heritage (ivory, crimson and navy; the school or employer at the top like a letterhead, two columns of hairline buttons), Signature (the name or initials set large, fine rules, one accent; photo optional). **Originals:** SHPE Classic (navy and orange), Sunrise (orange to gold gradient), Midnight (dark), Paper (minimal white), WashU (red and green), Engineer (monospace, blueprint grid), Glass (photo background with frosted card). One click applies a preset and the preview updates at once; every setting can then be adjusted, and "Reset to …" puts the preset's own settings back. Content and photos are never touched |
| Layout | Classic (centered photo), Banner (cover image with overlapping photo), Split (left-aligned, desktop two-column), Minimal (no photo, typographic), Badge (conference lanyard look), Profile (portrait beside the name), Editorial (running head, large serif name, desktop two-column), Studio (compact header with tags, desktop two-column), Layered (blocks on raised panels), Letterhead (affiliation above the name), Monogram (name or initials as the centerpiece). Long names step down in size in the professional layouts, and anything missing collapses with no stray rules or gaps. The composition rules live in one table, `LAYOUT_SPECS` in `src/features/cards/layouts.ts` |
| Colors | Six theme colors with native color pickers. **The editor blocks saving below WCAG AA contrast** (4.5:1 for text, 3:1 for large text and buttons) and suggests the nearest passing shade |
| Background | Solid, two-stop gradient with angle, uploaded photo with a dim slider, or a pattern from the brand set |
| Type | 16 curated Google Fonts, loaded only on card pages; each professional preset pairs a name face with a text face (Source Serif 4 / Source Sans 3, Instrument Serif / Instrument Sans, Plus Jakarta Sans / Inter, Manrope / Inter, EB Garamond / Libre Franklin, Cormorant Garamond / Inter). `fonts.googleapis.com` and `fonts.gstatic.com` are already in the CSP |
| Buttons | Add to Contacts' color (the accent, or the text color for a quieter, more formal button), shape, style (including Hairline: a fine edge and the text color), arrangement (list, icon grid, rows with each link's address underneath, two columns of compact buttons, or cards grouped into work, professional and social), icons on or off, one **featured** link rendered as a large primary button (e.g. résumé or "Book a coffee chat") |
| Photo | Upload with a square crop, shape, accent ring. Optional banner (3:1 crop) |
| Content blocks | Reorderable and hideable: **Currently** (status line), **About**, **Links**, **Education** (major and class year, live from profile), **SHPE** (verified position, member since, verified National member badge), **Skills** (tags), **Languages** ("Hablo español" matters at a SHPE event), **Featured** |
| Links | 16 kinds with icons and smart inputs. Typing `diego-gonzalezz` in the LinkedIn field becomes `https://www.linkedin.com/in/diego-gonzalezz`. Custom label per link, reorder, hide without deleting |
| Handle | Self-chosen, availability checked live. Suggested as `firstname-lastname`, because a chapter will have more than one Diego |
| Fixed elements | **Add to Contacts** and the small "Member of WashU SHPE" footer are always present. The footer protects the brand and turns every tap into a recruiting link |

Reordering uses up/down buttons (keyboard and screen-reader friendly, no new dependency).
Drag-and-drop can come later.

The theme becomes CSS custom properties on the card root (`--card-accent`, ...), set only from
validated values. Beyond the six colors there are derived tokens: `--card-primary` and
`--card-primary-text` (the main button), `--card-raised` (a panel, the card a shade toward the
text color) and `--card-border` / `--card-rule-strong`. The contrast checks cover each one: an ink
main button is the text pairing reversed, and in a panel layout text is also checked against the
raised panels. One `BusinessCard` component renders the public page **and** the editor's
live preview, so the preview always matches what the public sees.

---

## 8. Add to Contacts (vCard)

`src/features/cards/vcard.ts` builds a vCard 3.0 file. Version 3.0 is the one iOS handles
most reliably.

- `FN`, `N`, `ORG` (organization plus "WashU SHPE"), `TITLE` (headline or verified position),
  `EMAIL`, `TEL;TYPE=CELL`, `URL` for websites and the card itself, `X-SOCIALPROFILE` for
  LinkedIn, GitHub and similar, and `NOTE: Met via WashU SHPE · washushpe.org/card/diego`.
- `PHOTO;ENCODING=b;TYPE=JPEG`: the avatar re-encoded to a ~200 px JPEG so the contact
  arrives with a face.
- Done properly: escape `\ , ;` and newlines, CRLF line endings, fold lines at 75 octets, and
  unit-test all of it. Getting these wrong produces contacts that import with broken fields.
- Delivered as a `Blob` download named `diego-gonzalez.vcf` with type `text/vcard`. Modern iOS
  Safari and Android Chrome both open the contact sheet for this. **Verify on real devices in
  phase 1.** If iOS turns out to be unreliable, the fallback is a tiny Netlify Function
  serving the same text with `Content-Disposition: attachment`.

---

## 9. Privacy and security

This is the chapter's domain, so anything on a card looks official.

| Concern | How it's handled |
| --- | --- |
| Impersonating an officer | Members can't claim a position. The ✔ "WashU SHPE · President" line comes only from `chapter_positions`, set by officers. A self-written headline renders as plain text with no badge |
| Impersonating a member | Handles are first-come, but officers can hide a card or reset a handle, both audited. Only approved members (wustl.edu, let in by join code or an officer) can create cards at all |
| XSS | No HTML or markdown anywhere: all text renders as React text. Links must be `https://` (CHECK constraint), plus app-built `mailto:`/`tel:`, and every href passes through `safeExternalHref` at render time as well |
| CSS / tracking injection | No raw CSS. Colors are hex-validated. Background and avatar images are **storage paths**, and the client builds the URL from `VITE_SUPABASE_URL`, so a card can't load an arbitrary third-party URL (tracking pixel, offensive image host) |
| Photo privacy | Browser re-encoding strips EXIF, including GPS location from phone photos |
| Contact details | Everything on a card is public, and the editor says so plainly next to the phone and email fields. Card email and phone are separate from the account email. Contact details are never copied from the profile, by the editor or by an officer; the member enters them |
| Officer-made cards | An officer can create a card and choose to publish a starter version, but it only ever contains name, school, major, class year and verified position. Officers can't add contact details, links, photos or text. After creation, their only powers over the card are hide and handle reset |
| Search engines | Cards are `noindex` by default. "Let search engines find my card" is opt-in, because a student's phone number showing up in Google is a bad default |
| Probing | Unpublished, hidden and nonexistent cards look identical (§6). Handle checks require sign-in |
| Inflated stats | `record_card_event` only increments a number; at worst someone inflates their own views. The client counts one view per card per 30 minutes in a browser, and owner views aren't counted. Acceptable at these stakes |
| Chip tampering | An unlocked NFC chip can be overwritten by any phone, turning a member's card into a phishing link under SHPE's name. **Password-protect each chip after writing** (NTAG21x supports a 32-bit write password, and NFC Tools can set it). This blocks strangers while officers can still reprogram. Permanent locking also works, because handles never break |
| CSP | No changes needed. `img-src https://*.supabase.co` and Google Fonts are already allowed |

---

## 10. Pages and files

```
src/
  features/cards/
    BusinessCard.tsx        the one renderer (public page and editor preview)
    blocks/                 Header, Links, About, Education, Shpe, Skills, Languages, Footer
    themes.ts               presets, theme → CSS variables, contrast checks
    linkKinds.ts            catalog: icon, label, placeholder, normalize(input) → URL
    brandIcons.tsx          all brand marks in one module (easy to swap out later)
    vcard.ts                vCard 3.0 builder
    qr.ts                   QR → SVG/PNG, theme-colored, encodes ?src=qr
    imageUpload.ts          crop → resize (canvas) → WebP → storage
    webNfc.ts               "Write to my card" for Chrome on Android (progressive enhancement)
    __tests__/              vcard, themes/contrast, linkKinds, handle rules
  services/cards.ts         all RPC calls; keys in queryKeys.ts
  pages/card/PublicCard.tsx /card/:handle (full-screen, no Navbar, own minimal layout)
  pages/portal/MyCard.tsx   editor: Content · Links · Design · Share · Insights
  pages/portal/Dashboard.tsx  + "Your card is ready, finish it" prompt for officer-made cards
  pages/admin/AdminCards.tsx
  pages/admin/AdminMemberDetail.tsx  + Create card button
  types/database.ts         card types (mirrored by hand, same commit as the migration)
  lib/validation.ts         card + theme Zod schemas
netlify/functions/keep-supabase-awake.ts
supabase/migrations/20260914000001_member_business_cards.sql
supabase/migrations/20260914000002_card_media_storage.sql
supabase/tests/cards.test.sql
```

**Public page `/card/:handle`.** It sits outside `PublicLayout` because a card shouldn't show
the site navbar. It handles every response state: `ok`, `redirect` (replace the URL so old
NFC links land on the current handle), a friendly `not_found` that links to the chapter site,
and backend-unavailable. `usePageMeta` sets the title (here the member *chose* to publish
their name, unlike portal pages, which stay generic) and sets `noindex` unless
`allow_indexing` is on. Performance target: interactive in under 1.5 s on mid-range 4G, since
someone is standing in front of the member waiting. `supabase-js` already loads with every
page (via `AuthProvider`), so the card adds only its own chunk.

**Editor `/portal/card`** (nav label "My Card", lucide `IdCard`):

- **Content**: handle (live availability check), name, pronouns, headline, status, bio,
  skills, languages, photo and banner upload, and profile-field toggles. A "Start from my
  profile" button fills in what's already known.
- **Links**: add from the kind picker, smart inputs, reorder, feature one, hide.
- **Design**: preset gallery, then layout, colors with contrast warnings, background, fonts,
  buttons, photo shape, block order.
- **Share**: copy link, native share sheet (`navigator.share`), QR download (SVG/PNG),
  **Write to my NFC card** on Android Chrome (Web NFC), iPhone instructions using the NFC
  Tools app, and a test download of the vCard.
- **Insights**: views split by NFC, QR and shared link; contact saves; clicks per link; 7 and
  30 days.
- A live phone-frame preview sits beside the form on desktop and opens as a toggle sheet on
  mobile. There's a publish switch, a banner if an officer has hidden the card (with the
  reason), and an unsaved-changes guard.
- On first visit with no card, the handle is pre-filled from `suggest_my_card_handle()`. If an
  officer already made the card, the editor opens it with the "An officer set up your card"
  banner from §5. Changing a handle that's on a written chip shows a reminder that the chip
  will keep working through the redirect.

**Admin `/admin/cards`:**

- The feature switch, which ships off. Officers can preview before turning it on.
- A table of **every approved member**, not just those with cards. Columns: name, handle, card
  status (*No card*, *Set up by officer, not opened*, *Member set up*, *Published*, *Hidden*),
  chip (*written* with date, or *not yet*), 30-day views. Filters for "no card" and "no chip
  yet".
- Row actions: **Create card** for members without one, hide/unhide (reason required), handle
  reset.
- **Create cards for everyone missing one**, which shows a preview dialog (proposed handles,
  skipped members and why, and the "publish as starter cards" checkbox) before anything is
  written.
- **NFC programming sheet**: a CSV export of name, handle and exact chip URL for card-writing
  night, built with the existing `lib/csv.ts`. Then **Mark chips written** on the selected
  rows.
- Verified positions editor, which could later feed the Leadership page instead of
  `leaders.json`.

---

## 11. Testing

**pgTAP `supabase/tests/cards.test.sql`.** Run it through the PGlite harness when Docker is
off. Cases:

- anon can't select any card table; `get_public_card` is the only way in.
- `not_found` is identical for unpublished, hidden, pending, suspended, feature-off and
  nonexistent cards.
- An old handle returns `redirect` to the current one; old handles can't be claimed by others;
  the 5-handle cap holds.
- Reserved handles and malformed handles are rejected.
- Member A can't read or modify member B's card or links, or upload into B's storage folder.
- `javascript:`, `data:` and `http:` link values are rejected; an invalid theme (bad hex,
  unknown key, unknown layout) is rejected.
- A member can't set a chapter position; officer actions write audit rows.
- Saving links preserves ids, so click history survives a save.
- Owner views aren't counted.
- Suggested handles: accents fold (`José Peña` → `jose-pena`); compound names shorten
  (`maria-garcia`); collisions fall through full name → class year → `-2`; reserved handles
  and other members' old handles are skipped; nothing is ever derived from the email.
- Only officers can call `admin_create_card`, `admin_create_missing_cards` and
  `admin_mark_chips_written`; a member gets 42501.
- Bulk creation skips pending members, members who already have a card, and members with no
  name, and reports each. `dry_run` writes nothing. A handle collision mid-run moves that
  member to their next candidate without failing the batch.
- An officer-made card, published or not, has no links, email, phone, photo or bio, and a
  starter card's public payload contains only the allowed fields.
- The member's first save sets `member_opened_at`. After a rename, `chip_handle` still
  redirects to the current handle.

**Vitest:**

- vCard escaping, folding and CRLF.
- Theme → CSS variables, and the contrast checker.
- Link normalization (`@diego` → `https://github.com/diego`).
- Handle rules match the SQL regex.
- `BusinessCard` renders every block and layout.
- `PublicCard` handles all four response states.

**Build check: `npm run build`**, not just `tsc --noEmit`.

**Device matrix before card night:**

- iPhone tap → page → Add to Contacts (Safari).
- Android tap → page → contacts (Chrome).
- Web NFC write on Android.
- Older iPhone using the Control Center NFC reader.
- Lighthouse mobile score of at least 90 on a real card.

---

## 12. Phases

**Phase 1: ready before the cards arrive (MVP).** This locks the URL, so it goes first.

- [x] Migrations: cards, handles (with history and reserved list), links, positions, stats
      tables, `cards_enabled`, storage bucket and policies
- [x] All §6 functions; `get_app_config` gains `cards_enabled`
- [x] `cards.test.sql`
- [x] `types/database.ts`, `services/cards.ts`, query keys, Zod schemas
- [x] `BusinessCard` with Classic layout, 3–4 presets and an accent color
- [x] `/card/:handle` with all states and redirect handling
- [x] vCard with photo; verified on iOS and Android
- [x] Editor: suggested handle, content, links, photo upload, preset + accent, publish
- [x] Share tab: copy link, QR
- [x] Admin: switch, all-members table, hide/reset, positions, programming-sheet CSV
- [x] Officer-made cards: Create card per member (Admin → Cards and member detail), bulk
      create with preview, starter-card option, Mark chips written
- [x] "An officer set up your card" banner in the editor and prompt on the dashboard
- [x] `keep-supabase-awake` scheduled function
- [x] README: functions table, data model, security model rows, chapter configuration

**Phase 2: full customization**

- [x] Banner, Split, Minimal and Badge layouts; banner upload
- [x] Gradient, photo and pattern backgrounds; font catalog; button shapes, styles and
      arrangement; photo shapes
- [x] Reorderable blocks; Currently, Skills, Languages and Featured blocks
- [x] Contrast enforcement with suggested fixes; theme-colored QR
- [x] All seven presets

**Phase 3: distribution and insights**

- [x] Event counters and the Insights tab
- [x] Web NFC "Write to my card" (Android Chrome), native share sheet
- [x] Search-indexing opt-in
- [x] *(Optional)* Netlify Edge Function on `/card/*` that injects per-card `og:title`,
      `og:description` and `og:image` into `index.html`, so shared links show rich previews in
      iMessage, LinkedIn and Slack. It must fail open: if Supabase is slow, serve the plain
      page

**Phase 4: stretch ideas**

- Bilingual cards: an optional Spanish headline and bio with an EN/ES toggle on the card
- Contact exchange: a visitor leaves their details for the member. This stores strangers' data
  and attracts spam, so it ships off and with care
- Role cards: `/card/president` always resolves to whoever currently holds the position, so an
  officer's chip passes to their successor
- Leadership page sourced from `chapter_positions`
- "Where I'll be next": a block showing the member's upcoming public SHPE events
- Google Wallet pass (free, but needs a Google Cloud issuer account)

---

## 13. Open questions

1. **Chips:** blank, rewritable NTAG213/215? Does anything besides the chip go on the
   physical card, such as a printed QR for phones without NFC?
2. **Who writes the chips:** officers at a card-writing night (officer-made cards make this
   possible for everyone), members themselves, or both? And do we password-protect or
   permanently lock them?
3. **Officer-made cards:** publish them as starter cards right away, so every chip works the
   day it's handed out, or leave them unpublished until the member publishes? This plan
   defaults to unpublished, with a checkbox to publish.
4. **Eligibility:** all approved members from day one, or officers first as a pilot? Should
   alumni keep live cards (recommended)?
5. **Path:** is `/card/` final? A shorter `/c/` saves bytes but reads worse. This is the one
   decision that can't be revisited.
6. **Handle claims:** first-come with officer moderation (recommended), or officer approval
   before a card publishes?

-- =============================================================================
-- Security audit remediation
--
-- Five database-side fixes from an adversarial audit. Each was reproduced
-- against a running database before being fixed; none was theoretical.
-- =============================================================================


-- ── 1. Stop the domain allowlist answering questions ────────────────────────
--
-- assert_email_domain_allowed() raises on a disallowed address and returns
-- quietly on an allowed one. Executable by anon, that is a binary oracle over
-- manual_email_allowlist -- the officer-curated list of individuals onboarded
-- outside the standard domain. Measured against a local database with one
-- address allowlisted:
--
--     POST /rpc/assert_email_domain_allowed {"p_email":"someone@gmail.com"}
--       -> HTTP 204   (allowlisted)
--     POST /rpc/assert_email_domain_allowed {"p_email":"nobody@gmail.com"}
--       -> HTTP 400   (not allowlisted)
--
-- app_settings has an officer-only SELECT policy precisely so this list stays
-- private; the function handed it out to anyone who could guess an address.
--
-- Nothing legitimate calls it from a client. handle_new_user() and the new
-- trigger below both run as the definer, which is unaffected by this revoke.

revoke execute on function public.assert_email_domain_allowed(text)
  from public, anon, authenticated;


-- ── 2. Apply the domain policy to email *changes*, not just signups ─────────
--
-- The allowlist was enforced once, on INSERT into auth.users. The companion
-- trigger for address changes only mirrored the new address into profiles, so
-- a member could move their account off the chapter domain after the fact and
-- keep indefinite access.
--
-- Three guards matter here, and the obvious version of this trigger gets all
-- three wrong:
--
--   is distinct from  -- GoTrue writes auth.users rows for confirmation
--                        timestamps and token churn. Firing on every write
--                        that merely touches the column would lock an
--                        already-onboarded off-domain member out of routine
--                        auth operations.
--
-- The obvious exemption -- skip when auth.uid() is null, so service_role and
-- migrations pass -- is WRONG here, and quietly so. Verified against a running
-- database: GoTrue stages an address change in auth.users.email_change and only
-- writes the email column when the member clicks the confirmation link. That
-- request carries no JWT, so auth.uid() is null at exactly the moment the
-- trigger fires, and the guard would skip the path it exists to defend:
--
--     select set_config('request.jwt.claims', '', true);
--     update auth.users set email = 'someone@gmail.com' where ...;
--     -> CHANGE APPLIED, guard did not fire
--
-- So the check runs by default and privileged callers opt out explicitly. A
-- session GUC is the right shape: only someone with SQL access can set it, it
-- is scoped to a transaction with `set local`, and it makes the bypass legible
-- in the migration or console session that performs it.

create or replace function public.assert_email_change_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email
     -- Officer remediation, when it happens through an authenticated session.
     and not (auth.uid() is not null and public.is_officer(auth.uid()))
     -- Deliberate console/migration override:
     --   set local app.allow_email_domain_change = 'on';
     and coalesce(
           nullif(current_setting('app.allow_email_domain_change', true), ''),
           'off'
         ) <> 'on'
  then
    perform public.assert_email_domain_allowed(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_change_guard on auth.users;
create trigger on_auth_user_email_change_guard
  before update of email on auth.users
  for each row execute function public.assert_email_change_allowed();


-- ── 3. One real mailbox, one account ────────────────────────────────────────
--
-- The check-in throttle is keyed on member_id, which is correct -- a
-- chapter-wide ceiling would let any member deny check-in to everyone else
-- during a GBM by burning it deliberately. But a per-member limit only bounds
-- an attacker if accounts are scarce, and plus-addressing made them free:
-- me+001@wustl.edu ... me+999@wustl.edu all deliver to one mailbox, so guessing
-- capacity scaled linearly with however many accounts someone cared to
-- register.
--
-- Normalising strips the +tag from the local part only. Note the obvious
-- expression is wrong: split_part(lower(email), '+', 1) || '@' || domain turns
-- "ana@wustl.edu" into "ana@wustl.edu@wustl.edu", because an address with no
-- plus sign has no first segment to take. The local part has to be isolated
-- before the +tag is stripped.

alter table public.profiles
  add column if not exists email_normalized text
  generated always as (
    split_part(split_part(lower(email), '@', 1), '+', 1)
    || '@' ||
    split_part(lower(email), '@', 2)
  ) stored;

create unique index if not exists profiles_email_normalized_key
  on public.profiles (email_normalized);

comment on column public.profiles.email_normalized is
  'Lowercased address with any +tag stripped from the local part. Unique, so '
  'one mailbox maps to one profile: handle_new_user() rolls the signup back on '
  'collision, which is the behaviour it was already written for.';


-- ── 4. Count throttled requests without creating a write channel ────────────
--
-- checkin_attempts only records guesses that were actually evaluated. Once the
-- throttle trips, further requests return RATE_LIMITED and write nothing, so
-- an officer reviewing the log sees a flat 8-per-window and cannot tell
-- sustained automated guessing from a member fumbling a code.
--
-- Logging one checkin_attempts row per throttled request would fix the blind
-- spot by creating a worse problem: an unbounded, attacker-controlled write
-- channel on a 500 MB database, which is exactly the storage exhaustion the
-- retention work exists to prevent.
--
-- A counter bounded by (member, window) instead. 80,000 throttled requests
-- become one row with rejected = 79,992 rather than 80,000 rows.

create table if not exists public.checkin_throttle_hits (
  member_id    uuid not null references public.profiles (id) on delete cascade,
  window_start timestamptz not null,
  rejected     integer not null default 0,
  primary key (member_id, window_start)
);

alter table public.checkin_throttle_hits enable row level security;

/*
 * Revoke before granting. Supabase sets default privileges that hand ALL
 * privileges on a newly created public table to anon and authenticated, so a
 * table added in a later migration does not inherit the lockdown that
 * 20260906000003 applied with `revoke all on all tables ... from anon,
 * authenticated`. Without this, anon lands with INSERT/UPDATE/DELETE/TRUNCATE
 * here -- checked with information_schema.role_table_grants, which showed
 * exactly that before this revoke was added.
 *
 * RLS would still refuse the writes, since no write policy exists. The grant
 * is the second lock: rows are filtered by policy, columns and verbs by grant,
 * and this table should match checkin_attempts, which carries a single
 * `authenticated | SELECT`.
 */
revoke all on public.checkin_throttle_hits from public, anon, authenticated;
grant select on public.checkin_throttle_hits to authenticated;

create policy checkin_throttle_hits_select_officer on public.checkin_throttle_hits
  for select to authenticated
  using (public.is_officer(auth.uid()));

create index if not exists checkin_throttle_hits_window_idx
  on public.checkin_throttle_hits (window_start desc);

create or replace function public.record_throttled_checkin(p_member uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_member is null then
    return;
  end if;
  insert into public.checkin_throttle_hits (member_id, window_start, rejected)
  values (p_member, date_trunc('hour', now())
                    + floor(extract(minute from now()) / 10) * interval '10 minutes', 1)
  on conflict (member_id, window_start)
  do update set rejected = public.checkin_throttle_hits.rejected + 1;
end;
$$;

revoke execute on function public.record_throttled_checkin(uuid)
  from public, anon, authenticated;


-- ── 5. Narrow the pre-event guessing window, asymmetrically ────────────────
--
-- check_in_with_code hashes a submitted code against every candidate event in
-- a window, so one guess gets as many chances as there are candidates, and a
-- correct code confirms itself days before check-in opens.
--
-- The tempting fix -- only consider events whose check-in window is open right
-- now -- breaks three behaviours checkin.test.sql asserts on this exact
-- function: a correct code before the window must answer CHECKIN_NOT_OPEN, a
-- correct code after it CHECKIN_CLOSED, and a cancelled event
-- EVENT_CANCELLED. All three would collapse to INVALID_CODE, which is the
-- wrong answer to give someone holding a valid code.
--
-- Asymmetry keeps both properties. Past events stay at -4 days: their codes
-- are already spent, so CHECKIN_CLOSED leaks nothing worth having. Future
-- candidacy tightens to the day of the event, which still lets a member
-- arriving early hear "check-in opens at 6:45 PM" while cutting the
-- pre-event guessing ceiling roughly four-fold.
--
-- Both entry points also now record throttled requests, so the volume of a
-- brute-force campaign is visible rather than being flattened to the limit.

create or replace function public.check_in_to_event(p_event_id uuid, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
  v_err    jsonb;
  v_result jsonb;
begin
  if v_member is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_member::text, 0));

  v_err := public.checkin_preflight(v_member);
  if v_err is not null then
    if v_err ->> 'code' = 'RATE_LIMITED' then
      perform public.record_throttled_checkin(v_member);
    end if;
    return v_err;
  end if;

  v_err := public.checkin_validate(p_event_id, p_code);
  if v_err is not null then
    insert into public.checkin_attempts (member_id, event_id, succeeded)
    values (v_member, p_event_id, false);
    return v_err;
  end if;

  v_result := public.perform_check_in(v_member, p_event_id, 'code', null);

  insert into public.checkin_attempts (member_id, event_id, succeeded)
  values (v_member, p_event_id, coalesce((v_result ->> 'ok')::boolean, false));

  return v_result;
end;
$$;

grant execute on function public.check_in_to_event(uuid, text) to authenticated;


create or replace function public.check_in_with_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member   uuid := auth.uid();
  v_code     text := public.normalize_checkin_code(p_code);
  v_err      jsonb;
  v_rec      record;
  v_event_id uuid;
  v_result   jsonb;
begin
  if v_member is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_member::text, 0));

  v_err := public.checkin_preflight(v_member);
  if v_err is not null then
    if v_err ->> 'code' = 'RATE_LIMITED' then
      perform public.record_throttled_checkin(v_member);
    end if;
    return v_err;
  end if;

  if length(v_code) < 4 then
    insert into public.checkin_attempts (member_id, succeeded) values (v_member, false);
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE');
  end if;

  for v_rec in
    select e.id, s.code_salt, s.code_hash
      from public.events e
      join public.event_checkin_secrets s on s.event_id = e.id
     where e.status <> 'draft'
       and e.start_at between now() - interval '4 days' and now() + interval '1 day'
     order by (now() between e.check_in_opens_at and e.check_in_closes_at) desc,
              abs(extract(epoch from (e.start_at - now())))
  loop
    if v_rec.code_hash = public.hash_checkin_code(v_rec.code_salt, v_code) then
      v_event_id := v_rec.id;
      exit;
    end if;
  end loop;

  if v_event_id is null then
    insert into public.checkin_attempts (member_id, succeeded) values (v_member, false);
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE');
  end if;

  v_err := public.checkin_validate(v_event_id, v_code);
  if v_err is not null then
    insert into public.checkin_attempts (member_id, event_id, succeeded)
    values (v_member, v_event_id, false);
    return v_err;
  end if;

  v_result := public.perform_check_in(v_member, v_event_id, 'code', null);

  insert into public.checkin_attempts (member_id, event_id, succeeded)
  values (v_member, v_event_id, coalesce((v_result ->> 'ok')::boolean, false));

  return v_result;
end;
$$;

grant execute on function public.check_in_with_code(text) to authenticated;

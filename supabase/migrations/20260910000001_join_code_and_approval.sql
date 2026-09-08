-- =============================================================================
-- Join code + officer approval, and email confirmation off
--
-- Why this exists: confirmation emails to @wustl.edu arrive and are then
-- removed from the mailbox by Microsoft Defender, and the confirmation link is
-- blocked on campus wifi by Cisco Umbrella because the domain is days old. Both
-- were reproduced. Neither is fixable from this repo in the time available.
--
-- So the email leaves the critical path entirely. A new member is 'pending'
-- until either they enter the chapter's join code or an officer approves them.
-- 'pending' is already meaningful: checkin_allowed_statuses is ["active"], so
-- checkin_preflight refuses a pending member without any new plumbing.
--
-- The threat this defends against is small and worth naming: someone
-- registering with a classmate's wustl.edu address. Under the existing policies
-- such an account can read non-draft events, active announcements and public
-- resources, and nothing else -- it cannot insert attendance or point
-- transactions, because no INSERT policy exists on either table. The join code
-- and the approval queue exist so that gaining *membership* still requires
-- being in the room or being vouched for.
-- =============================================================================


-- ── New members start pending ───────────────────────────────────────────────

update public.app_settings
   set value = '"pending"'::jsonb
 where key = 'default_membership_status';


-- ── The join code ───────────────────────────────────────────────────────────
--
-- Same shape as event_checkin_secrets, and for the same reason: the code is
-- stored only as a salted SHA-256 hash, so no query against any table returns
-- it. A single row pinned by a boolean primary key with a check constraint --
-- there is one chapter join code, and the schema says so rather than relying on
-- everyone remembering to filter.
--
-- No grants and no policies. RLS is enabled with zero policies, which denies
-- everything to anon and authenticated even before the missing grant does. Only
-- SECURITY DEFINER functions, which run as the table owner, can read it.

create table if not exists public.join_code_secret (
  id          boolean primary key default true check (id),
  code_salt   text not null,
  code_hash   text not null,
  enabled     boolean not null default false,
  rotated_by  uuid references public.profiles (id) on delete set null,
  rotated_at  timestamptz not null default now()
);

alter table public.join_code_secret enable row level security;
revoke all on public.join_code_secret from public, anon, authenticated;

comment on table public.join_code_secret is
  'Singleton. Salted hash of the chapter join code. Unreachable from any client '
  'role: no grants, RLS on with no policies. Only definer functions read it.';


-- ── Redemption throttle ─────────────────────────────────────────────────────
--
-- A join code is short enough to be read off a slide, which means it is short
-- enough to guess. This is the same durable-throttle pattern the check-in path
-- uses, for the same reason: an in-process counter is not a control when the
-- thing being defended is reachable from anywhere.

create table if not exists public.join_code_attempts (
  id           bigint generated always as identity primary key,
  member_id    uuid not null references public.profiles (id) on delete cascade,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);

alter table public.join_code_attempts enable row level security;

-- Revoke before granting: Supabase's default privileges hand ALL privileges on
-- a new public table to anon and authenticated, so a table created after the
-- lockdown in 20260906000003 does not inherit it.
revoke all on public.join_code_attempts from public, anon, authenticated;
grant select on public.join_code_attempts to authenticated;

drop policy if exists join_code_attempts_select_officer on public.join_code_attempts;
create policy join_code_attempts_select_officer on public.join_code_attempts
  for select to authenticated
  using (private.is_officer(auth.uid()));

create index if not exists join_code_attempts_member_time_idx
  on public.join_code_attempts (member_id, attempted_at desc);
create index if not exists join_code_attempts_time_idx
  on public.join_code_attempts (attempted_at);


-- ── Redeem ──────────────────────────────────────────────────────────────────
--
-- authenticated only. Deliberately NOT reachable by anon: an anonymous endpoint
-- that answers "is this the right code" is a free oracle, which is exactly what
-- 20260908000001 removed from assert_email_domain_allowed. Requiring a session
-- means every guess is attributable to an account and lands in the throttle.
--
-- The advisory lock is taken before the throttle is read. Without it the count
-- and the insert straddle a gap concurrent requests slip through -- the
-- check-in throttle had exactly that bug, and 40 simultaneous requests got 15
-- attempts through a limit of 8.

create or replace function public.redeem_join_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member   uuid := auth.uid();
  v_code     text := public.normalize_checkin_code(p_code);
  v_secret   public.join_code_secret;
  v_fails    integer;
  v_global   integer;
  v_sustained integer;
  v_status   public.membership_status;
begin
  if v_member is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('join:' || v_member::text, 0));

  select count(*)::integer into v_fails
    from public.join_code_attempts a
   where a.member_id = v_member
     and not a.succeeded
     and a.attempted_at > now() - interval '15 minutes';

  if v_fails >= 5 then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  /*
   * Chapter-wide caps, because the per-member one above does not bound an
   * attacker.
   *
   * Five guesses per account only limits anyone who is limited to one account,
   * and nobody is: email confirmation is off, so registering any address at an
   * allowed domain yields a working session without touching a mailbox. The
   * attacker's real budget is therefore the sign-up rate limit -- which is 150
   * per five minutes per IP -- multiplied by five. That is roughly 9,000
   * guesses an hour against a code an officer reads off a slide, and a code
   * like SHPE2026 does not survive it.
   *
   * Two tiers, because a room full of typos and a scripted search are not the
   * same event:
   *
   *   soft  60 failures chapter-wide in 15 minutes -> refuse, code stays on.
   *         Self-healing as the window slides. A 100-person meeting where a
   *         fifth of the room mistypes once produces about 20, so this sits
   *         well clear of legitimate use while cutting the attack rate to
   *         240/hour -- about 37x slower.
   *
   *   hard  200 failures chapter-wide in an hour -> turn the code off and say
   *         so in the audit log. Reachable only by someone grinding through
   *         soft refusals for the better part of an hour, which is not
   *         something a meeting does.
   *
   * This is a rate control, not a quota: the per-member advisory lock does not
   * serialise these counts, so concurrent callers can read the same value and
   * both pass. Being a few over a threshold of 60 does not matter. A global
   * lock would make it exact and would serialise the one path that must not
   * stall while a room is signing up -- the wrong trade.
   *
   * Turning the code off is a denial of service an attacker can trigger, and
   * that is accepted deliberately: it degrades to officer approval, which is a
   * path this migration already builds and which officers were going to use
   * anyway. An officer rotates and re-enables from the admin screen in seconds.
   * The alternative -- leaving a code up while it is being ground down -- fails
   * silently, and silence is worse than a fallback.
   */
  select count(*)::integer into v_global
    from public.join_code_attempts a
   where not a.succeeded
     and a.attempted_at > now() - interval '15 minutes';

  if v_global >= 60 then
    select count(*)::integer into v_sustained
      from public.join_code_attempts a
     where not a.succeeded
       and a.attempted_at > now() - interval '1 hour';

    if v_sustained >= 200 then
      update public.join_code_secret set enabled = false where id;

      -- Actor is null: this is the system reacting, not a person acting.
      perform public.write_audit_log(
        null, 'join_code.auto_disabled', 'system', null,
        jsonb_build_object('failures_1h', v_sustained, 'failures_15m', v_global)
      );

      return jsonb_build_object('ok', false, 'code', 'JOIN_CODE_DISABLED');
    end if;

    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  select p.membership_status into v_status
    from public.profiles p where p.id = v_member;

  -- Already a member: say so rather than spending an attempt on a no-op.
  if v_status = 'active' then
    return jsonb_build_object('ok', true, 'code', 'ALREADY_ACTIVE');
  end if;
  if v_status in ('suspended', 'inactive') then
    return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE',
                              'membership_status', v_status);
  end if;

  select * into v_secret from public.join_code_secret where id;

  if not found or not v_secret.enabled then
    return jsonb_build_object('ok', false, 'code', 'JOIN_CODE_DISABLED');
  end if;

  if v_secret.code_hash <> public.hash_checkin_code(v_secret.code_salt, v_code) then
    insert into public.join_code_attempts (member_id, succeeded) values (v_member, false);
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE');
  end if;

  /*
   * profiles_guard_protected_columns() pins membership_status on any update
   * made by a non-officer session, which is exactly right -- it is what stops a
   * member promoting themselves by PATCHing their own row. But this function is
   * that member's session, so without an explicit opt-out the guard silently
   * reverts the promotion and this returns ACTIVATED while nothing changed.
   * Verified: it did.
   *
   * The GUC is transaction-scoped and can only be set from SQL, which no client
   * role can reach -- the same escape hatch, and the same reasoning, as
   * app.allow_email_domain_change in 20260908000001.
   */
  perform set_config('app.allow_membership_change', 'on', true);

  update public.profiles
     set membership_status = 'active',
         member_since = coalesce(member_since, now())
   where id = v_member;

  perform set_config('app.allow_membership_change', 'off', true);

  insert into public.join_code_attempts (member_id, succeeded) values (v_member, true);

  -- Actor is the member: this is self-service, and the log should record who
  -- let themselves in rather than attributing it to nobody.
  perform public.write_audit_log(
    v_member, 'membership.join_code_redeemed', 'member', v_member,
    jsonb_build_object('previous_status', v_status)
  );

  return jsonb_build_object('ok', true, 'code', 'ACTIVATED');
end;
$$;

revoke execute on function public.redeem_join_code(text) from public, anon;
grant execute on function public.redeem_join_code(text) to authenticated;


-- ── Officer controls ────────────────────────────────────────────────────────
--
-- Every one of these calls require_officer() as the FIRST statement, before any
-- work. A guard that runs after the work has already happened is decoration.
-- require_officer() itself is revoked from every client role and reads
-- private.is_officer, which since 20260909000001 is not reachable through
-- PostgREST at all -- so there is no path by which a member can assert officer
-- status, and no endpoint that will tell them who has it.

create or replace function public.admin_set_join_code(
  p_code    text,
  p_enabled boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_officer();
  v_code  text := public.normalize_checkin_code(p_code);
  v_salt  text;
begin
  -- Normalisation strips punctuation and upper-cases, so "shpe fall 26" and
  -- "SHPE-FALL-26" are the same code.
  --
  -- Six characters, matching the form. The floor used to be four and the form
  -- said six, which meant the rule everyone actually relied on lived in Zod --
  -- i.e. in the browser, where it is advice rather than a rule. An officer
  -- calling this RPC directly could set a four-character code.
  --
  -- Six is still not much against an offline attack, but this code is never
  -- exposed to one: only its salted hash is stored, and every guess has to go
  -- through redeem_join_code(), which is throttled per member and chapter-wide.
  if length(v_code) < 6 then
    raise exception 'A join code needs at least 6 letters or digits'
      using errcode = '22023';
  end if;

  -- gen_random_uuid(), not gen_random_bytes(). pgcrypto lives in the
  -- `extensions` schema on Supabase, so with `set search_path = ''` a bare
  -- gen_random_bytes() raises undefined_function -- which PostgREST then
  -- reports as "No function matches admin_set_join_code", pointing at the
  -- wrong function entirely. gen_random_uuid is a pg_catalog builtin and
  -- resolves under an empty search_path; two of them give a 256-bit salt.
  v_salt := replace(gen_random_uuid()::text, '-', '')
         || replace(gen_random_uuid()::text, '-', '');

  insert into public.join_code_secret (id, code_salt, code_hash, enabled, rotated_by, rotated_at)
  values (true, v_salt, public.hash_checkin_code(v_salt, v_code), p_enabled, v_actor, now())
  on conflict (id) do update
    set code_salt  = excluded.code_salt,
        code_hash  = excluded.code_hash,
        enabled    = excluded.enabled,
        rotated_by = excluded.rotated_by,
        rotated_at = excluded.rotated_at;

  -- The audit entry records that a rotation happened, never what the code is.
  perform public.write_audit_log(
    v_actor, 'join_code.set', 'system', null,
    jsonb_build_object('enabled', p_enabled)
  );

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

revoke execute on function public.admin_set_join_code(text, boolean) from public, anon;
grant execute on function public.admin_set_join_code(text, boolean) to authenticated;


create or replace function public.admin_set_join_code_enabled(p_enabled boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_officer();
  v_rows  integer;
begin
  update public.join_code_secret set enabled = p_enabled where id;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'Set a join code before turning it on' using errcode = 'P0002';
  end if;

  perform public.write_audit_log(
    v_actor,
    case when p_enabled then 'join_code.enabled' else 'join_code.disabled' end,
    'system', null, '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

revoke execute on function public.admin_set_join_code_enabled(boolean) from public, anon;
grant execute on function public.admin_set_join_code_enabled(boolean) to authenticated;


-- Status for the admin screen. Returns whether a code exists and whether it is
-- on -- never the code, and never the hash. An officer who forgets the code
-- sets a new one; there is no read path, by design.
create or replace function public.admin_join_code_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := public.require_officer();
  v_secret     public.join_code_secret;
  v_configured boolean;
  v_recent     integer;
begin
  select * into v_secret from public.join_code_secret where id;
  -- Captured immediately. FOUND reflects the most recent query, so reading it
  -- after the count below would report "configured" as true whenever the count
  -- returned a row -- which it always does. That was the bug: with no join code
  -- set at all, the admin screen said one was configured.
  v_configured := found;

  select count(*)::integer into v_recent
    from public.join_code_attempts a
   where not a.succeeded
     and a.attempted_at > now() - interval '24 hours';

  return jsonb_build_object(
    'ok', true,
    'configured', v_configured,
    'enabled', coalesce(v_secret.enabled, false),
    'rotated_at', v_secret.rotated_at,
    'failed_attempts_24h', v_recent,
    -- Distinguishes "an officer turned it off" from "it turned itself off
    -- because it was being guessed at". Anchored to rotated_at so a rotation
    -- clears it: setting a new code is the remedy, and the screen should stop
    -- warning once the remedy has been applied.
    'auto_disabled', (
      v_configured
      and not coalesce(v_secret.enabled, false)
      and exists (
        select 1 from public.admin_audit_log l
         where l.action = 'join_code.auto_disabled'
           and l.created_at > coalesce(v_secret.rotated_at, '-infinity'::timestamptz)
      )
    ),
    'pending_members', (
      select count(*)::integer from public.profiles p
       where p.membership_status = 'pending'
    )
  );
end;
$$;

revoke execute on function public.admin_join_code_status() from public, anon;
grant execute on function public.admin_join_code_status() to authenticated;


-- ── Retention for the attempt log ───────────────────────────────────────────
-- Attacker-influenced rows on a 500 MB database, same as checkin_attempts.

create or replace function public.prune_join_code_attempts(p_days integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.join_code_attempts a
   where a.attempted_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_join_code_attempts(integer)
  from public, anon, authenticated;


-- Admin-callable form. Without this the function above was revoked from every
-- client role and never scheduled, so nothing could call it and the table grew
-- without bound -- attacker-influenced rows on a 500 MB tier. Same shape as
-- admin_prune_checkin_attempts, and audited the same way.
create or replace function public.admin_prune_join_code_attempts(p_days integer default 90)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.require_admin();
  v_deleted integer;
begin
  v_deleted := public.prune_join_code_attempts(p_days);

  perform public.write_audit_log(
    v_actor, 'join_code_attempts.pruned', 'system', null,
    jsonb_build_object('days_kept', p_days, 'rows_deleted', v_deleted)
  );

  return jsonb_build_object('ok', true, 'rows_deleted', v_deleted, 'days_kept', p_days);
end;
$$;

revoke execute on function public.admin_prune_join_code_attempts(integer) from public, anon;
grant execute on function public.admin_prune_join_code_attempts(integer) to authenticated;


-- Scheduled if pg_cron happens to be installed, guarded so the migration is
-- valid on a project where it never was -- which is the default, and is why the
-- admin-callable form exists.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'prune-join-code-attempts',
      '31 4 * * 0',                       -- 04:31 every Sunday
      $cron$select public.prune_join_code_attempts(90);$cron$
    );
    raise notice 'Scheduled weekly prune of public.join_code_attempts via pg_cron.';
  else
    raise notice 'pg_cron not installed; call public.admin_prune_join_code_attempts() periodically instead.';
  end if;
end;
$$;


-- ── Teach the profile guard about the join-code path ────────────────────────
--
-- Unchanged except for one clause. The guard still reverts membership_status,
-- email, member_since and self-asserted National verification for any ordinary
-- member update; it now stands aside when redeem_join_code() has explicitly
-- opted out for the duration of its own transaction.

create or replace function public.profiles_guard_protected_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No JWT means service_role or a migration, which is trusted by definition.
  if auth.uid() is null then
    return new;
  end if;

  -- private.is_officer, not public: 20260909000001 moved the role predicates out
  -- of the PostgREST-exposed schema and dropped the public copies. Recreating
  -- this trigger against public.is_officer would fail to resolve.
  if private.is_officer(auth.uid()) then
    return new;
  end if;

  -- Set only by redeem_join_code(), transaction-scoped, unreachable from any
  -- client role because setting it requires SQL execution.
  if coalesce(nullif(current_setting('app.allow_membership_change', true), ''), 'off') = 'on' then
    return new;
  end if;

  new.id                := old.id;
  new.email             := old.email;
  new.membership_status := old.membership_status;
  new.member_since      := old.member_since;
  new.created_at        := old.created_at;

  if new.shpe_national_member = 'verified'
     and old.shpe_national_member is distinct from 'verified' then
    new.shpe_national_member := 'self_reported';
  end if;

  return new;
end;
$$;

-- =============================================================================
-- Security hardening
--
-- Three fixes, all found by reviewing the check-in path under load rather than
-- by reading it:
--
--   1. The brute-force throttle was bypassable by firing requests concurrently.
--   2. One guess was tested against a month's worth of events at once, which
--      quietly divided the effective code space by the number of live events.
--   3. checkin_attempts grew without bound on a 500 MB database.
-- =============================================================================


-- ── 1. Serialise check-in attempts per member ───────────────────────────────
--
-- checkin_preflight() counts failed attempts and the caller inserts the new
-- one afterwards. Nothing sat between the read and the write, so N concurrent
-- requests all read the same pre-insert count and all passed the check.
--
-- Measured against the local stack with the limit set to 8:
--     20 requests sequentially   ->  8 allowed   (correct)
--     20 requests simultaneously -> 13 allowed
--     40 requests simultaneously -> 15 allowed
--
-- A transaction-scoped advisory lock keyed on the member fixes it. Requests
-- from one member queue behind each other so each sees the previous attempt
-- committed; requests from different members never contend, because the lock
-- key is derived from the member id. The lock is released when the statement's
-- transaction ends, which for a PostgREST RPC call is immediately after it
-- returns.

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

  -- Must be taken before the throttle is read, or the race it closes reopens.
  perform pg_advisory_xact_lock(hashtextextended(v_member::text, 0));

  v_err := public.checkin_preflight(v_member);
  if v_err is not null then
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


-- ── 2. Same lock, plus a much narrower candidate set ────────────────────────
--
-- This entry point hashes the submitted code against every candidate event,
-- so a single guess gets as many chances as there are candidates. At +/- 14
-- days a typical semester has ~12 events in range, which turns a 320,000-code
-- space into an effective ~27,000 -- an order of magnitude the comment in the
-- original function did not account for.
--
-- +/- 4 days cuts the candidate set to roughly three without changing what a
-- member experiences. The bound is not arbitrary: checkin.test.sql asserts
-- that a correct code for an event three days away answers CHECKIN_NOT_OPEN
-- rather than INVALID_CODE, and an event three days past answers
-- CHECKIN_CLOSED. Those are deliberate product decisions about error quality
-- -- telling someone holding a valid code that it is invalid is a bad answer
-- -- so the window is set to keep them true rather than the tests relaxed to
-- fit a tighter window.
--
-- Tradeoff, stated plainly: a correct code typed more than four days out now
-- returns INVALID_CODE, because the event is no longer a candidate. The
-- event-scoped path above still gives the precise reason, since it is handed
-- an explicit event id and never scans.

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
       and e.start_at between now() - interval '4 days' and now() + interval '4 days'
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


-- ── 3. Retention for the attempt log ────────────────────────────────────────
--
-- Rows here are attacker-influenced: every failed guess writes one, and nothing
-- ever removed them. The throttle only ever reads the last 10 minutes, so
-- anything older is ballast on a 500 MB free-tier database.
--
-- 90 days is kept rather than 10 minutes so officers can still investigate a
-- pattern of abuse after the fact.

create or replace function public.prune_checkin_attempts(p_days integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.checkin_attempts a
   where a.attempted_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Internal: this is the unguarded form, used by the scheduler, which runs with
-- no JWT and so could never satisfy an is_admin() check.
revoke execute on function public.prune_checkin_attempts(integer)
  from public, anon, authenticated;

-- Supports the range delete above; the existing index is (member_id, time) and
-- does not help a scan by time alone.
create index if not exists checkin_attempts_attempted_at_idx
  on public.checkin_attempts (attempted_at);


-- Admin-callable form, so the chapter is not dependent on pg_cron being
-- enabled. Audited like every other privileged action.
create or replace function public.admin_prune_checkin_attempts(p_days integer default 90)
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
  v_deleted := public.prune_checkin_attempts(p_days);

  perform public.write_audit_log(
    v_actor, 'checkin_attempts.pruned', 'system', null,
    jsonb_build_object('days_kept', p_days, 'rows_deleted', v_deleted)
  );

  return jsonb_build_object('ok', true, 'rows_deleted', v_deleted, 'days_kept', p_days);
end;
$$;

grant execute on function public.admin_prune_checkin_attempts(integer) to authenticated;


-- Schedule it if pg_cron happens to be installed. Guarded so the migration is
-- valid on a project where the extension was never enabled -- which is the
-- default, and is why the admin-callable form above exists.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'prune-checkin-attempts',
      '17 4 * * 0',                       -- 04:17 every Sunday
      $cron$select public.prune_checkin_attempts(90);$cron$
    );
    raise notice 'Scheduled weekly prune of public.checkin_attempts via pg_cron.';
  else
    raise notice 'pg_cron not installed; call public.admin_prune_checkin_attempts() periodically instead.';
  end if;
end;
$$;

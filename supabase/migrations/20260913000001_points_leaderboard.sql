-- =============================================================================
-- A points leaderboard in My SHPE, officer-toggled, rebuilt once a day
--
-- Until now the only ranking a member ever saw was their own percentile, and
-- 20260906000004 says why: shipping every member's total to the browser so it
-- could compute a rank would be slow and a privacy leak. This keeps both halves
-- of that. The ranking is computed in SQL, and what leaves the database is a
-- name, a rank, a point total and an event count for the top of the board --
-- never a member id, an email, or anyone's ledger.
--
-- Three decisions shape the rest of the file:
--
--   * It is a SNAPSHOT, not a live query. The board is rebuilt at most once a
--     day, and every read in between is a lookup on a few hundred rows rather
--     than an aggregate over the whole ledger. Points a member earns today
--     reach the board tomorrow; their own My Points page stays live.
--
--   * The snapshot is rebuilt by pg_cron when it is installed and, when it is
--     not -- which is the default, see 20260907000001 -- by the first read after
--     midnight Central. Either way it happens once per day. A board that only
--     updated when someone remembered to press a button would quietly go stale.
--
--   * Visibility is an app_settings switch, and the database enforces it. The
--     snapshot tables have RLS on with no policies and no grants, so the only
--     path to them is get_points_leaderboard(), which hands a member nothing but
--     the switch position while the board is hidden. Hiding the nav link is the
--     convenience; this is the control.
--
--     It ships OFF. Putting every member's name and point total in front of the
--     rest of the chapter is a decision for the officers to make, from
--     Admin > Leaderboard, rather than something a deploy does on their behalf.
-- =============================================================================


-- ── The switch ──────────────────────────────────────────────────────────────

insert into public.app_settings (key, value, description) values
  ('leaderboard_enabled',
   'false'::jsonb,
   'Whether approved members can see the points leaderboard in My SHPE. Ships off; an officer turns it on from Admin > Leaderboard. Officers can always preview it.')
on conflict (key) do nothing;


-- The portal needs the switch position to decide whether to show the nav link,
-- so it joins the keys get_app_config() exposes. Unchanged otherwise. A boolean
-- that says whether the chapter has a leaderboard switched on reveals nothing
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
     'leaderboard_enabled'
   );
$$;


-- ── The snapshot ────────────────────────────────────────────────────────────
--
-- One row per ranked member per scope. The scopes are the three the Points page
-- offers, resolved at refresh time against whichever term is active then:
-- the current term, its academic year, and all time.
--
-- display_name is copied in rather than joined at read time. That is what makes
-- this a snapshot -- a renamed member shows up renamed tomorrow, like everything
-- else on the board -- and it means the read path never touches profiles.
--
-- member_id cascades from profiles, so a deleted member disappears from the
-- board immediately rather than at the next refresh. It is used only to find
-- the caller's own row and is never returned.

create table if not exists public.points_leaderboard (
  scope           text    not null,
  member_id       uuid    not null references public.profiles (id) on delete cascade,
  rank            integer not null,
  display_name    text    not null,
  total_points    integer not null,
  events_attended integer not null,

  primary key (scope, member_id),
  constraint points_leaderboard_scope_known
    check (scope in ('term', 'academic_year', 'all_time'))
);

create index if not exists points_leaderboard_scope_rank_idx
  on public.points_leaderboard (scope, rank);

-- Singleton, pinned the same way as join_code_secret: there is one snapshot,
-- and the schema says so.
create table if not exists public.points_leaderboard_meta (
  id            boolean primary key default true check (id),
  refreshed_at  timestamptz not null,
  term_name     text,
  academic_year text
);

-- RLS on, zero policies, no grants. Supabase's default privileges hand ALL on a
-- new public table to anon and authenticated, so the revoke is not optional.
alter table public.points_leaderboard      enable row level security;
alter table public.points_leaderboard_meta enable row level security;
revoke all on public.points_leaderboard      from public, anon, authenticated;
revoke all on public.points_leaderboard_meta from public, anon, authenticated;

comment on table public.points_leaderboard is
  'Daily snapshot of the points leaderboard. Unreachable from any client role: '
  'RLS on with no policies. Read through public.get_points_leaderboard().';
comment on table public.points_leaderboard_meta is
  'Singleton. When the leaderboard snapshot was last rebuilt, and for which term.';


-- ── Rebuild ─────────────────────────────────────────────────────────────────
--
-- "Ranked" means what it already means in get_member_points_summary(): an
-- active chapter membership and points in the period. Unlike the percentile
-- cohort, a net total of zero or less does not earn a place on the board.
--
-- rank() rather than row_number(): two members on the same total share a
-- place, and the next one down skips accordingly (1, 1, 3).
--
-- p_only_if_stale lets the read path ask for a rebuild without causing a
-- second one. The advisory lock is taken BEFORE staleness is checked: two
-- members opening the board at 00:01 both see yesterday's snapshot, and
-- without the lock-then-recheck both would rebuild it. Under READ COMMITTED the
-- recheck sees the first rebuild as soon as it commits.

create or replace function public.refresh_points_leaderboard(p_only_if_stale boolean default false)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing   timestamptz;
  v_term       uuid := public.current_term_id();
  v_term_name  text;
  v_year       text;
  v_term_ids   uuid[];
  v_year_ids   uuid[];
  v_now        timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('public.points_leaderboard'));

  if p_only_if_stale then
    select m.refreshed_at into v_existing from public.points_leaderboard_meta m where m.id;
    if v_existing is not null and not public.points_leaderboard_is_stale(v_existing) then
      return v_existing;
    end if;
  end if;

  select t.name, t.academic_year
    into v_term_name, v_year
    from public.academic_terms t
   where t.id = v_term;

  -- An empty array, not null, when there is no active term: null means "all
  -- time" to the join below, and a chapter between terms should get an empty
  -- term board rather than a second copy of the all-time one.
  v_term_ids := case when v_term is null then array[]::uuid[] else array[v_term] end;
  v_year_ids := case
                  when v_year is null then array[]::uuid[]
                  else public.term_ids_for_scope(null, v_year)
                end;

  -- `where true` keeps this valid where pg-safeupdate is loaded.
  delete from public.points_leaderboard where true;

  with scopes (scope, term_ids) as (
    values ('term'::text,          v_term_ids),
           ('academic_year'::text, v_year_ids),
           ('all_time'::text,      null::uuid[])
  ),
  totals as (
    select s.scope, pt.member_id, sum(pt.amount)::integer as total_points
      from scopes s
      join public.point_transactions pt
        on s.term_ids is null or pt.academic_term_id = any (s.term_ids)
     group by s.scope, pt.member_id
  ),
  attended as (
    select s.scope, a.member_id, count(*)::integer as events_attended
      from scopes s
      cross join public.event_attendance a
      join public.events e on e.id = a.event_id
     where s.term_ids is null or e.academic_term_id = any (s.term_ids)
     group by s.scope, a.member_id
  )
  insert into public.points_leaderboard
    (scope, member_id, rank, display_name, total_points, events_attended)
  select t.scope,
         t.member_id,
         rank() over (partition by t.scope order by t.total_points desc)::integer,
         coalesce(
           nullif(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')), ''),
           'SHPE member'
         ),
         t.total_points,
         coalesce(att.events_attended, 0)
    from totals t
    join public.profiles p on p.id = t.member_id
    left join attended att on att.scope = t.scope and att.member_id = t.member_id
   where p.membership_status = 'active'
     and t.total_points > 0;

  insert into public.points_leaderboard_meta (id, refreshed_at, term_name, academic_year)
  values (true, v_now, v_term_name, v_year)
  on conflict (id) do update
    set refreshed_at  = excluded.refreshed_at,
        term_name     = excluded.term_name,
        academic_year = excluded.academic_year;

  return v_now;
end;
$$;

-- "Stale" means built before the most recent midnight in chapter-local time,
-- the same clock term_for_timestamp() uses. Kept separate so the rebuild and
-- the read path cannot disagree about what a day is.
create or replace function public.points_leaderboard_is_stale(p_refreshed_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_refreshed_at is null
      or p_refreshed_at < (date_trunc('day', now() at time zone 'America/Chicago')
                           at time zone 'America/Chicago');
$$;

-- Internal: the unguarded form, used by pg_cron (no JWT, so it could never pass
-- require_officer) and by get_points_leaderboard(). Members reach a rebuild only
-- through the latter, which allows one per day.
revoke execute on function public.refresh_points_leaderboard(boolean)
  from public, anon, authenticated;
revoke execute on function public.points_leaderboard_is_stale(timestamptz)
  from public, anon, authenticated;


-- ── Read ────────────────────────────────────────────────────────────────────
--
-- Volatile, not stable, because a read may be the one that rebuilds a stale
-- snapshot. That happens at most once a day; every other call is two indexed
-- lookups.
--
-- The board shows everyone ranked 25th or better. That can be more than 25
-- rows -- the first GBM of a term puts the whole room on the same total, and
-- cutting a tie alphabetically would rank people by surname. The caller's own
-- row comes back separately, so a member outside the top 25 still sees where
-- they stand without the bottom of the board being shown to everyone.

create or replace function public.get_points_leaderboard(p_scope text default 'term')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller   uuid := auth.uid();
  v_officer  boolean;
  v_enabled  boolean;
  v_meta     public.points_leaderboard_meta;
  v_top_n    constant integer := 25;
  v_count    integer;
  v_entries  jsonb;
  v_me       jsonb;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_officer := private.is_officer(v_caller);

  -- The same line every other piece of member data draws since 20260911000001:
  -- a pending account has not been let in, so it sees no other member.
  if not v_officer and not private.is_approved_member(v_caller) then
    raise exception 'Not authorised to view the leaderboard' using errcode = '42501';
  end if;

  if p_scope is null or p_scope not in ('term', 'academic_year', 'all_time') then
    raise exception 'Unknown leaderboard scope' using errcode = '22023';
  end if;

  select coalesce((s.value #>> '{}')::boolean, false)
    into v_enabled
    from public.app_settings s
   where s.key = 'leaderboard_enabled';
  v_enabled := coalesce(v_enabled, false);

  -- Hidden: a member learns that it is hidden and nothing else. An officer
  -- still gets the board, so they can see what switching it on would show.
  if not v_enabled and not v_officer then
    return jsonb_build_object('enabled', false);
  end if;

  select * into v_meta from public.points_leaderboard_meta m where m.id;
  if public.points_leaderboard_is_stale(v_meta.refreshed_at) then
    perform public.refresh_points_leaderboard(true);
    select * into v_meta from public.points_leaderboard_meta m where m.id;
  end if;

  select count(*)::integer
    into v_count
    from public.points_leaderboard l
   where l.scope = p_scope;

  select coalesce(jsonb_agg(jsonb_build_object(
           'rank',            l.rank,
           'display_name',    l.display_name,
           'total_points',    l.total_points,
           'events_attended', l.events_attended,
           'is_me',           l.member_id = v_caller
         ) order by l.rank, l.display_name), '[]'::jsonb)
    into v_entries
    from public.points_leaderboard l
   where l.scope = p_scope
     and l.rank <= v_top_n;

  select jsonb_build_object(
           'rank',            l.rank,
           'display_name',    l.display_name,
           'total_points',    l.total_points,
           'events_attended', l.events_attended,
           'is_me',           true
         )
    into v_me
    from public.points_leaderboard l
   where l.scope = p_scope
     and l.member_id = v_caller;

  return jsonb_build_object(
    'enabled',             v_enabled,
    'scope',               p_scope,
    'refreshed_at',        v_meta.refreshed_at,
    'term_name',           v_meta.term_name,
    'academic_year',       v_meta.academic_year,
    'top_n',               v_top_n,
    'ranked_member_count', v_count,
    'entries',             v_entries,
    'me',                  v_me
  );
end;
$$;

revoke execute on function public.get_points_leaderboard(text) from public, anon;
grant execute on function public.get_points_leaderboard(text) to authenticated;


-- ── Officer controls ────────────────────────────────────────────────────────
--
-- Officer, not admin: like the join code switch, this is a reversible call
-- about what members see this week, and the people running the chapter day to
-- day should be able to make it. Both call require_officer() first, before any
-- work, and both are audited.
--
-- A dedicated setter rather than admin_set_app_setting(): that one takes any
-- jsonb, and a value that does not cast to boolean -- "maybe", {} -- would make
-- every read of the board raise until someone fixed it by hand. This one only
-- accepts a boolean.

create or replace function public.admin_set_leaderboard_enabled(p_enabled boolean)
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
    raise exception 'Say whether the leaderboard should be on or off' using errcode = '22023';
  end if;

  insert into public.app_settings (key, value, updated_by)
  values ('leaderboard_enabled', to_jsonb(p_enabled), v_actor)
  on conflict (key) do update
     set value      = excluded.value,
         updated_by = excluded.updated_by;

  perform public.write_audit_log(
    v_actor,
    case when p_enabled then 'leaderboard.enabled' else 'leaderboard.disabled' end,
    'setting', null,
    jsonb_build_object('key', 'leaderboard_enabled')
  );

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

revoke execute on function public.admin_set_leaderboard_enabled(boolean) from public, anon;
grant execute on function public.admin_set_leaderboard_enabled(boolean) to authenticated;


-- For the morning after an attendance correction, when waiting until tomorrow
-- for the board to agree with the ledger is not good enough.
create or replace function public.admin_refresh_points_leaderboard()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_officer();
  v_at    timestamptz;
begin
  v_at := public.refresh_points_leaderboard(false);

  perform public.write_audit_log(
    v_actor, 'leaderboard.refreshed', 'system', null, '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'refreshed_at', v_at);
end;
$$;

revoke execute on function public.admin_refresh_points_leaderboard() from public, anon;
grant execute on function public.admin_refresh_points_leaderboard() to authenticated;


-- ── Schedule ────────────────────────────────────────────────────────────────
--
-- 06:05 UTC is just after midnight Central in winter and just after 1am in
-- summer -- after the staleness boundary either way, so the scheduled build is
-- never immediately considered stale. Guarded like the other jobs: without
-- pg_cron the first read of the day does the same work.
--
-- No build is run here. On `supabase db reset` the seed runs after migrations,
-- and a snapshot taken now would show an empty board dated today until
-- tomorrow. With no snapshot at all, the first read builds one from whatever
-- data is actually there.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'refresh-points-leaderboard',
      '5 6 * * *',                        -- 06:05 UTC daily
      $cron$select public.refresh_points_leaderboard();$cron$
    );
    raise notice 'Scheduled daily rebuild of public.points_leaderboard via pg_cron.';
  else
    raise notice 'pg_cron not installed; the leaderboard rebuilds on its first read each day.';
  end if;
end;
$$;

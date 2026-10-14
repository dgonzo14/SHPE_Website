-- =============================================================================
-- Attendance form: check in without an account
--
-- The code check-in asks a lot of someone at their first meeting: register with
-- a wustl.edu address, redeem the join code or wait for approval, then type a
-- word-and-digits code inside the window. Each step is there for a reason, and
-- together they mean a newcomer's first event usually goes unrecorded.
--
-- This adds a second way in that asks for a first name, a last name and an
-- email address, nothing else:
--
--   * Each event can have one attendance link, /attend/<token>, which officers
--     share at the meeting as a link or a QR code. The token is 122 random
--     bits, so the link itself is the credential: nobody reaches the form
--     without having been handed it.
--   * The form accepts responses only while the event's check-in window is
--     open, the same window the code check-in uses, and only for published
--     events.
--   * Every response is kept in event_attendance_submissions. If a profile
--     already has that email (compared the way profiles.email_normalized
--     compares, so case and +tags don't matter), the response is checked in
--     to that member straight away through perform_check_in(), the same path
--     every other check-in takes, so it earns the event's points.
--   * Otherwise the response waits. When an account is later created with that
--     email, a trigger on profiles checks it in to the new member, points
--     included. Officers see waiting responses on the event roster and can
--     link one to a member by hand (someone who used a personal address) or
--     delete it (spam).
--   * Officers can also enter a response themselves, for someone who came
--     without a phone, after the window, or while the form was down. It is
--     the same record and goes through the same matching, so "ask an officer"
--     is a real answer for someone who has no account to be added to.
--
-- What this deliberately accepts:
--
--   * Anyone holding the link can submit any address, including a member's,
--     and that member is checked in. That is the cost of not asking for an
--     account, and it is bounded: the link only works during the window, an
--     officer can replace it in seconds, each link takes at most a thousand
--     new responses, and attendance can be removed with the usual audited
--     correction. The same address sent again is checked in again, though
--     (see submit_event_attendance()), so attendance removed because
--     somebody else sent that address only stays off once the link has been
--     replaced or the window has closed.
--   * The form answers every accepted response the same way, whether or not
--     the address belongs to an account, so the link can't be used to find out
--     who has one.
--   * Matching does not look at membership status. The point of the form is
--     to record people before they are members, so a pending account (or one
--     created later) gets its attendance like anyone else.
--   * Waiting responses are claimed when the account is created. Email
--     confirmation is off, so someone registering a classmate's address
--     would inherit that classmate's waiting attendance -- but they could
--     equally have typed the address into the form, so nothing new is exposed.
--
-- Unlike the check-in code, the link token is stored as is and officers can
-- read it back: a QR code goes on slides and gets reused across a meeting,
-- and officers can already add attendance by hand, so hiding the link from
-- them protects nothing.
-- =============================================================================


-- ── 1. One link per event ───────────────────────────────────────────────────

create table if not exists public.event_attendance_links (
  event_id   uuid primary key references public.events (id) on delete cascade,
  token      text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_attendance_links_token_shape check (token ~ '^[0-9a-f]{32}$'),
  constraint event_attendance_links_token_key unique (token)
);

alter table public.event_attendance_links enable row level security;

-- Revoke before granting: Supabase's default privileges hand ALL privileges on
-- a new public table to anon and authenticated. No grants and no policies
-- after that: the token is read through admin_attendance_link() by officers
-- and matched inside the definer functions below, never selected directly.
revoke all on public.event_attendance_links from public, anon, authenticated;


-- ── 2. Every response the form accepts ──────────────────────────────────────

create table if not exists public.event_attendance_submissions (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete restrict,
  first_name    text not null,
  last_name     text not null,
  email         text not null,
  -- The same expression as profiles.email_normalized, so "Ana+shpe@WUSTL.edu"
  -- on the form finds the account registered as "ana@wustl.edu".
  email_normalized text generated always as (
    split_part(split_part(lower(email), '@', 1), '+', 1)
    || '@' ||
    split_part(lower(email), '@', 2)
  ) stored,
  -- Set once the response is on a member's record. Null means it is waiting
  -- for an account. If that member is later deleted, the response goes back
  -- to waiting, and an account created with the address picks it up again.
  member_id     uuid references public.profiles (id) on delete set null,
  -- The attendance it became. Null while waiting, and also once an officer
  -- removes that attendance: the response stays on file, and the same address
  -- sending the form again is checked in again (see submit_event_attendance).
  attendance_id uuid references public.event_attendance (id) on delete set null,
  -- The officer who entered it by hand, or null when it came through the form.
  -- A hand-entered response becomes attendance as 'manual', verified by them.
  added_by      uuid references public.profiles (id) on delete set null,
  submitted_at  timestamptz not null default now(),
  claimed_at    timestamptz,

  constraint event_attendance_submissions_first_name_shape
    check (char_length(first_name) between 1 and 80),
  constraint event_attendance_submissions_last_name_shape
    check (char_length(last_name) between 1 and 80),
  constraint event_attendance_submissions_email_shape
    check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- One response per person per event. A second submission with the same
  -- address is a no-op, which is also what makes a double tap harmless.
  constraint event_attendance_submissions_unique_email unique (event_id, email_normalized)
);

create index if not exists event_attendance_submissions_event_idx
  on public.event_attendance_submissions (event_id, submitted_at);
create index if not exists event_attendance_submissions_waiting_idx
  on public.event_attendance_submissions (email_normalized)
  where member_id is null;

alter table public.event_attendance_submissions enable row level security;

revoke all on public.event_attendance_submissions from public, anon, authenticated;
grant select on public.event_attendance_submissions to authenticated;

drop policy if exists event_attendance_submissions_select_officer
  on public.event_attendance_submissions;
create policy event_attendance_submissions_select_officer
  on public.event_attendance_submissions
  for select to authenticated
  using (private.is_officer(auth.uid()));


-- ── 3. Putting a response on a member's record ──────────────────────────────
--
-- The one place a response becomes attendance, used by the form, by the
-- signup trigger and by an officer linking a response by hand. It goes
-- through perform_check_in(), so the attendance row and the points are
-- written together exactly as for any other check-in, and a member who was
-- already checked in (by code, by an officer, by an earlier response) is
-- linked to that attendance rather than given a second award.
--
-- Internal only: callers are definer functions that have already decided the
-- response and the member belong together.
--
-- It still checks, under the row lock, that the response isn't already
-- someone's attendance. The signup trigger chooses its waiting responses
-- before it locks them, so an officer can link one in between; claiming it
-- anyway would put a second person on the roster, with a second award, on the
-- strength of one response. The ALREADY_CLAIMED this returns never reaches a
-- client: the trigger skips it, and the officer functions refuse a linked
-- response themselves, under the same lock, before they get here.
--
-- "Already someone's attendance" is attendance_id, not member_id. A response
-- whose attendance an officer removed keeps its member_id but is no longer on
-- the roster, and the same address sending the form again should put them
-- back, as it would for anyone else.
--
-- A response an officer typed in becomes 'manual' attendance verified by that
-- officer, the same as Add attendee; one from the form becomes 'form'. An
-- officer entering someone whose response is already on file (its attendance
-- removed, say) is vouching for them now, whoever sent the response first, so
-- admin_add_attendance_submission() names itself in p_verified_by; without
-- that, attendance an officer just added would read as the person's own
-- check-in through the form.

create or replace function private.claim_attendance_submission(
  p_submission_id uuid,
  p_member        uuid,
  p_verified_by   uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id      uuid;
  v_on_roster     uuid;
  v_added_by      uuid;
  v_verified_by   uuid;
  v_result        jsonb;
  v_attendance_id uuid;
begin
  select s.event_id, s.attendance_id, s.added_by
    into v_event_id, v_on_roster, v_added_by
    from public.event_attendance_submissions s
   where s.id = p_submission_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND');
  end if;

  if v_on_roster is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLAIMED');
  end if;

  v_verified_by := coalesce(p_verified_by, v_added_by);

  if v_verified_by is null then
    v_result := public.perform_check_in(p_member, v_event_id, 'form', null);
  else
    v_result := public.perform_check_in(p_member, v_event_id, 'manual', v_verified_by);
  end if;

  if coalesce((v_result ->> 'ok')::boolean, false) then
    v_attendance_id := (v_result ->> 'attendance_id')::uuid;
  elsif v_result ->> 'code' = 'ALREADY_CHECKED_IN' then
    select a.id into v_attendance_id
      from public.event_attendance a
     where a.event_id = v_event_id
       and a.member_id = p_member;
  else
    return v_result;
  end if;

  update public.event_attendance_submissions
     set member_id     = p_member,
         attendance_id = v_attendance_id,
         claimed_at    = now()
   where id = p_submission_id;

  return v_result;
end;
$$;

revoke execute on function private.claim_attendance_submission(uuid, uuid, uuid)
  from public, anon, authenticated;


-- ── 4. Claiming waiting responses when an account appears ───────────────────
--
-- Fires after a profile is inserted (handle_new_user(), inside the signup
-- transaction) and after a profile's email changes (handle_user_email_change()).
--
-- It must never raise. It runs inside the signup transaction, and an error
-- here would roll back the account being created -- a broken attendance claim
-- is not worth a failed registration. Each claim runs in its own
-- sub-transaction, so one bad row is skipped with a warning and the rest still
-- land, and the whole loop is wrapped once more in case the query itself
-- fails.

create or replace function private.claim_pending_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission record;
  v_result     jsonb;
begin
  begin
    for v_submission in
      select s.id, s.event_id, e.title as event_title
        from public.event_attendance_submissions s
        join public.events e on e.id = s.event_id
       where s.member_id is null
         and s.email_normalized = new.email_normalized
       order by s.submitted_at
    loop
      begin
        v_result := private.claim_attendance_submission(v_submission.id, new.id);

        if coalesce((v_result ->> 'ok')::boolean, false) then
          -- Actor is null: the system did this when the account appeared.
          perform public.write_audit_log(
            null, 'attendance.claimed', 'event', v_submission.event_id,
            jsonb_build_object(
              'member_id',      new.id,
              'display_name',   btrim(new.first_name || ' ' || new.last_name),
              'event_title',    v_submission.event_title,
              'points_awarded', (v_result ->> 'points_awarded')::integer
            )
          );
        end if;
      exception when others then
        raise warning 'attendance claim skipped for submission %: %',
          v_submission.id, sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'attendance claim failed for member %: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke execute on function private.claim_pending_attendance()
  from public, anon, authenticated;

drop trigger if exists profiles_claim_pending_attendance on public.profiles;
create trigger profiles_claim_pending_attendance
  after insert on public.profiles
  for each row execute function private.claim_pending_attendance();

drop trigger if exists profiles_claim_pending_attendance_on_email on public.profiles;
create trigger profiles_claim_pending_attendance_on_email
  after update of email on public.profiles
  for each row
  when (old.email_normalized is distinct from new.email_normalized)
  execute function private.claim_pending_attendance();


-- ── 5. Officers: create, replace and read the link ──────────────────────────
--
-- Officer rather than admin, like the check-in code: running attendance is
-- day-to-day chapter work. The audit entries record that a link was made or
-- replaced, never the token.
--
-- Creating and replacing are separate on purpose. Two officers can open the
-- roster before a meeting, both see "no link yet", and both press Create; if
-- create replaced, the second press would kill the QR code the first officer
-- is already projecting. So admin_create_attendance_link() makes a link only
-- when there is none and otherwise hands back the one that exists.
-- Replacing is admin_rotate_attendance_link(), behind its own confirmation:
-- it is how a leaked link is shut off, and the old link stops working the
-- moment it commits.

create or replace function public.admin_create_attendance_link(p_event_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.require_officer();
  v_event   public.events;
  v_token   text;
  v_updated timestamptz;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  -- gen_random_uuid() rather than gen_random_bytes(): pgcrypto lives in the
  -- extensions schema and does not resolve under an empty search_path. A v4
  -- UUID carries 122 random bits, which is plenty for a link nobody types.
  insert into public.event_attendance_links (event_id, token, created_by)
  values (p_event_id, replace(gen_random_uuid()::text, '-', ''), v_actor)
  on conflict (event_id) do nothing
  returning token, updated_at into v_token, v_updated;

  if v_token is null then
    select l.token, l.updated_at into v_token, v_updated
      from public.event_attendance_links l
     where l.event_id = p_event_id;

    return jsonb_build_object(
      'has_link',   true,
      'token',      v_token,
      'updated_at', v_updated,
      'created',    false
    );
  end if;

  perform public.write_audit_log(
    v_actor, 'event.attendance_link_created', 'event', p_event_id,
    jsonb_build_object('title', v_event.title)
  );

  return jsonb_build_object(
    'has_link',   true,
    'token',      v_token,
    'updated_at', v_updated,
    'created',    true
  );
end;
$$;

revoke execute on function public.admin_create_attendance_link(uuid) from public, anon;
grant execute on function public.admin_create_attendance_link(uuid) to authenticated;


create or replace function public.admin_rotate_attendance_link(p_event_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.require_officer();
  v_event   public.events;
  v_token   text;
  v_created boolean;
  v_updated timestamptz;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '');

  -- Whether this made the link or replaced one is read from what the writes
  -- did, not from a look beforehand. Two officers pressing at once on an event
  -- with no link would both have seen "none", and both been told (and both
  -- audited) that they created it, when the second had in fact replaced the
  -- first's. The insert waits for a concurrent one to commit, so whichever
  -- comes second finds the row and replaces it.
  insert into public.event_attendance_links (event_id, token, created_by)
  values (p_event_id, v_token, v_actor)
  on conflict (event_id) do nothing
  returning updated_at into v_updated;

  v_created := v_updated is not null;

  if not v_created then
    update public.event_attendance_links l
       set token      = v_token,
           created_by = v_actor,
           updated_at = now()
     where l.event_id = p_event_id
    returning l.updated_at into v_updated;
  end if;

  perform public.write_audit_log(
    v_actor,
    case when v_created then 'event.attendance_link_created'
         else 'event.attendance_link_rotated' end,
    'event', p_event_id,
    jsonb_build_object('title', v_event.title)
  );

  return jsonb_build_object(
    'has_link',   true,
    'token',      v_token,
    'updated_at', v_updated,
    'created',    v_created
  );
end;
$$;

revoke execute on function public.admin_rotate_attendance_link(uuid) from public, anon;
grant execute on function public.admin_rotate_attendance_link(uuid) to authenticated;


create or replace function public.admin_attendance_link(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.event_attendance_links;
begin
  perform public.require_officer();

  select * into v_link from public.event_attendance_links l where l.event_id = p_event_id;

  return jsonb_build_object(
    'has_link',   found,
    'token',      v_link.token,
    'updated_at', v_link.updated_at
  );
end;
$$;

revoke execute on function public.admin_attendance_link(uuid) from public, anon;
grant execute on function public.admin_attendance_link(uuid) to authenticated;


-- ── 6. The public form: what to show ────────────────────────────────────────
--
-- Anyone may call this; holding the token is what matters. An unknown token,
-- a malformed one and a draft event all get the same not_found, so the answer
-- says nothing beyond "this link doesn't work". With 122 random bits there is
-- nothing to guess, so this is not the oracle redeem_join_code() refuses to
-- be.
--
-- A link that does work gets the event's title, time and place and whether
-- the form is open right now, so the page can say "opens at 6:30 PM" instead
-- of failing at submit.

create or replace function public.get_attendance_form(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token  text := lower(btrim(coalesce(p_token, '')));
  v_event  public.events;
  v_status text;
begin
  if v_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select e.* into v_event
    from public.event_attendance_links l
    join public.events e on e.id = l.event_id
   where l.token = v_token;

  if not found or v_event.status = 'draft' then
    return jsonb_build_object('status', 'not_found');
  end if;

  v_status := case
    when v_event.status = 'cancelled'            then 'cancelled'
    when v_event.status = 'completed'            then 'closed'
    when now() < v_event.check_in_opens_at       then 'not_open'
    when now() > v_event.check_in_closes_at      then 'closed'
    else 'open'
  end;

  return jsonb_build_object(
    'status',    v_status,
    'opens_at',  v_event.check_in_opens_at,
    'closes_at', v_event.check_in_closes_at,
    'event', jsonb_build_object(
      'title',    v_event.title,
      'start_at', v_event.start_at,
      'end_at',   v_event.end_at,
      'location', v_event.location
    )
  );
end;
$$;

revoke execute on function public.get_attendance_form(text) from public, anon, authenticated;
grant execute on function public.get_attendance_form(text) to anon, authenticated;


-- ── 7. The public form: submit ──────────────────────────────────────────────
--
-- Expected outcomes come back as { ok: false, code } -- a closed form is
-- something to tell the person, not an error. Input the form itself would have
-- refused raises 22023, since only a caller bypassing the page can send it.
--
-- Every accepted response gets the same answer: { ok: true, event_title },
-- whether it matched an account, was waiting, or was a repeat. See the header
-- for why.
--
-- A repeat of an address already on file writes nothing new. If that
-- response isn't anyone's attendance -- an officer removed it, or it arrived
-- in the same instant the account was being created, so neither transaction
-- saw the other -- and the address now has an account, it is checked in
-- again. Without that, the person would be told they're checked in while
-- nothing was recorded.
--
-- The cap bounds what a leaked link can write. A general body meeting brings
-- in a couple of hundred people; a thousand responses through one link is
-- somebody scripting the form, and past that point the link stops taking new
-- rows (repeats of an address already on file still succeed, as they write
-- nothing). It counts responses since the link was made or last replaced, so
-- replacing a leaked link, which is the advice for a leak, also brings the
-- form back for everyone else. Responses officers typed in don't count.
-- Counted without a lock on purpose: being a few over the cap does not
-- matter, and a lock would make a room full of people wait on each other.

create or replace function public.submit_event_attendance(
  p_token      text,
  p_first_name text,
  p_last_name  text,
  p_email      text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_per_link  constant integer := 1000;

  v_token         text := lower(btrim(coalesce(p_token, '')));
  v_first         text := btrim(coalesce(p_first_name, ''));
  v_last          text := btrim(coalesce(p_last_name, ''));
  v_email         text := lower(btrim(coalesce(p_email, '')));
  v_event_id      uuid;
  v_link_since    timestamptz;
  v_event         public.events;
  v_count         integer;
  v_submission_id uuid;
  v_on_roster     uuid;
  v_normalized    text;
  v_member        uuid;
begin
  if v_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'code', 'FORM_NOT_FOUND');
  end if;

  select l.event_id, l.updated_at into v_event_id, v_link_since
    from public.event_attendance_links l
   where l.token = v_token;

  select * into v_event from public.events e where e.id = v_event_id;

  if not found or v_event.status = 'draft' then
    return jsonb_build_object('ok', false, 'code', 'FORM_NOT_FOUND');
  end if;

  if v_event.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'EVENT_CANCELLED',
                              'event_title', v_event.title);
  end if;

  if v_event.status = 'completed' or now() > v_event.check_in_closes_at then
    return jsonb_build_object('ok', false, 'code', 'FORM_CLOSED',
                              'event_title', v_event.title,
                              'closed_at', v_event.check_in_closes_at);
  end if;

  if now() < v_event.check_in_opens_at then
    return jsonb_build_object('ok', false, 'code', 'FORM_NOT_OPEN',
                              'event_title', v_event.title,
                              'opens_at', v_event.check_in_opens_at);
  end if;

  if char_length(v_first) = 0 or char_length(v_first) > 80 then
    raise exception 'Enter your first name' using errcode = '22023';
  end if;
  if char_length(v_last) = 0 or char_length(v_last) > 80 then
    raise exception 'Enter your last name' using errcode = '22023';
  end if;
  if char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  -- The same expression as the generated email_normalized column.
  v_normalized := split_part(split_part(v_email, '@', 1), '+', 1)
                  || '@' || split_part(v_email, '@', 2);

  select s.id, s.attendance_id into v_submission_id, v_on_roster
    from public.event_attendance_submissions s
   where s.event_id = v_event.id
     and s.email_normalized = v_normalized;

  if v_submission_id is null then
    select count(*)::integer into v_count
      from public.event_attendance_submissions s
     where s.event_id = v_event.id
       and s.added_by is null
       and s.submitted_at >= v_link_since;

    if v_count >= c_max_per_link then
      return jsonb_build_object('ok', false, 'code', 'FORM_FULL',
                                'event_title', v_event.title);
    end if;

    insert into public.event_attendance_submissions (event_id, first_name, last_name, email)
    values (v_event.id, v_first, v_last, v_email)
    on conflict (event_id, email_normalized) do nothing
    returning id into v_submission_id;

    -- Someone sent the same address in the same instant and got there first.
    if v_submission_id is null then
      return jsonb_build_object('ok', true, 'event_title', v_event.title);
    end if;
  elsif v_on_roster is not null then
    -- Already someone's attendance: same reply as the first time.
    return jsonb_build_object('ok', true, 'event_title', v_event.title);
  end if;

  select p.id into v_member
    from public.profiles p
   where p.email_normalized = v_normalized;

  if v_member is not null then
    perform private.claim_attendance_submission(v_submission_id, v_member);
  end if;

  return jsonb_build_object('ok', true, 'event_title', v_event.title);
end;
$$;

revoke execute on function public.submit_event_attendance(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_event_attendance(text, text, text, text)
  to anon, authenticated;


-- ── 8. Officers: enter and sort out responses ───────────────────────────────
--
-- Adding covers the person the form exists for when the form can't help:
-- no phone, after the window closed, or the link was down. Add attendee only
-- reaches people who already have an account, so this is the officer's way to
-- record a newcomer. It is an ordinary response, entered by the officer: it
-- matches an account now if there is one, and otherwise waits like any other.
-- No window check, like admin_add_attendance(); an officer adding someone
-- after the meeting is exactly the point. Officers may see whether the address
-- matched, since they can already look members up.
--
-- Linking covers the person who filled in the form with a personal address
-- but has an account under their school one. It is the same claim the signup
-- trigger makes, so the member gets the attendance and the points exactly as
-- if the addresses had matched.

create or replace function public.admin_add_attendance_submission(
  p_event_id   uuid,
  p_first_name text,
  p_last_name  text,
  p_email      text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor         uuid := public.require_officer();
  v_first         text := btrim(coalesce(p_first_name, ''));
  v_last          text := btrim(coalesce(p_last_name, ''));
  v_email         text := lower(btrim(coalesce(p_email, '')));
  v_normalized    text;
  v_event         public.events;
  v_submission_id uuid;
  v_on_roster     uuid;
  v_member        uuid;
  v_result        jsonb;
  v_status        text;
  v_created       boolean := false;
begin
  if char_length(v_first) = 0 or char_length(v_first) > 80 then
    raise exception 'Enter their first name' using errcode = '22023';
  end if;
  if char_length(v_last) = 0 or char_length(v_last) > 80 then
    raise exception 'Enter their last name' using errcode = '22023';
  end if;
  if char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  v_normalized := split_part(split_part(v_email, '@', 1), '+', 1)
                  || '@' || split_part(v_email, '@', 2);

  select s.id, s.attendance_id into v_submission_id, v_on_roster
    from public.event_attendance_submissions s
   where s.event_id = p_event_id
     and s.email_normalized = v_normalized
     for update;

  if v_on_roster is not null then
    return jsonb_build_object('ok', true, 'status', 'already_recorded', 'points_awarded', 0);
  end if;

  if v_submission_id is null then
    insert into public.event_attendance_submissions (
      event_id, first_name, last_name, email, added_by
    )
    values (p_event_id, v_first, v_last, v_email, v_actor)
    on conflict (event_id, email_normalized) do nothing
    returning id into v_submission_id;

    if v_submission_id is null then
      return jsonb_build_object('ok', true, 'status', 'already_recorded', 'points_awarded', 0);
    end if;
    v_status := 'waiting';
    v_created := true;
  else
    -- On file but on nobody's roster. Unless an account can take it now, an
    -- officer adding it again changes nothing.
    v_status := 'already_recorded';
  end if;

  select p.id into v_member
    from public.profiles p
   where p.email_normalized = v_normalized;

  if v_member is not null then
    v_result := private.claim_attendance_submission(v_submission_id, v_member, v_actor);
    v_status := case
      when coalesce((v_result ->> 'ok')::boolean, false) then 'checked_in'
      else 'already_recorded'
    end;
  end if;

  if v_created or v_status = 'checked_in' then
    perform public.write_audit_log(
      v_actor, 'attendance.submission_added', 'event', p_event_id,
      jsonb_build_object(
        'display_name', btrim(v_first || ' ' || v_last),
        'email',        v_email,
        'event_title',  v_event.title,
        'points_awarded', case when v_status = 'checked_in'
                               then (v_result ->> 'points_awarded')::integer
                               else 0 end
      )
    );
  end if;

  return jsonb_build_object(
    'ok',             true,
    'status',         v_status,
    'points_awarded', case when v_status = 'checked_in'
                           then (v_result ->> 'points_awarded')::integer
                           else 0 end
  );
end;
$$;

revoke execute on function public.admin_add_attendance_submission(uuid, text, text, text)
  from public, anon;
grant execute on function public.admin_add_attendance_submission(uuid, text, text, text)
  to authenticated;


create or replace function public.admin_link_attendance_submission(
  p_submission_id uuid,
  p_member_id     uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := public.require_officer();
  v_submission public.event_attendance_submissions;
  v_member     public.profiles;
  v_title      text;
  v_result     jsonb;
begin
  select * into v_submission
    from public.event_attendance_submissions s
   where s.id = p_submission_id
     for update;
  if not found then
    raise exception 'That response no longer exists' using errcode = 'P0002';
  end if;

  if v_submission.member_id is not null then
    raise exception 'That response is already on a member''s record' using errcode = '22023';
  end if;

  select * into v_member from public.profiles p where p.id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  v_result := private.claim_attendance_submission(p_submission_id, p_member_id);

  select e.title into v_title from public.events e where e.id = v_submission.event_id;

  perform public.write_audit_log(
    v_actor, 'attendance.submission_linked', 'event', v_submission.event_id,
    jsonb_build_object(
      'member_id',      p_member_id,
      'display_name',   btrim(v_member.first_name || ' ' || v_member.last_name),
      'email',          v_submission.email,
      'event_title',    v_title,
      'points_awarded', case when coalesce((v_result ->> 'ok')::boolean, false)
                             then (v_result ->> 'points_awarded')::integer
                             else 0 end
    )
  );

  return v_result;
end;
$$;

revoke execute on function public.admin_link_attendance_submission(uuid, uuid) from public, anon;
grant execute on function public.admin_link_attendance_submission(uuid, uuid) to authenticated;


-- Deleting is only for responses still waiting. One that is already on a
-- member's record is attendance, and attendance is removed with
-- admin_remove_attendance(), which also reverses the points and asks why.

create or replace function public.admin_delete_attendance_submission(p_submission_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := public.require_officer();
  v_submission public.event_attendance_submissions;
  v_title      text;
begin
  select * into v_submission
    from public.event_attendance_submissions s
   where s.id = p_submission_id
     for update;
  if not found then
    raise exception 'That response no longer exists' using errcode = 'P0002';
  end if;

  if v_submission.member_id is not null then
    raise exception 'That response is already on a member''s record. Remove their attendance instead.'
      using errcode = '22023';
  end if;

  delete from public.event_attendance_submissions where id = p_submission_id;

  select e.title into v_title from public.events e where e.id = v_submission.event_id;

  perform public.write_audit_log(
    v_actor, 'attendance.submission_deleted', 'event', v_submission.event_id,
    jsonb_build_object(
      'display_name', btrim(v_submission.first_name || ' ' || v_submission.last_name),
      'email',        v_submission.email,
      'event_title',  v_title
    )
  );

  return jsonb_build_object('ok', true, 'id', p_submission_id);
end;
$$;

revoke execute on function public.admin_delete_attendance_submission(uuid) from public, anon;
grant execute on function public.admin_delete_attendance_submission(uuid) to authenticated;


-- After a leaked link is replaced, whatever was scripted through it is still
-- on the waiting list. This clears, in one audited step, the waiting
-- responses that came through the form before a given moment -- the
-- replacement time, in practice. Responses on someone's record and responses
-- an officer typed in are left alone. Real people who used the old link
-- before it leaked and have no account yet go too, which the confirmation in
-- the roster says before anything is deleted.

create or replace function public.admin_delete_waiting_submissions(
  p_event_id         uuid,
  p_submitted_before timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.require_officer();
  v_title   text;
  v_deleted integer;
begin
  if p_submitted_before is null then
    raise exception 'Say which responses to delete' using errcode = '22023';
  end if;

  select e.title into v_title from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  delete from public.event_attendance_submissions s
   where s.event_id = p_event_id
     and s.member_id is null
     and s.added_by is null
     and s.submitted_at < p_submitted_before;

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    perform public.write_audit_log(
      v_actor, 'attendance.submissions_deleted', 'event', p_event_id,
      jsonb_build_object('event_title', v_title, 'count', v_deleted)
    );
  end if;

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke execute on function public.admin_delete_waiting_submissions(uuid, timestamptz)
  from public, anon;
grant execute on function public.admin_delete_waiting_submissions(uuid, timestamptz)
  to authenticated;

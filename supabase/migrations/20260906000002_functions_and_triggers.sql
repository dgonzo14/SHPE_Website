-- =============================================================================
-- 20260906000002_functions_and_triggers.sql
-- Shared helpers, authorisation predicates, and table triggers.
--
-- Every SECURITY DEFINER function here runs with `search_path = ''` and fully
-- qualifies every object it touches, so a rogue temporary object can never be
-- resolved ahead of the intended one.
--
-- has_role/is_officer/is_admin are SECURITY DEFINER on purpose: RLS policies on
-- other tables call them, and if they were invoker-rights they would re-enter
-- member_roles' own policies and recurse.
-- =============================================================================


-- ── Generic helpers ─────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


create or replace function public.slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-');
$$;


-- ── Authorisation predicates ────────────────────────────────────────────────

create or replace function public.has_role(p_member uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.member_roles r
     where r.member_id = p_member
       and r.role = p_role
  );
$$;

-- "Officer" for authorisation purposes means officer OR admin: every admin can
-- do anything an officer can.
create or replace function public.is_officer(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_member is not null and exists (
    select 1
      from public.member_roles r
     where r.member_id = p_member
       and r.role in ('officer', 'admin')
  );
$$;

create or replace function public.is_admin(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_member is not null and exists (
    select 1
      from public.member_roles r
     where r.member_id = p_member
       and r.role = 'admin'
  );
$$;


-- ── Academic term resolution ────────────────────────────────────────────────

create or replace function public.current_term_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from public.academic_terms t
   where t.is_active
   order by t.start_date desc
   limit 1;
$$;

-- Semester containing a moment in time, evaluated in chapter-local time so an
-- 8pm event on the last day of term does not roll into the next one.
create or replace function public.term_for_timestamp(p_ts timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from public.academic_terms t
   where t.term_type <> 'academic_year'
     and (p_ts at time zone 'America/Chicago')::date between t.start_date and t.end_date
   order by t.start_date desc
   limit 1;
$$;


-- Resolves the three scopes the portal offers — one term, a whole academic
-- year, or all time — into a single term-id array. NULL means "all time";
-- an empty array means "a year that has no terms", which correctly yields zero
-- rather than silently widening to everything.
create or replace function public.term_ids_for_scope(
  p_term_id       uuid,
  p_academic_year text
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_term_id is not null then array[p_term_id]
    when p_academic_year is not null then coalesce(
      (select array_agg(t.id)
         from public.academic_terms t
        where t.academic_year = p_academic_year
          and t.term_type <> 'academic_year'),
      array[]::uuid[]
    )
    else null
  end;
$$;

grant execute on function public.term_ids_for_scope(uuid, text) to authenticated;


-- ── Check-in code primitives ────────────────────────────────────────────────
-- Codes are compared after normalisation, so "nova 4821", "NOVA-4821" and
-- "nova4821" are the same code. Members mistype in exactly these ways.

create or replace function public.normalize_checkin_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- sha256() is a pg_catalog builtin (PG11+), so no extension is required and the
-- empty search_path stays safe.
create or replace function public.hash_checkin_code(p_salt text, p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    sha256(convert_to(p_salt || ':' || public.normalize_checkin_code(p_code), 'UTF8')),
    'hex'
  );
$$;

-- Human-enterable but not guessable: one of 32 words plus four digits
-- (~320k combinations), drawn from gen_random_uuid()'s CSPRNG rather than
-- random(). Sequential codes like EVENT1/EVENT2 are exactly what this avoids.
create or replace function public.generate_checkin_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_words text[] := array[
    'SHPE','NOVA','BEAR','ORBIT','FLINT','ARCH','RIVER','LUNA',
    'FORGE','PULSE','QUARTZ','SIERRA','VERTEX','CANYON','EMBER','MOSAIC',
    'DELTA','HARBOR','JUNIPER','KESTREL','LANTERN','MERIDIAN','NIMBUS','ONYX',
    'PRISM','RAVEN','SUMMIT','TANGENT','UMBRA','VOYAGE','WILLOW','ZENITH'
  ];
  v_hex text := replace(gen_random_uuid()::text, '-', '');
  v_a integer := ('x' || substr(v_hex, 1, 7))::bit(28)::integer;
  v_b integer := ('x' || substr(v_hex, 9, 7))::bit(28)::integer;
begin
  return v_words[1 + (v_a % array_length(v_words, 1))]
      || lpad((v_b % 10000)::text, 4, '0');
end;
$$;


-- ── Audit log writer ────────────────────────────────────────────────────────
-- Internal: privileged callers only. Never granted to authenticated.

create or replace function public.write_audit_log(
  p_actor       uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke execute on function public.write_audit_log(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;


-- ── Event triggers ──────────────────────────────────────────────────────────

-- One place where "when does check-in open?" is decided. The columns are always
-- populated after this runs, so the client can read them directly instead of
-- re-deriving a default that might drift out of sync with the server.
create or replace function public.events_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Slugs are permanent: renaming an event must not break shared links.
    new.slug := coalesce(
      nullif(new.slug, ''),
      public.slugify(new.title) || '-' || substr(replace(new.id::text, '-', ''), 1, 6)
    );
  else
    new.slug := old.slug;
  end if;

  new.check_in_opens_at  := coalesce(new.check_in_opens_at,  new.start_at - interval '30 minutes');
  new.check_in_closes_at := coalesce(new.check_in_closes_at, new.end_at   + interval '30 minutes');

  new.academic_term_id := coalesce(
    new.academic_term_id,
    public.term_for_timestamp(new.start_at),
    public.current_term_id()
  );

  return new;
end;
$$;

create trigger events_before_write_trg
  before insert or update on public.events
  for each row execute function public.events_before_write();

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();


-- Officers write events through ordinary RLS-guarded INSERT/UPDATE rather than
-- an RPC, so auditing lives in a trigger to guarantee it cannot be bypassed.
create or replace function public.events_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log(
      auth.uid(), 'event.created', 'event', new.id,
      jsonb_build_object('title', new.title, 'status', new.status, 'points_value', new.points_value)
    );
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      perform public.write_audit_log(
        auth.uid(), 'event.status_changed', 'event', new.id,
        jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status)
      );
    end if;
    if new.points_value is distinct from old.points_value then
      perform public.write_audit_log(
        auth.uid(), 'event.points_changed', 'event', new.id,
        jsonb_build_object('title', new.title, 'from', old.points_value, 'to', new.points_value)
      );
    end if;
  elsif tg_op = 'DELETE' then
    perform public.write_audit_log(
      auth.uid(), 'event.deleted', 'event', old.id,
      jsonb_build_object('title', old.title)
    );
    return old;
  end if;
  return new;
end;
$$;

create trigger events_audit_trg
  after insert or update or delete on public.events
  for each row execute function public.events_audit();


-- ── updated_at triggers for the remaining mutable tables ────────────────────

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

create trigger resources_set_updated_at
  before update on public.resources
  for each row execute function public.set_updated_at();

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();


-- ── Profile column guard ────────────────────────────────────────────────────
-- RLS decides *which rows* a member may update; this decides *which columns*.
-- Without it, "update your own profile" would also mean "set your own
-- membership_status to active" or "mark yourself as a verified SHPE National
-- member".

create or replace function public.profiles_guard_protected_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No JWT means service_role or a direct migration/seed connection, which is
  -- trusted by definition. Members can never reach this branch: anon has no
  -- UPDATE policy on profiles at all.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_officer(auth.uid()) then
    return new;
  end if;

  new.id                := old.id;
  new.email             := old.email;
  new.membership_status := old.membership_status;
  new.member_since      := old.member_since;
  new.created_at        := old.created_at;

  -- A member may say they hold a National membership; only an officer may
  -- confirm it. Self-service "verified" quietly degrades to "self_reported".
  if new.shpe_national_member = 'verified'
     and old.shpe_national_member is distinct from 'verified' then
    new.shpe_national_member := 'self_reported';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_protected_columns_trg
  before update on public.profiles
  for each row execute function public.profiles_guard_protected_columns();


-- ── Registration email policy ───────────────────────────────────────────────
-- Client-side validation exists for a fast error message; this is the actual
-- enforcement. An empty `allowed_email_domains` list disables the restriction;
-- `manual_email_allowlist` is how an officer onboards someone whose address
-- does not fit the standard domain.

create or replace function public.assert_email_domain_allowed(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domains   text[];
  v_allowlist text[];
  v_email     text := lower(btrim(coalesce(p_email, '')));
  v_domain    text := split_part(lower(btrim(coalesce(p_email, ''))), '@', 2);
begin
  select array(select lower(jsonb_array_elements_text(s.value)))
    into v_domains
    from public.app_settings s
   where s.key = 'allowed_email_domains';

  if v_domains is null or cardinality(v_domains) = 0 then
    return;  -- policy not configured → no restriction
  end if;

  select array(select lower(jsonb_array_elements_text(s.value)))
    into v_allowlist
    from public.app_settings s
   where s.key = 'manual_email_allowlist';

  if v_allowlist is not null and v_email = any (v_allowlist) then
    return;
  end if;

  if v_domain = any (v_domains) then
    return;
  end if;

  raise exception
    'Registration is limited to approved email domains (%). Ask a SHPE officer to add your address.',
    array_to_string(v_domains, ', ')
    using errcode = 'check_violation';
end;
$$;


-- ── Account → profile provisioning ──────────────────────────────────────────
-- Idempotent, and runs inside the signup transaction: if it fails, the auth
-- user is rolled back too. That is deliberate — an auth account with no usable
-- application profile is worse than a failed signup.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_degree public.degree_level;
  v_status public.membership_status;
  v_grad   integer;
begin
  perform public.assert_email_domain_allowed(new.email);

  begin
    v_degree := nullif(btrim(v_meta ->> 'degree_level'), '')::public.degree_level;
  exception when others then
    v_degree := null;
  end;

  begin
    v_grad := nullif(btrim(v_meta ->> 'graduation_year'), '')::integer;
  exception when others then
    v_grad := null;
  end;

  select (s.value #>> '{}')::public.membership_status
    into v_status
    from public.app_settings s
   where s.key = 'default_membership_status';

  insert into public.profiles (
    id, email, first_name, last_name,
    major, secondary_major, graduation_year, degree_level,
    shpe_national_member, shpe_national_member_id, linkedin_url,
    membership_status
  )
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(v_meta ->> 'first_name'), ''), ''),
    coalesce(nullif(btrim(v_meta ->> 'last_name'), ''), ''),
    nullif(btrim(v_meta ->> 'major'), ''),
    nullif(btrim(v_meta ->> 'secondary_major'), ''),
    v_grad,
    v_degree,
    -- A signup form can claim membership; it can never claim verification.
    case
      when coalesce(v_meta ->> 'shpe_national_member', 'false') in ('true', 't', '1')
        then 'self_reported'::public.national_member_status
      else 'not_provided'::public.national_member_status
    end,
    nullif(btrim(v_meta ->> 'shpe_national_member_id'), ''),
    nullif(btrim(v_meta ->> 'linkedin_url'), ''),
    coalesce(v_status, 'active'::public.membership_status)
  )
  on conflict (id) do nothing;

  -- Everyone starts as a plain member. Elevation is an explicit, audited act.
  insert into public.member_roles (member_id, role)
  values (new.id, 'member')
  on conflict (member_id, role) do nothing;

  insert into public.notification_preferences (member_id)
  values (new.id)
  on conflict (member_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- Keep profiles.email in step when a member changes their address in Auth.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

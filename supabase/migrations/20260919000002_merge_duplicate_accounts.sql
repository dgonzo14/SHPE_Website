-- =============================================================================
-- Two accounts for one person: merging them, and moving the address
--
-- When someone can't get into their account they make another, usually under
-- a variant of their address (ana1@ for ana@), and the chapter ends up with
-- two records for one person. The previous migration says how the stranded
-- pilot accounts caused this; it can happen any time someone loses a password
-- and registers again instead of asking for a reset link.
--
-- The account to keep is the one the person signs in to now -- it has their
-- password, and usually their card and recent check-ins. The address to keep
-- is usually the old account's, the real one. So fixing it takes two steps,
-- one function each, run together from the SQL editor:
--
--   begin;
--   select private.merge_member_accounts(<keep id>, <duplicate id>, '<why>');
--   select private.change_member_email(<keep id>, '<real address>', '<why>');
--   commit;
--
-- merge_member_accounts() moves the duplicate's history onto the kept account
-- and deletes the duplicate. change_member_email() then moves the kept
-- account's sign-in address, which only works once no other account holds it.
-- Either is useful alone: change_member_email() on its own is how an admin
-- fixes a typo in someone's address, since members have no way to change it
-- themselves and an emailed change link would be filtered like everything else.
--
-- Both are console-only: no client role can execute them, and there is no
-- screen for them yet. They change who can sign in as whom, the same class of
-- power as admin_delete_member(), and they run rarely enough that the SQL
-- editor, with its explicit transaction, is the right place.
-- =============================================================================


-- ── 1. Merging a duplicate into the account that's kept ─────────────────────
--
-- What moves to the kept account:
--
--   * Attendance, for every event the kept account wasn't already at. Where
--     both were checked in to the same event, the kept account's check-in
--     stands and the duplicate's goes with the duplicate.
--   * Point transactions, except those for an event both attended: the kept
--     account was already awarded for it, and moving the duplicate's award
--     would count the event twice. Manual adjustments and bonuses not tied to
--     such an event all move.
--   * Attendance form responses, re-pointed to whichever check-in is now on
--     the roster for that event, so the roster still links each one to its
--     member.
--   * Roles the kept account doesn't have (an officer may have granted the
--     role to the wrong one of two same-named accounts), and the chapter
--     position if the kept account has none.
--
-- What doesn't: everything else on the duplicate -- notification settings,
-- check-in throttles, join code attempts, its spot in the leaderboard snapshot
-- -- is per-account bookkeeping and goes when the duplicate is deleted. The
-- kept account's profile is left as it is; the duplicate's details are in the
-- audit row if any are worth copying over by hand.
--
-- It refuses, changing nothing, when the duplicate has:
--
--   * A business card, or a handle. Card media lives in storage under the
--     owner's id, which SQL can't move, and a handle is printed on NFC chips.
--     Sort the card out from Admin > Business cards first.
--   * Done anything as an officer -- created an event, granted a role, entered
--     someone else's response -- found by checking every ON DELETE SET NULL
--     reference to profiles, so a table added later is covered without
--     editing this. Deleting the duplicate would blank who did those things.
--     That makes it an account somebody uses, not a duplicate, and merging it
--     is a decision to make by hand.
--
-- The duplicate's history is copied into the audit row before anything is
-- deleted, as admin_delete_member() does, so a merge made in error can be put
-- back by hand.

-- Every single-column foreign key to profiles that is ON DELETE SET NULL --
-- the references a deleted account leaves blank -- and whether its table has
-- a member_id saying whose row it is. Read from the catalog, so a table added
-- later is included without editing this.
create or replace function private.profile_set_null_references()
returns table (tbl regclass, col name, owned boolean)
language sql
stable
set search_path = ''
as $$
  select c.conrelid::regclass,
         a.attname,
         exists (select 1 from pg_catalog.pg_attribute o
                  where o.attrelid = c.conrelid
                    and o.attname = 'member_id'
                    and o.attnum > 0
                    and not o.attisdropped)
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f'
     and c.confrelid = 'public.profiles'::regclass
     and c.confdeltype = 'n'
     and cardinality(c.conkey) = 1
   order by 1, 2;
$$;

revoke execute on function private.profile_set_null_references()
  from public, anon, authenticated;

create or replace function private.merge_member_accounts(
  p_keep      uuid,
  p_duplicate uuid,
  p_reason    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_keep           public.profiles;
  v_dup            public.profiles;
  v_dup_email      text;
  v_ref            record;
  v_used           boolean;
  v_blockers       text[] := '{}';
  v_both_attended  uuid[];
  v_att_detail     jsonb;
  v_txn_detail     jsonb;
  v_att_moved      integer;
  v_txn_moved      integer;
  v_txn_dropped    integer;
  v_points_moved   integer;
  v_points_dropped integer;
  v_responses      integer;
  v_roles_added    text[];
  v_dup_position   text;
  v_position_moved boolean := false;
begin
  if p_keep is null or p_duplicate is null then
    raise exception 'Say which account to keep and which to merge into it' using errcode = '22023';
  end if;

  if p_keep = p_duplicate then
    raise exception 'That is the same account twice' using errcode = '22023';
  end if;

  -- Locked in id order, so two merges touching the same pair can't deadlock.
  perform 1 from public.profiles p
   where p.id in (p_keep, p_duplicate)
   order by p.id
     for update;

  select * into v_keep from public.profiles p where p.id = p_keep;
  if not found then
    raise exception 'The account to keep (%) does not exist', p_keep using errcode = 'P0002';
  end if;

  select * into v_dup from public.profiles p where p.id = p_duplicate;
  if not found then
    raise exception 'The duplicate account (%) does not exist', p_duplicate using errcode = 'P0002';
  end if;

  select u.email into v_dup_email from auth.users u where u.id = p_duplicate;

  -- ── What would stop it ──

  if exists (select 1 from public.member_cards c where c.member_id = p_duplicate)
     or exists (select 1 from public.card_handles h where h.member_id = p_duplicate) then
    v_blockers := v_blockers || 'it has a business card or a card handle'::text;
  end if;

  -- Every column that deleting the duplicate would blank. On a table with a
  -- member_id, the duplicate's own rows don't count: a member is the created_by
  -- on their own check-in award, and those rows move with them (or go, for an
  -- event both attended). Rows about anyone else do. The audit log is checked
  -- separately below. The regclass prints schema-qualified and quoted, so it
  -- is safe to splice in.
  for v_ref in
    select * from private.profile_set_null_references()
  loop
    continue when v_ref.tbl = 'public.admin_audit_log'::regclass;

    if v_ref.owned then
      execute format('select exists (select 1 from %s where %I = $1 and member_id is distinct from $1)',
                     v_ref.tbl, v_ref.col)
         into v_used
        using p_duplicate;
    else
      execute format('select exists (select 1 from %s where %I = $1)', v_ref.tbl, v_ref.col)
         into v_used
        using p_duplicate;
    end if;

    if v_used then
      v_blockers := v_blockers || format('it is recorded as %s.%s', v_ref.tbl, v_ref.col);
    end if;
  end loop;

  -- A member is the actor on a few entries about themselves -- redeeming the
  -- join code is one -- and those are not officer work. Anything they did to
  -- someone or something else is.
  if exists (select 1 from public.admin_audit_log l
              where l.actor_id = p_duplicate
                and l.entity_id is distinct from p_duplicate) then
    v_blockers := v_blockers || 'it is the actor on audit log entries about others'::text;
  end if;

  if cardinality(v_blockers) > 0 then
    raise exception 'Not merging %: %', coalesce(v_dup_email, p_duplicate::text),
                    array_to_string(v_blockers, '; ')
      using errcode = '22023',
            hint = 'Nothing was changed. Sort those out first, or merge the other way round.';
  end if;

  -- ── What it has, before anything changes ──

  select coalesce(array_agg(d.event_id), '{}')
    into v_both_attended
    from public.event_attendance d
    join public.event_attendance k
      on k.event_id = d.event_id and k.member_id = p_keep
   where d.member_id = p_duplicate;

  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id',      a.event_id,
           'event_title',   e.title,
           'checked_in_at', a.checked_in_at,
           'method',        a.check_in_method,
           'moved',         not (a.event_id = any (v_both_attended))
         ) order by a.checked_in_at), '[]'::jsonb)
    into v_att_detail
    from public.event_attendance a
    join public.events e on e.id = a.event_id
   where a.member_id = p_duplicate;

  select coalesce(jsonb_agg(jsonb_build_object(
           'amount',      t.amount,
           'type',        t.transaction_type,
           'description', t.description,
           'event_id',    t.event_id,
           'created_at',  t.created_at,
           'moved',       t.event_id is null or not (t.event_id = any (v_both_attended))
         ) order by t.created_at), '[]'::jsonb)
    into v_txn_detail
    from public.point_transactions t
   where t.member_id = p_duplicate;

  -- ── Moving it ──

  -- Responses first: the duplicate's check-ins for events both attended are
  -- about to go, and a response pointing at one would lose its link.
  update public.event_attendance_submissions s
     set member_id     = p_keep,
         attendance_id = case
           when s.attendance_id is not null and s.event_id = any (v_both_attended)
             then (select k.id from public.event_attendance k
                    where k.event_id = s.event_id and k.member_id = p_keep)
           else s.attendance_id
         end
   where s.member_id = p_duplicate;
  get diagnostics v_responses = row_count;

  update public.event_attendance a
     set member_id = p_keep
   where a.member_id = p_duplicate
     and not (a.event_id = any (v_both_attended));
  get diagnostics v_att_moved = row_count;

  select coalesce(sum(t.amount), 0)::integer
    into v_points_moved
    from public.point_transactions t
   where t.member_id = p_duplicate
     and (t.event_id is null or not (t.event_id = any (v_both_attended)));

  update public.point_transactions t
     set member_id = p_keep
   where t.member_id = p_duplicate
     and (t.event_id is null or not (t.event_id = any (v_both_attended)));
  get diagnostics v_txn_moved = row_count;

  select count(*)::integer, coalesce(sum(t.amount), 0)::integer
    into v_txn_dropped, v_points_dropped
    from public.point_transactions t
   where t.member_id = p_duplicate;

  with added as (
    insert into public.member_roles (member_id, role, granted_by, granted_at)
    select p_keep, r.role, r.granted_by, r.granted_at
      from public.member_roles r
     where r.member_id = p_duplicate
    on conflict (member_id, role) do nothing
    returning role
  )
  select coalesce(array_agg(role::text order by role), '{}') into v_roles_added from added;

  select cp.title into v_dup_position from public.chapter_positions cp where cp.member_id = p_duplicate;

  if v_dup_position is not null
     and not exists (select 1 from public.chapter_positions cp where cp.member_id = p_keep) then
    update public.chapter_positions set member_id = p_keep where member_id = p_duplicate;
    v_position_moved := true;
  end if;

  -- The rows that just moved still name the duplicate where it named itself
  -- (created_by on its own awards, say). Point those at the kept account
  -- rather than let the delete blank them.
  for v_ref in
    select * from private.profile_set_null_references() r
     where r.owned and r.col <> 'member_id'
  loop
    execute format('update %s set %I = $1 where %I = $2 and member_id = $1',
                   v_ref.tbl, v_ref.col, v_ref.col)
      using p_keep, p_duplicate;
  end loop;

  -- Written before the delete, while the duplicate's rows can still be read.
  -- Actor null: this runs from the console, as admin_audit_log rows written
  -- by the system do.
  perform public.write_audit_log(
    null, 'member.merged', 'member', p_keep,
    jsonb_build_object(
      'display_name',                btrim(v_keep.first_name || ' ' || v_keep.last_name),
      'email',                       v_keep.email,
      'duplicate_member_id',         p_duplicate,
      'duplicate_email',             coalesce(v_dup_email, v_dup.email),
      'duplicate_name',              btrim(v_dup.first_name || ' ' || v_dup.last_name),
      'duplicate_membership_status', v_dup.membership_status,
      'duplicate_created_at',        v_dup.created_at,
      'attendance_moved',            v_att_moved,
      'attendance_dropped',          cardinality(v_both_attended),
      'points_moved',                v_points_moved,
      'points_dropped',              v_points_dropped,
      'responses_moved',             v_responses,
      'roles_added',                 to_jsonb(v_roles_added),
      'position_moved',              case when v_position_moved then v_dup_position end,
      'position_dropped',            case when v_dup_position is not null and not v_position_moved
                                          then v_dup_position end,
      'attendance_detail',           v_att_detail,
      'point_transaction_detail',    v_txn_detail,
      'reason',                      p_reason
    )
  );

  -- The auth user, which takes the profile and everything left on it.
  delete from auth.users u where u.id = p_duplicate;

  return jsonb_build_object(
    'ok',                 true,
    'kept',               p_keep,
    'kept_email',         v_keep.email,
    'deleted',            p_duplicate,
    'deleted_email',      coalesce(v_dup_email, v_dup.email),
    'attendance_moved',   v_att_moved,
    'attendance_dropped', cardinality(v_both_attended),
    'point_transactions_moved',   v_txn_moved,
    'point_transactions_dropped', v_txn_dropped,
    'points_moved',       v_points_moved,
    'points_dropped',     v_points_dropped,
    'responses_moved',    v_responses,
    'roles_added',        to_jsonb(v_roles_added),
    'position_moved',     case when v_position_moved then v_dup_position end,
    'position_dropped',   case when v_dup_position is not null and not v_position_moved
                               then v_dup_position end,
    'kept_membership_status',      v_keep.membership_status,
    'duplicate_membership_status', v_dup.membership_status
  );
end;
$$;

comment on function private.merge_member_accounts(uuid, uuid, text) is
  'Console only. Moves a duplicate account''s attendance, points, form responses, '
  'roles and position onto the account being kept, then deletes the duplicate. '
  'Refuses, changing nothing, if the duplicate has a business card or has acted '
  'as an officer. The duplicate''s history is copied into the audit log first.';

revoke execute on function private.merge_member_accounts(uuid, uuid, text)
  from public, anon, authenticated;


-- ── 2. Changing the address an account signs in with ────────────────────────
--
-- Written to auth.users, which is the address that signs in; the existing
-- trigger copies it to profiles. From there the rest follows on its own:
-- form responses waiting under the new address are checked in to the member
-- (claim_pending_attendance(), on the profile's email change), the officer
-- board and the reset-link screen show the new address, and the member signs
-- in with it and their existing password. Sessions they already have keep
-- working.
--
-- The address is marked confirmed: an admin is vouching for it, and an
-- unconfirmed address can't sign in at all (previous migration). Any change
-- the member had pending is cleared, so a stale confirmation link can't move
-- the address somewhere else afterwards.
--
-- The email identity's copy is updated too, and so is the copy GoTrue keeps in
-- user metadata, when there is one. Sign-in looks the user up by auth.users
-- alone, but other paths read the identity, and a mismatch there is the kind
-- of thing that surfaces months later.
--
-- It refuses an address another account holds, compared the way
-- profiles.email_normalized compares. The domain policy still applies (the
-- email change guard from 20260908000001); to move someone off the chapter
-- domain on purpose, run `set local app.allow_email_domain_change = 'on';`
-- first, in the same transaction.

create or replace function private.change_member_email(
  p_member uuid,
  p_email  text,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_normalized text;
  v_old        text;
  v_name       text;
  v_other      uuid;
  v_before     integer;
  v_claimed    integer;
begin
  if char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That is not an email address: %', p_email using errcode = '22023';
  end if;

  select u.email into v_old from auth.users u where u.id = p_member for update;
  select btrim(p.first_name || ' ' || p.last_name) into v_name
    from public.profiles p where p.id = p_member;

  if v_old is null or v_name is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if lower(v_old) = v_email then
    return jsonb_build_object('ok', true, 'changed', false, 'member_id', p_member, 'email', v_old);
  end if;

  -- The same expression as the generated email_normalized column.
  v_normalized := split_part(split_part(v_email, '@', 1), '+', 1)
                  || '@' || split_part(v_email, '@', 2);

  select u.id into v_other
    from auth.users u
   where lower(u.email) = v_email and u.id <> p_member
   limit 1;

  if v_other is null then
    select p.id into v_other
      from public.profiles p
     where p.email_normalized = v_normalized and p.id <> p_member;
  end if;

  if v_other is not null then
    raise exception 'Another account already uses %', v_email
      using errcode = '23505',
            hint = format('If it is the same person, merge it first: '
                          'select private.merge_member_accounts(%L, %L, ''<why>'');',
                          p_member, v_other);
  end if;

  select count(*)::integer into v_before
    from public.event_attendance_submissions s
   where s.member_id = p_member;

  update auth.users u
     set email                       = v_email,
         email_confirmed_at          = coalesce(u.email_confirmed_at, now()),
         email_change                = '',
         email_change_token_new      = '',
         email_change_token_current  = '',
         email_change_confirm_status = 0,
         raw_user_meta_data          = case
           when u.raw_user_meta_data ? 'email'
             then jsonb_set(u.raw_user_meta_data, '{email}', to_jsonb(v_email))
           else u.raw_user_meta_data
         end,
         updated_at                  = now()
   where u.id = p_member;

  update auth.identities i
     set identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(v_email)),
         updated_at    = now()
   where i.user_id = p_member
     and i.provider = 'email';

  select count(*)::integer - v_before into v_claimed
    from public.event_attendance_submissions s
   where s.member_id = p_member;

  perform public.write_audit_log(
    null, 'member.email_changed', 'member', p_member,
    jsonb_build_object(
      'display_name',      v_name,
      'email',             v_email,
      'previous_email',    v_old,
      'responses_claimed', v_claimed,
      'reason',            p_reason
    )
  );

  return jsonb_build_object(
    'ok',                true,
    'changed',           true,
    'member_id',         p_member,
    'old_email',         v_old,
    'email',             v_email,
    'responses_claimed', v_claimed
  );
end;
$$;

comment on function private.change_member_email(uuid, text, text) is
  'Console only. Changes the address a member signs in with (auth.users, its '
  'email identity, and through the existing trigger the profile), marks it '
  'confirmed, and checks in any attendance form responses waiting under it. '
  'Refuses an address another account holds.';

revoke execute on function private.change_member_email(uuid, text, text)
  from public, anon, authenticated;

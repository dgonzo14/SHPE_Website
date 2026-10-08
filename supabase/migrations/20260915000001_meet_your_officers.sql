-- =============================================================================
-- "Meet your officers" in My SHPE
--
-- 20260914000001 gave the chapter officer-assigned positions -- President,
-- Treasurer, ... -- in public.chapter_positions, for the verified line on a
-- business card. That is the one place a member's position lives, and this file
-- adds no second one. It lets members see who holds those positions and how to
-- reach them, which until now only the public Leadership page (a hand-edited
-- JSON file) could tell them.
--
-- A position is a title, not a permission. Nothing here, and nothing in
-- 20260914000001, reads chapter_positions to decide what anyone may do; officer
-- access is still the `officer` role under Roles. supabase/tests/officers.test.sql
-- pins that in both directions.
-- =============================================================================


-- ── Board order ─────────────────────────────────────────────────────────────
--
-- The order the public Leadership page lists the board in. Positions are free
-- text, so the match ignores case, spaces and punctuation -- "Vice President"
-- and "Vice-President" are the same seat. Anything else sorts after the board,
-- then by chapter_positions.sort_order and title.
--
-- Read-only and harmless, but in `private` like the other helpers: it is not
-- something PostgREST needs to expose. Only get_chapter_officers() calls it,
-- as its owner, so no client role needs EXECUTE.

create or replace function private.board_position_order(p_title text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array_position(
      array['president', 'vicepresident', 'externalrepresentative',
            'internalrepresentative', 'secretary', 'treasurer',
            'communityservicechair', 'eventcoordinator', 'firstyearrepresentative'],
      lower(regexp_replace(coalesce(p_title, ''), '[^[:alnum:]]', '', 'g'))
    ),
    1000
  );
$$;

revoke execute on function private.board_position_order(text) from public, anon, authenticated;


-- ── The board ───────────────────────────────────────────────────────────────
--
-- Members cannot read each other's profiles, and should not start to; nor can
-- they read chapter_positions directly. This hands back the board and only the
-- board: for each position holder, the title and what a member needs to
-- recognise and reach them -- name, major, class year, email, LinkedIn. No
-- member ids, no roles, nothing about anyone without a position.
--
-- The email is the account email, the same address the public Leadership page
-- already lists for every current officer.
--
-- Not filtered by the card's show_chapter_position: that switch decides what a
-- member's own business card shows, not whether the chapter may say who its
-- Treasurer is.
--
-- Gated like the leaderboard: a pending account has not been let in, so it
-- does not get the board's contact details either.

create or replace function public.get_chapter_officers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not private.is_officer(v_caller) and not private.is_approved_member(v_caller) then
    raise exception 'Not authorised to view the officer board' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'position',        cp.title,
             'first_name',      p.first_name,
             'last_name',       p.last_name,
             'major',           p.major,
             'graduation_year', p.graduation_year,
             'email',           p.email,
             'linkedin_url',    p.linkedin_url,
             'is_me',           p.id = v_caller
           ) order by private.board_position_order(cp.title), cp.sort_order, cp.title,
                      p.last_name, p.first_name), '[]'::jsonb)
      from public.chapter_positions cp
      join public.profiles p on p.id = cp.member_id
  );
end;
$$;

revoke execute on function public.get_chapter_officers() from public, anon;
grant execute on function public.get_chapter_officers() to authenticated;

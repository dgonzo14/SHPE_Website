-- =============================================================================
-- Business cards: officers publish and unpublish cards
--
-- Until now only a card's owner could publish it (set_my_card_published), and
-- an officer could publish a card only at the moment of creating it
-- (admin_create_card / admin_create_missing_cards with p_publish). This lets an
-- officer publish or unpublish any card at any time, one or many at once, from
-- Admin → Business Cards: putting a starter card live after card-writing
-- night, say, or taking a stale card down at a member's request.
--
-- What it changes is exactly the flag the owner's own switch changes, and
-- nothing else:
--
--   * A published card still resolves only while it isn't hidden, its owner's
--     membership is active, alumni or inactive, and business cards are on
--     (private.card_is_public). Publishing doesn't override moderation, and
--     unpublishing isn't moderation: the owner can publish again from My Card.
--     An officer who needs a card to stay down hides it, with a reason the
--     owner can read.
--   * member_opened_at is left alone. An officer publishing a starter card
--     doesn't mean its owner has opened it, so the public page keeps showing
--     only what a starter card may (name, school, education, position) until
--     they do. That is the difference from set_my_card_published(), which is
--     the owner acting and so marks the card opened.
--
-- Only cards whose state actually changes are written and audited, one
-- 'card.published' or 'card.unpublished' row each, with the card's name and
-- handle, so a double click or a stale row records nothing twice. Members
-- without a card are reported back rather than raising, so a bulk selection
-- that includes them still does the rest.
--
-- Officer rather than admin, like every other card tool: an officer can
-- already hide any card and create published starter cards, and this is the
-- milder of those powers. It starts with require_officer(), so a member gets
-- 42501.
-- =============================================================================

create or replace function public.admin_set_cards_published(
  p_member_ids uuid[],
  p_published  boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := public.require_officer();
  v_ids       uuid[];
  v_changed   uuid[];
  v_unchanged uuid[];
  v_skipped   uuid[];
  v_member    uuid;
begin
  if p_published is null then
    raise exception 'Say whether the cards should be published' using errcode = '22023';
  end if;

  -- Each member once, in a stable order, nulls dropped.
  select coalesce(array_agg(distinct m order by m), '{}')
    into v_ids
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) m
   where m is not null;

  if cardinality(v_ids) = 0 then
    raise exception 'Choose at least one card' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Choose at most 500 cards at a time' using errcode = '22023';
  end if;

  with changed as (
    update public.member_cards c
       set is_published = p_published,
           updated_at   = now()
     where c.member_id = any (v_ids)
       and c.is_published is distinct from p_published
    returning c.member_id
  )
  select coalesce(array_agg(member_id order by member_id), '{}')
    into v_changed
    from changed;

  select coalesce(array_agg(c.member_id order by c.member_id), '{}')
    into v_unchanged
    from public.member_cards c
   where c.member_id = any (v_ids)
     and not (c.member_id = any (v_changed));

  select coalesce(array_agg(m order by m), '{}')
    into v_skipped
    from unnest(v_ids) m
   where not exists (select 1 from public.member_cards c where c.member_id = m);

  foreach v_member in array v_changed loop
    perform public.write_audit_log(
      v_actor,
      case when p_published then 'card.published' else 'card.unpublished' end,
      'member', v_member,
      private.card_audit_subject(v_member)
    );
  end loop;

  return jsonb_build_object(
    'published', p_published,
    'changed',   to_jsonb(v_changed),
    'unchanged', to_jsonb(v_unchanged),
    'skipped',   to_jsonb(v_skipped)
  );
end;
$$;

revoke execute on function public.admin_set_cards_published(uuid[], boolean) from public, anon, authenticated;
grant execute on function public.admin_set_cards_published(uuid[], boolean) to authenticated;

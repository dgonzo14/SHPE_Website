-- =============================================================================
-- Profiles: a minor of its own, shown on business cards
--
-- Until now a profile had one "Second major or minor" field, stored in
-- secondary_major, and a business card printed whatever was in it as
-- "Second major: ...". A member with a minor had to call it a second major on
-- their card, or leave it off. This gives the minor its own column, so a card
-- can show a second major, a minor, or both.
--
--   * profiles.minor is free text like secondary_major ("Spanish", or
--     "Spanish, Music" for two), written by the member from Profile or at
--     signup. It isn't one of the guarded columns, so members can change it.
--   * handle_new_user() reads 'minor' from the signup metadata, exactly as it
--     reads 'secondary_major'. Nothing else about signup changes.
--   * Cards show the minor under the same switch as the major (show_major):
--     it is part of the education block, like the second major already is.
--     get_public_card() and card_profile_json() add it, and viewModel.ts's
--     toPreviewCard() mirrors the rule so the editor preview stays honest.
--     A card whose only education fact is a minor still gets the block.
--
-- Existing secondary_major values stay where they are. Some members typed a
-- minor there, and only they can say which, so they move it themselves; the
-- Profile field now says "Second major" and sits next to a "Minor" field.
-- =============================================================================

alter table public.profiles
  add column minor text;

comment on column public.profiles.minor is
  'Free text, like secondary_major. Shown on the member''s business card under show_major.';


-- ── Signup ──────────────────────────────────────────────────────────────────
-- Unchanged from 20260906000002 except that it also copies 'minor'.

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
    major, secondary_major, minor, graduation_year, degree_level,
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
    nullif(btrim(v_meta ->> 'minor'), ''),
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


-- ── Cards ───────────────────────────────────────────────────────────────────
-- Both unchanged from 20260914000001 except for the minor.

-- CardProfileFields: the profile facts a card can show, read live.
create or replace function private.card_profile_json(p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'first_name',               p.first_name,
    'last_name',                p.last_name,
    'major',                    p.major,
    'secondary_major',          p.secondary_major,
    'minor',                    p.minor,
    'graduation_year',          p.graduation_year,
    'degree_level',             p.degree_level,
    'member_since',             p.member_since,
    'national_member_verified', p.shpe_national_member = 'verified',
    'membership_status',        p.membership_status
  );
$$;

--   education  major, second major and minor when show_major; class year when
--              show_graduation_year; degree level when either; null when
--              nothing is left
create or replace function public.get_public_card(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handle    text := lower(btrim(p_handle));
  v_owner     uuid;
  v_card      public.member_cards;
  v_profile   public.profiles;
  v_position  text;
  v_starter   boolean;
  v_major     text;
  v_secondary text;
  v_minor     text;
  v_year      integer;
  v_degree    public.degree_level;
  v_education jsonb;
  v_links     jsonb;
begin
  if not private.card_handle_shape_ok(v_handle) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select h.member_id into v_owner from public.card_handles h where h.handle = v_handle;
  if v_owner is null or not private.card_is_public(v_owner) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_card    from public.member_cards c where c.member_id = v_owner;
  select * into v_profile from public.profiles p     where p.id = v_owner;

  if v_card.handle <> v_handle then
    return jsonb_build_object('status', 'redirect', 'handle', v_card.handle);
  end if;

  v_starter := v_card.member_opened_at is null;

  select cp.title into v_position from public.chapter_positions cp where cp.member_id = v_owner;

  -- Blank counts as absent. Profiles are written through blankToNull, but a
  -- direct PATCH can still store '', and toPreviewCard() treats '' as absent,
  -- so the live card and the editor preview must agree.
  v_major     := case when v_card.show_major then nullif(btrim(v_profile.major), '') end;
  v_secondary := case when v_card.show_major then nullif(btrim(v_profile.secondary_major), '') end;
  v_minor     := case when v_card.show_major then nullif(btrim(v_profile.minor), '') end;
  v_year      := case when v_card.show_graduation_year then v_profile.graduation_year end;
  v_degree    := case when v_card.show_major or v_card.show_graduation_year
                      then v_profile.degree_level end;
  v_education := case
                   when v_major is not null or v_secondary is not null or v_minor is not null
                        or v_year is not null
                     then jsonb_build_object(
                            'major',           v_major,
                            'secondary_major', v_secondary,
                            'minor',           v_minor,
                            'graduation_year', v_year,
                            'degree_level',    v_degree)
                 end;

  if v_starter then
    return jsonb_build_object(
      'status', 'ok',
      'card', jsonb_build_object(
        'handle',          v_card.handle,
        'display_name',    v_card.display_name,
        'pronouns',        null,
        'headline',        null,
        'organization',    v_card.organization,
        'status_line',     null,
        'bio',             null,
        'location',        null,
        'skills',          '[]'::jsonb,
        'languages',       '[]'::jsonb,
        'avatar_path',     null,
        'banner_path',     null,
        'background_path', null,
        'theme',           '{"preset":"shpe-classic"}'::jsonb,
        'sections',        '["status","featured","links","about","education","shpe"]'::jsonb,
        'allow_indexing',  false,
        'is_starter',      true,
        'education',       v_education,
        'shpe', jsonb_build_object(
          'position',                 case when v_card.show_chapter_position then v_position end,
          'member_since',             null,
          'national_member_verified', false,
          'is_alumni',                false
        ),
        'links',           '[]'::jsonb
      )
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          l.id,
           'kind',        l.kind,
           'label',       l.label,
           'value',       l.value,
           'is_featured', l.is_featured
         ) order by l.sort_order, l.id), '[]'::jsonb)
    into v_links
    from public.member_card_links l
   where l.member_id = v_owner
     and l.is_visible;

  return jsonb_build_object(
    'status', 'ok',
    'card', jsonb_build_object(
      'handle',          v_card.handle,
      'display_name',    v_card.display_name,
      'pronouns',        v_card.pronouns,
      'headline',        v_card.headline,
      'organization',    v_card.organization,
      'status_line',     v_card.status_line,
      'bio',             v_card.bio,
      'location',        v_card.location,
      'skills',          to_jsonb(v_card.skills),
      'languages',       to_jsonb(v_card.languages),
      'avatar_path',     case when private.card_theme_shows_photo(v_card.theme)
                              then v_card.avatar_path end,
      'banner_path',     v_card.banner_path,
      'background_path', v_card.background_path,
      'theme',           v_card.theme,
      'sections',        v_card.sections,
      'allow_indexing',  v_card.allow_indexing,
      'is_starter',      false,
      'education',       v_education,
      'shpe', jsonb_build_object(
        'position',                 case when v_card.show_chapter_position then v_position end,
        'member_since',             case when v_card.show_member_since then v_profile.member_since end,
        'national_member_verified', v_card.show_national_member
                                    and v_profile.shpe_national_member = 'verified',
        'is_alumni',                v_profile.membership_status = 'alumni'
      ),
      'links',           v_links
    )
  );
end;
$$;

-- =============================================================================
-- Business cards: the professional design collection
--
-- Six presets join the original seven -- Executive, Editorial, Studio, Slate,
-- Heritage and Signature -- each with a layout of its own, and with them the
-- design options they are built from, which any card may use:
--
--   layouts   profile, editorial, studio, layered, letterhead, monogram
--   fonts     source-serif-4, source-sans-3, instrument-serif, instrument-sans,
--             plus-jakarta-sans, manrope, eb-garamond, cormorant-garamond
--   buttons   style "hairline"; arrangements "rows", "compact", "grouped";
--             and a new key, "primary": the fill of Add to Contacts and the
--             featured link, "accent" (as before) or "ink" (the text colour)
--   density   "spacious"
--
-- This only redefines private.card_theme_is_valid() with the longer lists. Every
-- value it accepted before it still accepts, so every stored theme stays valid
-- and nothing needs migrating: a theme without the new keys renders exactly as
-- it did, because the renderer fills missing fields from the preset. The
-- member_cards_theme_valid CHECK and save_my_card() both call this function,
-- so they pick the new lists up together.
--
-- src/features/cards/model.ts holds the same lists for the client, and
-- src/features/cards/__tests__/cardThemeSql.test.ts fails if they and this
-- function ever disagree.
--
-- No preset added here defaults to a layout without a photo, so
-- private.card_theme_shows_photo() (20260914000001) needs no change;
-- photoVisibilitySql.test.ts holds it to that.
-- =============================================================================

create or replace function private.card_theme_is_valid(p_theme jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_part jsonb;
  v_key  text;
begin
  if p_theme is null or jsonb_typeof(p_theme) <> 'object' then
    return false;
  end if;

  if length(p_theme::text) > 2000 then
    return false;
  end if;

  if not private.card_json_keys_within(
           p_theme,
           array['preset', 'layout', 'colors', 'background', 'font', 'buttons', 'avatar', 'density']) then
    return false;
  end if;

  if not private.card_json_in(
           p_theme -> 'preset',
           array['shpe-classic', 'sunrise', 'midnight', 'paper', 'washu', 'engineer', 'glass',
                 'executive', 'editorial', 'studio', 'slate', 'heritage', 'signature']) then
    return false;
  end if;

  if p_theme ? 'layout' and not private.card_json_in(
           p_theme -> 'layout',
           array['classic', 'banner', 'split', 'minimal', 'badge',
                 'profile', 'editorial', 'studio', 'layered', 'letterhead', 'monogram']) then
    return false;
  end if;

  if p_theme ? 'colors' then
    v_part := p_theme -> 'colors';
    if not private.card_json_keys_within(
             v_part, array['background', 'surface', 'text', 'muted', 'accent', 'accentText']) then
      return false;
    end if;
    for v_key in select k from jsonb_object_keys(v_part) k loop
      if not private.card_json_hex(v_part -> v_key) then
        return false;
      end if;
    end loop;
  end if;

  if p_theme ? 'background' then
    v_part := p_theme -> 'background';
    if not private.card_json_keys_within(
             v_part, array['type', 'from', 'to', 'angle', 'dim', 'pattern']) then
      return false;
    end if;
    if not private.card_json_in(v_part -> 'type', array['solid', 'gradient', 'image', 'pattern']) then
      return false;
    end if;
    if v_part ? 'from' and not private.card_json_hex(v_part -> 'from') then
      return false;
    end if;
    if v_part ? 'to' and not private.card_json_hex(v_part -> 'to') then
      return false;
    end if;
    if v_part ? 'angle' and not private.card_json_int_between(v_part -> 'angle', 0, 360) then
      return false;
    end if;
    if v_part ? 'dim' and not private.card_json_int_between(v_part -> 'dim', 0, 80) then
      return false;
    end if;
    if v_part ? 'pattern' and not private.card_json_in(
             v_part -> 'pattern', array['dots', 'grid', 'topo', 'diagonal']) then
      return false;
    end if;
  end if;

  if p_theme ? 'font' then
    v_part := p_theme -> 'font';
    if not private.card_json_keys_within(v_part, array['heading', 'body']) then
      return false;
    end if;
    for v_key in select k from jsonb_object_keys(v_part) k loop
      if not private.card_json_in(
               v_part -> v_key,
               array['libre-franklin', 'inter', 'dm-sans', 'space-grotesk', 'nunito',
                     'playfair-display', 'dm-serif-display', 'jetbrains-mono',
                     'source-serif-4', 'source-sans-3', 'instrument-serif', 'instrument-sans',
                     'plus-jakarta-sans', 'manrope', 'eb-garamond', 'cormorant-garamond']) then
        return false;
      end if;
    end loop;
  end if;

  if p_theme ? 'buttons' then
    v_part := p_theme -> 'buttons';
    if not private.card_json_keys_within(v_part, array['shape', 'style', 'arrangement', 'icons', 'primary']) then
      return false;
    end if;
    if v_part ? 'shape' and not private.card_json_in(
             v_part -> 'shape', array['pill', 'rounded', 'square']) then
      return false;
    end if;
    if v_part ? 'style' and not private.card_json_in(
             v_part -> 'style', array['filled', 'outline', 'soft', 'glass', 'hairline']) then
      return false;
    end if;
    if v_part ? 'arrangement' and not private.card_json_in(
             v_part -> 'arrangement', array['list', 'icon-grid', 'rows', 'compact', 'grouped']) then
      return false;
    end if;
    if v_part ? 'icons' and jsonb_typeof(v_part -> 'icons') <> 'boolean' then
      return false;
    end if;
    if v_part ? 'primary' and not private.card_json_in(
             v_part -> 'primary', array['accent', 'ink']) then
      return false;
    end if;
  end if;

  if p_theme ? 'avatar' then
    v_part := p_theme -> 'avatar';
    if not private.card_json_keys_within(v_part, array['shape', 'ring']) then
      return false;
    end if;
    if v_part ? 'shape' and not private.card_json_in(
             v_part -> 'shape', array['circle', 'rounded', 'square', 'hidden']) then
      return false;
    end if;
    if v_part ? 'ring' and jsonb_typeof(v_part -> 'ring') <> 'boolean' then
      return false;
    end if;
  end if;

  if p_theme ? 'density' and not private.card_json_in(
           p_theme -> 'density', array['compact', 'comfortable', 'spacious']) then
    return false;
  end if;

  return true;
exception
  -- Belt and braces: whatever shape of JSON arrives, the answer is "invalid",
  -- never an error out of a CHECK constraint.
  when others then
    return false;
end;
$$;

-- CREATE OR REPLACE keeps the function's privileges, but they are restated so
-- this file says what it relies on: no member can call the validator, and
-- service_role can, because a CHECK runs as the writing role.
revoke execute on function private.card_theme_is_valid(jsonb) from public, anon, authenticated;
grant execute on function private.card_theme_is_valid(jsonb) to service_role;

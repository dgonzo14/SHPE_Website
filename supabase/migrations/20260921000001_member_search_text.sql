-- =============================================================================
-- Member search that ignores accents
--
-- Officers find members by typing into a search box: the member roster, adding
-- someone to an event, linking an attendance form response to an account. The
-- search matched each word against first_name, last_name, email and major with
-- ilike, which ignores case but not accents. Most people type names without
-- them, especially on a phone, so "Munoz" didn't find Muñoz, "Garcia" didn't
-- find García, and "Jose" didn't find José -- in this chapter, a lot of the
-- roster.
--
-- profiles.search_text holds those four fields in one string, lowercased and
-- with accents removed: Unicode NFD splits "ñ" into "n" plus a combining
-- tilde, and the combining marks (U+0300 to U+036F) are dropped. The browser
-- folds what the officer typed the same way (src/lib/search.ts,
-- String.prototype.normalize("NFD")), so either spelling finds either.
--
-- It is a stored generated column, like email_normalized, so it can't drift
-- from the fields it is built from and nobody can write to it. The expression
-- uses built-in functions only. unaccent() would fold a few more letters
-- (ø, ł, ß), but it is an extension and only stable, so a generated column
-- would need a wrapper around it, and it would fold differently from the
-- browser.
--
-- Row level security is unchanged: a member still sees only their own row,
-- searched or not.
-- =============================================================================

alter table public.profiles
  add column search_text text
  generated always as (
    lower(regexp_replace(
      normalize(
        coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
        coalesce(email, '')      || ' ' || coalesce(major, ''),
        NFD),
      '[\u0300-\u036f]', '', 'g'))
  ) stored;

comment on column public.profiles.search_text is
  'First name, last name, email and major, lowercased with accents removed (NFD, '
  'combining marks dropped), for member search. Generated; the browser folds '
  'search words the same way (src/lib/search.ts).';

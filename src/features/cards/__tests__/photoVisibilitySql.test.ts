import { describe, expect, it } from "vitest";

import migration from "../../../../supabase/migrations/20260914000001_member_business_cards.sql?raw";
import { CARD_PRESET_IDS } from "../model";
import { PRESET_PHOTO_DEFAULTS } from "../photoVisibility";

/*
 * private.card_theme_shows_photo() hard-codes the one fact about presets it
 * needs: which presets' default layout draws no photo (and that none defaults
 * to the hidden shape). PRESET_PHOTO_DEFAULTS is the TypeScript side of the
 * same fact, kept in step with themes.ts by photoVisibility.test.ts. If a
 * preset changes, this fails until the SQL is updated too -- otherwise the
 * public card would publish (or withhold) a photo the card itself doesn't
 * draw.
 */

function sqlFunction(name: string): string {
  const start = migration.indexOf(`create or replace function ${name}(`);
  expect(start, `${name} exists in the migration`).toBeGreaterThan(-1);
  const end = migration.indexOf("$$;", migration.indexOf("$$", start) + 2);
  return migration.slice(start, end);
}

describe("private.card_theme_shows_photo matches photoVisibility.ts", () => {
  const body = sqlFunction("private.card_theme_shows_photo");

  it("names exactly the presets whose default layout has no photo", () => {
    const photoless = CARD_PRESET_IDS.filter((id) => PRESET_PHOTO_DEFAULTS[id].layout === "minimal");
    const inSql = [...body.matchAll(/when '([a-z-]+)' then 'minimal'/g)].map((m) => m[1]);
    expect(inSql.sort()).toEqual([...photoless].sort());
  });

  it("relies on no preset defaulting to the hidden shape", () => {
    const hiddenByDefault = CARD_PRESET_IDS.filter(
      (id) => PRESET_PHOTO_DEFAULTS[id].avatarShape === "hidden",
    );
    expect(hiddenByDefault).toEqual([]);
  });

  it("is what get_public_card uses for avatar_path", () => {
    const getPublicCard = sqlFunction("public.get_public_card");
    expect(getPublicCard).toMatch(
      /'avatar_path',\s+case when private\.card_theme_shows_photo\(v_card\.theme\)\s+then v_card\.avatar_path end/,
    );
  });
});

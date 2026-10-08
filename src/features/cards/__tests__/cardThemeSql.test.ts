import { describe, expect, it } from "vitest";

import {
  CARD_AVATAR_SHAPES,
  CARD_BACKGROUND_TYPES,
  CARD_BUTTON_ARRANGEMENTS,
  CARD_BUTTON_SHAPES,
  CARD_BUTTON_STYLES,
  CARD_COLOR_KEYS,
  CARD_DENSITIES,
  CARD_FONT_IDS,
  CARD_LAYOUTS,
  CARD_PATTERNS,
  CARD_PRESET_IDS,
  CARD_PRIMARY_FILLS,
} from "../model";

/*
 * private.card_theme_is_valid() is the authority on what a stored theme may
 * hold, and model.ts is the client's copy of the same lists (the Zod schema and
 * the renderer read model.ts). A value only the client knows fails every save
 * with a 22023; a value only the database knows can be stored but never
 * chosen. This reads the function as the migrations last define it and holds
 * every list to model.ts, so adding a preset, layout or font in one place and
 * not the other fails here rather than in production.
 */

const migrations = import.meta.glob("../../../../supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SIGNATURE = "create or replace function private.card_theme_is_valid(";

/** The function's body from the last migration (by filename, so by date) that defines it. */
function latestDefinition(): { file: string; body: string } {
  const files = Object.keys(migrations).sort();
  const file = [...files].reverse().find((name) => migrations[name].includes(SIGNATURE));
  if (!file) throw new Error("no migration defines private.card_theme_is_valid");
  const sql = migrations[file];
  const start = sql.indexOf(SIGNATURE);
  const bodyStart = sql.indexOf("$$", start);
  const end = sql.indexOf("$$;", bodyStart + 2);
  return { file, body: sql.slice(start, end) };
}

/** The quoted values of the first array[...] after `marker`. */
function arrayAfter(body: string, marker: string): string[] {
  const at = body.indexOf(marker);
  expect(at, `card_theme_is_valid mentions ${marker}`).toBeGreaterThan(-1);
  const open = body.indexOf("array[", at);
  const close = body.indexOf("]", open);
  return [...body.slice(open, close).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

const sorted = (values: readonly string[]) => [...values].sort();

describe("private.card_theme_is_valid matches model.ts", () => {
  const { file, body } = latestDefinition();

  it("is last defined by the design-collection migration", () => {
    expect(file).toMatch(/20260916000001_card_design_collection\.sql$/);
  });

  it.each<[string, string, readonly string[]]>([
    ["presets", "p_theme -> 'preset'", CARD_PRESET_IDS],
    ["layouts", "p_theme -> 'layout'", CARD_LAYOUTS],
    ["colour keys", "v_part := p_theme -> 'colors'", CARD_COLOR_KEYS],
    ["background types", "v_part -> 'type'", CARD_BACKGROUND_TYPES],
    ["patterns", "v_part -> 'pattern'", CARD_PATTERNS],
    // The colour loop reads `v_part -> v_key)`; only the font loop has the comma.
    ["fonts", "v_part -> v_key,", CARD_FONT_IDS],
    ["button shapes", "v_part -> 'shape', array['pill'", CARD_BUTTON_SHAPES],
    ["button styles", "v_part -> 'style'", CARD_BUTTON_STYLES],
    ["arrangements", "v_part -> 'arrangement'", CARD_BUTTON_ARRANGEMENTS],
    ["main-button fills", "v_part -> 'primary'", CARD_PRIMARY_FILLS],
    ["photo shapes", "v_part -> 'shape', array['circle'", CARD_AVATAR_SHAPES],
    ["densities", "p_theme -> 'density'", CARD_DENSITIES],
  ])("allows exactly the %s", (_name, marker, expected) => {
    expect(sorted(arrayAfter(body, marker))).toEqual(sorted(expected));
  });

  it("allows exactly the button keys the theme type has", () => {
    expect(sorted(arrayAfter(body, "v_part := p_theme -> 'buttons'"))).toEqual(
      sorted(["shape", "style", "arrangement", "icons", "primary"]),
    );
  });
});

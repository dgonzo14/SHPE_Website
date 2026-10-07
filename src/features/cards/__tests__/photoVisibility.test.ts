import { describe, expect, it } from "vitest";

import {
  PRESET_PHOTO_DEFAULTS,
  storedThemeShowsPhoto,
  themeShowsPhoto,
  visiblePhotoPath,
} from "../photoVisibility";
import { CARD_PRESETS, resolveTheme, themeShowsPhoto as themeShowsPhotoFromThemes } from "../themes";
import { CARD_AVATAR_SHAPES, CARD_LAYOUTS, CARD_PRESET_IDS, type CardTheme } from "../model";

const AVATAR = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";

describe("PRESET_PHOTO_DEFAULTS", () => {
  // The copy exists so the edge function needn't load themes.ts. If a preset
  // changes its layout or photo shape there, this is the reminder to change it
  // here too, before a hidden photo turns up in a link preview.
  it.each(CARD_PRESET_IDS)("matches CARD_PRESETS for %s", (id) => {
    const preset = CARD_PRESETS[id].theme;
    expect(PRESET_PHOTO_DEFAULTS[id]).toEqual({ layout: preset.layout, avatarShape: preset.avatar.shape });
  });
});

describe("themeShowsPhoto", () => {
  it("hides the photo for the No photo shape and the Minimal layout, and shows it otherwise", () => {
    for (const layout of CARD_LAYOUTS) {
      for (const shape of CARD_AVATAR_SHAPES) {
        expect(themeShowsPhoto({ layout, avatar: { shape } })).toBe(layout !== "minimal" && shape !== "hidden");
      }
    }
  });

  it("is the same function themes.ts offers", () => {
    expect(themeShowsPhotoFromThemes).toBe(themeShowsPhoto);
  });
});

describe("storedThemeShowsPhoto", () => {
  it.each<[string, CardTheme, boolean]>([
    ["SHPE Classic", { preset: "shpe-classic" }, true],
    ["Paper, saved sparsely, takes Minimal from the preset", { preset: "paper" }, false],
    ["Minimal chosen on another preset", { preset: "shpe-classic", layout: "minimal" }, false],
    ["the No photo shape", { preset: "midnight", avatar: { shape: "hidden" } }, false],
    ["Paper switched to a layout with a photo", { preset: "paper", layout: "classic" }, true],
    ["a ring setting alone keeps the preset's shape", { preset: "sunrise", avatar: { ring: false } }, true],
  ])("%s", (_name, theme, expected) => {
    expect(storedThemeShowsPhoto(theme)).toBe(expected);
  });

  // Whatever is stored, the answer must be what the card draws, which reads
  // the theme through resolveTheme().
  it("always agrees with the resolved theme", () => {
    const layouts = [undefined, ...CARD_LAYOUTS, "poster", 7];
    const avatars = [
      undefined,
      ...CARD_AVATAR_SHAPES.map((shape) => ({ shape })),
      { shape: "blob" },
      { ring: true },
      "hidden",
      null,
    ];
    const presets = [...CARD_PRESET_IDS, "nope", undefined];
    for (const preset of presets) {
      for (const layout of layouts) {
        for (const avatar of avatars) {
          const theme = { preset, layout, avatar } as unknown as CardTheme;
          expect(storedThemeShowsPhoto(theme), JSON.stringify(theme)).toBe(themeShowsPhoto(resolveTheme(theme)));
        }
      }
    }
  });

  it("treats a missing or junk theme as SHPE Classic", () => {
    for (const junk of [null, undefined, "paper", 42, ["paper"]]) {
      expect(storedThemeShowsPhoto(junk)).toBe(true);
    }
  });
});

describe("visiblePhotoPath", () => {
  const card = (overrides: Record<string, unknown> = {}) => ({
    is_starter: false,
    avatar_path: AVATAR,
    theme: { preset: "shpe-classic" },
    ...overrides,
  });

  it("returns the photo when the card shows it", () => {
    expect(visiblePhotoPath(card())).toBe(AVATAR);
  });

  it("returns nothing for a design that hides the photo", () => {
    expect(visiblePhotoPath(card({ theme: { preset: "paper" } }))).toBeNull();
    expect(visiblePhotoPath(card({ theme: { preset: "glass", layout: "minimal" } }))).toBeNull();
    expect(visiblePhotoPath(card({ theme: { preset: "washu", avatar: { shape: "hidden" } } }))).toBeNull();
  });

  it("returns nothing for a starter card or a card without a photo", () => {
    expect(visiblePhotoPath(card({ is_starter: true }))).toBeNull();
    expect(visiblePhotoPath(card({ avatar_path: null }))).toBeNull();
    expect(visiblePhotoPath(card({ avatar_path: "  " }))).toBeNull();
    expect(visiblePhotoPath(card({ avatar_path: 42 }))).toBeNull();
  });
});

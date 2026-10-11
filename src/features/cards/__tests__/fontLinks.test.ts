import { describe, expect, it } from "vitest";

import { GOOGLE_FONT_FAMILIES, PRESET_FONT_DEFAULTS, googleFontHref, storedThemeFonts } from "../fontLinks";
import { CARD_FONTS, googleFontHref as appGoogleFontHref } from "../fonts";
import { CARD_PRESETS, resolveTheme } from "../themes";
import { CARD_FONT_IDS, CARD_PRESET_IDS, type CardFontId, type CardTheme } from "../model";

describe("PRESET_FONT_DEFAULTS", () => {
  // The copy exists so the edge function needn't load themes.ts. If a preset
  // changes its fonts there, this is the reminder to change them here too, or
  // the page would start loading the wrong faces early.
  it.each(CARD_PRESET_IDS)("matches CARD_PRESETS for %s", (id) => {
    expect(PRESET_FONT_DEFAULTS[id]).toEqual(CARD_PRESETS[id].theme.font);
  });
});

describe("googleFontHref", () => {
  it("builds the css2 URL with swap, spaces as plus signs", () => {
    expect(googleFontHref("instrument-serif")).toBe(
      "https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap",
    );
    expect(googleFontHref("source-serif-4")).toBe(
      "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400..700&display=swap",
    );
  });

  it("fetches nothing for the site's own face or an unknown id", () => {
    expect(googleFontHref("libre-franklin")).toBeNull();
    expect(googleFontHref("comic-sans" as CardFontId)).toBeNull();
  });

  it("is the one the app uses, from one table of families", () => {
    expect(appGoogleFontHref).toBe(googleFontHref);
    for (const id of CARD_FONT_IDS) expect(CARD_FONTS[id].googleFamily, id).toBe(GOOGLE_FONT_FAMILIES[id]);
  });

  it("only ever points at Google Fonts", () => {
    for (const id of CARD_FONT_IDS) {
      const href = googleFontHref(id);
      if (href) expect(href, id).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=[\w+:;,.@]+&display=swap$/);
    }
  });
});

describe("storedThemeFonts", () => {
  it("reads a preset on its own, name font first, each family once", () => {
    expect(storedThemeFonts({ preset: "editorial" })).toEqual(["instrument-serif", "instrument-sans"]);
    expect(storedThemeFonts({ preset: "shpe-classic" })).toEqual(["libre-franklin"]);
  });

  it("follows the member's overrides, and ignores fonts that aren't in the catalog", () => {
    expect(storedThemeFonts({ preset: "paper", font: { heading: "manrope" } })).toEqual(["manrope", "inter"]);
    expect(storedThemeFonts({ preset: "slate", font: { heading: "comic-sans", body: "eb-garamond" } })).toEqual([
      "manrope",
      "eb-garamond",
    ]);
  });

  it("treats a missing or junk theme as SHPE Classic", () => {
    expect(storedThemeFonts(null)).toEqual(["libre-franklin"]);
    expect(storedThemeFonts({ preset: "vaporwave", font: "inter" })).toEqual(["libre-franklin"]);
  });

  it("always agrees with the resolved theme", () => {
    const themes: CardTheme[] = [
      ...CARD_PRESET_IDS.map((preset) => ({ preset })),
      { preset: "studio", font: { body: "source-sans-3" } },
      { preset: "heritage", font: { heading: "heritage" as CardFontId } },
    ];
    for (const theme of themes) {
      const { heading, body } = resolveTheme(theme).font;
      expect(storedThemeFonts(theme), JSON.stringify(theme)).toEqual(heading === body ? [heading] : [heading, body]);
    }
  });
});

import { describe, expect, it } from "vitest";

import { cardThemeSchema } from "@/lib/validation";
import { CARD_COLOR_KEYS, CARD_PRESET_IDS, CARD_SECTION_IDS, type CardTheme } from "../../../model";
import { CARD_PRESETS, resolveTheme, themeContrastIssues } from "../../../themes";
import {
  applyThemePatch,
  cardColorVars,
  compactTheme,
  contrastFix,
  hasThemeOverrides,
  hiddenSections,
  hideSection,
  isColorOverridden,
  moveSection,
  parseHexInput,
  resetThemeColor,
  showSection,
  shownSections,
} from "../themeEdit";

/** True when no value anywhere in the object is undefined (JSON would drop it silently). */
function hasNoUndefined(value: unknown): boolean {
  if (value === undefined) return false;
  if (value && typeof value === "object") return Object.values(value).every(hasNoUndefined);
  return true;
}

describe("compactTheme", () => {
  it.each(CARD_PRESET_IDS)("stores a pristine %s preset as just { preset }", (id) => {
    expect(compactTheme(CARD_PRESETS[id].theme)).toEqual({ preset: id });
  });

  it("keeps only the fields that differ, with the background type always present", () => {
    const base = CARD_PRESETS["shpe-classic"].theme;
    const theme = compactTheme({
      ...base,
      colors: { ...base.colors, accent: "#0b5cad" },
      background: { ...base.background, angle: 90 },
      buttons: { ...base.buttons, style: "outline" },
    });
    expect(theme).toEqual({
      preset: "shpe-classic",
      colors: { accent: "#0b5cad" },
      background: { type: "solid", angle: 90 },
      buttons: { style: "outline" },
    });
  });
});

describe("applyThemePatch", () => {
  it("writes an override explicitly and leaves the rest to the preset", () => {
    const next = applyThemePatch({ preset: "midnight" }, { colors: { accent: "#FFAA00" } });
    expect(next).toEqual({ preset: "midnight", colors: { accent: "#ffaa00" } });
  });

  it("drops an override that is set back to the preset's value", () => {
    const start: CardTheme = { preset: "paper", layout: "classic" };
    expect(applyThemePatch(start, { layout: "minimal" })).toEqual({ preset: "paper" });
  });

  it("merges into existing overrides instead of replacing the group", () => {
    const start: CardTheme = { preset: "shpe-classic", buttons: { shape: "pill" } };
    expect(applyThemePatch(start, { buttons: { icons: false } })).toEqual({
      preset: "shpe-classic",
      buttons: { shape: "pill", icons: false },
    });
  });

  it("ignores undefined, malformed and out-of-range values in the patch", () => {
    const start: CardTheme = { preset: "shpe-classic", colors: { text: "#000000" } };
    const next = applyThemePatch(start, {
      colors: { text: undefined, accent: "orange" },
      background: { angle: 999, dim: -5 },
      layout: undefined,
    });
    expect(next).toEqual(start);
  });

  it("cleans junk out of a stored theme on the first edit", () => {
    const junk = {
      preset: "glass",
      colors: { accent: "red", surface: "#FFFFFF", sparkle: "#000000" },
      extra: true,
    } as unknown as CardTheme;
    const next = applyThemePatch(junk, { density: "compact" });
    expect(next).toEqual({ preset: "glass", density: "compact" });
    expect(cardThemeSchema.safeParse(next).success).toBe(true);
  });

  it("always produces a theme the strict schema accepts, with no undefined values", () => {
    let theme: CardTheme = { preset: "engineer" };
    theme = applyThemePatch(theme, { layout: "banner" });
    theme = applyThemePatch(theme, { colors: { surface: "#ffffff", muted: "#333333" } });
    theme = applyThemePatch(theme, { background: { type: "gradient", from: "#123456", angle: 45 } });
    theme = applyThemePatch(theme, { font: { heading: "playfair-display" } });
    theme = applyThemePatch(theme, { avatar: { shape: "rounded", ring: true } });
    expect(cardThemeSchema.safeParse(theme).success).toBe(true);
    expect(hasNoUndefined(theme)).toBe(true);
    expect(JSON.parse(JSON.stringify(theme))).toEqual(theme);
    expect(resolveTheme(theme).background).toMatchObject({ type: "gradient", from: "#123456", angle: 45 });
  });
});

describe("colour overrides", () => {
  it("resetThemeColor removes the override, and the empty colors group with it", () => {
    const start: CardTheme = { preset: "washu", colors: { accent: "#111111" } };
    expect(isColorOverridden(start, "accent")).toBe(true);
    const reset = resetThemeColor(start, "accent");
    expect(reset).toEqual({ preset: "washu" });
    expect(isColorOverridden(reset, "accent")).toBe(false);
  });

  it("resetThemeColor keeps the other colour overrides", () => {
    const start: CardTheme = { preset: "washu", colors: { accent: "#111111", text: "#222222" } };
    expect(resetThemeColor(start, "accent")).toEqual({ preset: "washu", colors: { text: "#222222" } });
  });

  it("hasThemeOverrides ignores overrides equal to the preset and invalid junk", () => {
    expect(hasThemeOverrides({ preset: "sunrise" })).toBe(false);
    expect(hasThemeOverrides({ preset: "sunrise", layout: "banner" })).toBe(false);
    expect(hasThemeOverrides({ preset: "sunrise", colors: { accent: "nope" } })).toBe(false);
    expect(hasThemeOverrides({ preset: "sunrise", density: "compact" })).toBe(true);
    expect(hasThemeOverrides(undefined)).toBe(false);
  });
});

describe("parseHexInput", () => {
  it.each([
    ["#1B365D", "#1b365d"],
    ["1b365d", "#1b365d"],
    ["  #abcdef ", "#abcdef"],
    ["#fa0", "#ffaa00"],
    ["FA0", "#ffaa00"],
  ])("accepts %j as %s", (raw, expected) => {
    expect(parseHexInput(raw)).toBe(expected);
  });

  it.each(["", "#", "#12345", "#1234567", "navy", "#ggg000", "rgb(0,0,0)"])("rejects %j", (raw) => {
    expect(parseHexInput(raw)).toBeNull();
  });
});

describe("block order", () => {
  const start = ["status", "links", "about"] as const;

  it("moves a block up and down, and ignores moves off either end", () => {
    expect(moveSection(start, "links", -1)).toEqual(["links", "status", "about"]);
    expect(moveSection(start, "links", 1)).toEqual(["status", "about", "links"]);
    expect(moveSection(start, "status", -1)).toEqual(["status", "links", "about"]);
    expect(moveSection(start, "about", 1)).toEqual(["status", "links", "about"]);
  });

  it("hides and shows, appending a shown block at the end", () => {
    expect(hideSection(start, "links")).toEqual(["status", "about"]);
    expect(showSection(start, "skills")).toEqual(["status", "links", "about", "skills"]);
    expect(showSection(start, "links")).toEqual(["status", "links", "about"]);
  });

  it("lists the hidden blocks in catalog order", () => {
    expect(hiddenSections(start)).toEqual(CARD_SECTION_IDS.filter((id) => !start.includes(id as never)));
  });

  it("drops unknown and repeated ids", () => {
    expect(shownSections(["links", "bogus", "links", "about"])).toEqual(["links", "about"]);
    expect(shownSections(undefined)).toEqual([]);
  });
});

describe("cardColorVars", () => {
  it("returns only custom properties, never the page background", () => {
    const vars = cardColorVars(CARD_PRESETS.engineer.theme) as Record<string, unknown>;
    expect(vars["--card-accent"]).toBe("#0b5cad");
    expect(Object.keys(vars).every((key) => key.startsWith("--"))).toBe(true);
  });
});

describe("contrastFix", () => {
  /**
   * Clicks the first "Use …" button on offer until nothing is left, like a
   * member would. `stuck` means no single change was offered for any problem.
   */
  function fixAll(start: CardTheme, maxClicks = 12) {
    let theme = start;
    for (let clicks = 0; clicks <= maxClicks; clicks += 1) {
      const issues = themeContrastIssues(resolveTheme(theme));
      if (issues.length === 0) return { theme, clicks, stuck: false };
      const fix = issues.map((issue) => contrastFix(theme, issue)).find(Boolean);
      if (!fix) return { theme, clicks, stuck: true };
      theme = applyThemePatch(theme, { colors: { [fix.key]: fix.color } });
    }
    return { theme, clicks: Infinity, stuck: false };
  }

  it("uses the issue's own suggestion when it fixes the problem by itself", () => {
    const theme: CardTheme = { preset: "shpe-classic", colors: { muted: "#d1d5db" } };
    const [issue] = themeContrastIssues(resolveTheme(theme));
    expect(contrastFix(theme, issue)).toEqual({ key: issue.fg, color: issue.suggestion });
  });

  it("offers exactly theme.colors[issue.fg] = issue.suggestion whenever that is a clean fix", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const hex = () =>
      `#${Math.floor(random() * 0xffffff)
        .toString(16)
        .padStart(6, "0")}`;

    let checked = 0;
    for (let i = 0; i < 200; i += 1) {
      const preset = CARD_PRESET_IDS[i % CARD_PRESET_IDS.length];
      const colors = Object.fromEntries(CARD_COLOR_KEYS.filter(() => random() < 0.5).map((key) => [key, hex()]));
      const theme = applyThemePatch({ preset }, { colors });
      const before = themeContrastIssues(resolveTheme(theme));
      for (const issue of before) {
        const after = themeContrastIssues(
          resolveTheme(applyThemePatch(theme, { colors: { [issue.fg]: issue.suggestion } })),
        );
        const clean =
          !after.some((i) => i.id === issue.id) && after.every((i) => before.some((b) => b.id === i.id));
        if (!clean) continue;
        expect(contrastFix(theme, issue)).toEqual({ key: issue.fg, color: issue.suggestion.toLowerCase() });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("never offers a change that leaves things no better", () => {
    const start: CardTheme = { preset: "glass", colors: { surface: "#558d11", text: "#000000" } };
    for (const issue of themeContrastIssues(resolveTheme(start))) {
      const fix = contrastFix(start, issue);
      if (!fix) continue;
      expect(fix.color).not.toBe(resolveTheme(start).colors[fix.key]);
      const after = themeContrastIssues(resolveTheme(applyThemePatch(start, { colors: { [fix.key]: fix.color } })));
      const fixedIt = !after.some((i) => i.id === issue.id);
      expect(fixedIt || after.length < themeContrastIssues(resolveTheme(start)).length).toBe(true);
    }
  });

  it("doesn't bounce between the icon and button-text rules on a dark card", () => {
    // A navy card: an accent light enough for icons is too light for white
    // button text, so the fix has to be dark button text, not another accent.
    const { theme, clicks } = fixAll({ preset: "shpe-classic", colors: { surface: "#2a4a70" } });
    expect(clicks).toBeLessThanOrEqual(4);
    expect(themeContrastIssues(resolveTheme(theme))).toEqual([]);
  });

  it("always ends: every offered fix makes progress, and nearly every theme becomes readable", () => {
    // Small deterministic PRNG, so a failure reproduces.
    let seed = 20261006;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const hex = () =>
      `#${Math.floor(random() * 0xffffff)
        .toString(16)
        .padStart(6, "0")}`;

    const runs = 300;
    let readable = 0;
    for (let i = 0; i < runs; i += 1) {
      const preset = CARD_PRESET_IDS[i % CARD_PRESET_IDS.length];
      const colors = Object.fromEntries(CARD_COLOR_KEYS.filter(() => random() < 0.6).map((key) => [key, hex()]));
      const style = (["filled", "outline", "soft", "glass"] as const)[Math.floor(random() * 4)];
      const start = applyThemePatch({ preset }, { colors, buttons: { style } });
      const { theme, clicks, stuck } = fixAll(start);
      // Never an endless back-and-forth between two warnings.
      expect({ start, ended: Number.isFinite(clicks) }).toEqual({ start, ended: true });
      if (!stuck) {
        expect(themeContrastIssues(resolveTheme(theme))).toEqual([]);
        readable += 1;
      } else {
        // The escape hatch the panel offers: the preset's own colours, with
        // filled buttons, always read.
        const reset = applyThemePatch(theme, { colors: CARD_PRESETS[preset].theme.colors, buttons: { style: "filled" } });
        expect(themeContrastIssues(resolveTheme(reset))).toEqual([]);
      }
    }
    expect(readable / runs).toBeGreaterThan(0.95);
  });
});

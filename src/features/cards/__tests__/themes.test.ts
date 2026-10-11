import { describe, expect, it } from "vitest";

import {
  CARD_PRESETS,
  CARD_PRESET_COLLECTIONS,
  contrastRatio,
  isFrostedTheme,
  resolveTheme,
  suggestPassingColor,
  themeContrastIssues,
  themeCssVars,
  themeUsesPanels,
  type ResolvedTheme,
} from "../themes";
import { CARD_LAYOUTS, CARD_PRESET_IDS, type CardTheme } from "../model";

/** A resolved theme with some fields swapped, for exercising the checks. */
function withColors(base: ResolvedTheme, colors: Partial<ResolvedTheme["colors"]>): ResolvedTheme {
  return { ...base, colors: { ...base.colors, ...colors } };
}

const classic = CARD_PRESETS["shpe-classic"].theme;

describe("contrastRatio", () => {
  it("matches the WCAG reference pairs", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #767676 is the lightest grey that passes AA on white; #777777 just fails.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#595959", "#ffffff")).toBeCloseTo(7.0, 1);
  });

  it("is symmetric and case-insensitive", () => {
    expect(contrastRatio("#1B365D", "#fff")).toBeCloseTo(contrastRatio("#ffffff", "#1b365d"), 10);
  });

  it("knows SHPE orange fails as text on white but the site's dark orange passes", () => {
    expect(contrastRatio("#e84e1b", "#ffffff")).toBeLessThan(4.5);
    expect(contrastRatio("#c43e12", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("treats anything that isn't a colour as the worst case", () => {
    expect(contrastRatio("red", "#ffffff")).toBe(1);
    expect(contrastRatio("#000000", "javascript:alert(1)")).toBe(1);
  });
});

describe("presets", () => {
  it("has every preset, each labelled and described", () => {
    expect(Object.keys(CARD_PRESETS).sort()).toEqual([...CARD_PRESET_IDS].sort());
    for (const id of CARD_PRESET_IDS) {
      const preset = CARD_PRESETS[id];
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(preset.theme.preset).toBe(id);
    }
  });

  it.each(CARD_PRESET_IDS)("%s passes every contrast check as shipped", (id) => {
    expect(themeContrastIssues(CARD_PRESETS[id].theme)).toEqual([]);
  });

  it.each(CARD_PRESET_IDS)("%s still passes with outline buttons (accent on the bare surface)", (id) => {
    const theme = CARD_PRESETS[id].theme;
    expect(themeContrastIssues({ ...theme, buttons: { ...theme.buttons, style: "outline" } })).toEqual([]);
  });

  it.each(CARD_PRESET_IDS)("%s resolves from { preset } alone to exactly its defaults", (id) => {
    expect(resolveTheme({ preset: id })).toEqual(CARD_PRESETS[id].theme);
  });

  it("stores every preset colour as lowercase #rrggbb", () => {
    for (const id of CARD_PRESET_IDS) {
      const { colors, background } = CARD_PRESETS[id].theme;
      for (const value of [...Object.values(colors), background.from, background.to]) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("covers every layout across the gallery", () => {
    const layouts = new Set(CARD_PRESET_IDS.map((id) => CARD_PRESETS[id].theme.layout));
    expect([...layouts].sort()).toEqual([...CARD_LAYOUTS].sort());
  });

  it("gives Engineer monospace type on a grid and Glass a frosted card", () => {
    const engineer = CARD_PRESETS.engineer.theme;
    expect(engineer.font).toEqual({ heading: "jetbrains-mono", body: "jetbrains-mono" });
    expect(engineer.background).toMatchObject({ type: "pattern", pattern: "grid" });
    expect(isFrostedTheme(CARD_PRESETS.glass.theme)).toBe(true);
    expect(isFrostedTheme(classic)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("applies valid overrides on top of the preset and lowercases colours", () => {
    const theme = resolveTheme({
      preset: "midnight",
      layout: "split",
      colors: { accent: "#FFAA00" },
      background: { type: "gradient", angle: 45 },
      buttons: { icons: false },
      density: "compact",
    });
    expect(theme.preset).toBe("midnight");
    expect(theme.layout).toBe("split");
    expect(theme.colors.accent).toBe("#ffaa00");
    expect(theme.colors.surface).toBe(CARD_PRESETS.midnight.theme.colors.surface);
    expect(theme.background).toEqual({ ...CARD_PRESETS.midnight.theme.background, type: "gradient", angle: 45 });
    expect(theme.buttons).toEqual({ ...CARD_PRESETS.midnight.theme.buttons, icons: false });
    expect(theme.density).toBe("compact");
  });

  it("falls back to SHPE Classic for a missing or unknown preset", () => {
    expect(resolveTheme(null)).toEqual(classic);
    expect(resolveTheme(undefined)).toEqual(classic);
    expect(resolveTheme({ preset: "vaporwave" } as unknown as CardTheme)).toEqual(classic);
    expect(resolveTheme("shpe-classic" as unknown as CardTheme)).toEqual(classic);
    expect(resolveTheme([] as unknown as CardTheme)).toEqual(classic);
  });

  it("falls back per field on junk, keeping the valid fields around it", () => {
    const junk = {
      preset: "paper",
      layout: "carousel",
      colors: { text: "red", muted: "#12345", accent: "#00ff00", surface: 42, bogus: "#000000" },
      background: { type: "video", from: "#zzzzzz", to: "#ABCDEF", angle: 999, dim: -5, pattern: "plaid" },
      font: { heading: "comic-sans", body: "inter" },
      buttons: { shape: "blob", style: "glass", arrangement: "carousel", icons: "yes" },
      avatar: { shape: "hexagon", ring: 1 },
      density: "airy",
      extra: { anything: true },
    } as unknown as CardTheme;
    const paper = CARD_PRESETS.paper.theme;
    const theme = resolveTheme(junk);

    expect(theme.layout).toBe(paper.layout);
    expect(theme.colors).toEqual({ ...paper.colors, accent: "#00ff00" });
    expect(theme.background).toEqual({ ...paper.background, to: "#abcdef" });
    expect(theme.font).toEqual({ heading: paper.font.heading, body: "inter" });
    expect(theme.buttons).toEqual({ ...paper.buttons, style: "glass" });
    expect(theme.avatar).toEqual(paper.avatar);
    expect(theme.density).toBe(paper.density);
    expect(theme).not.toHaveProperty("extra");
  });

  it("rejects fractional and out-of-range numbers rather than clamping them", () => {
    const theme = resolveTheme({ preset: "glass", background: { type: "image", angle: 12.5, dim: 81 } });
    expect(theme.background.angle).toBe(CARD_PRESETS.glass.theme.background.angle);
    expect(theme.background.dim).toBe(CARD_PRESETS.glass.theme.background.dim);
    expect(resolveTheme({ preset: "glass", background: { type: "image", angle: 360, dim: 80 } }).background)
      .toMatchObject({ angle: 360, dim: 80 });
  });

  it("does not share state with the presets", () => {
    const theme = resolveTheme({ preset: "sunrise" });
    theme.colors.text = "#000000";
    expect(CARD_PRESETS.sunrise.theme.colors.text).not.toBe("#000000");
  });
});

describe("themeContrastIssues", () => {
  it("flags unreadable text with a suggestion that passes", () => {
    const issues = themeContrastIssues(withColors(classic, { text: "#cccccc" }));
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue).toMatchObject({ id: "text-on-surface", fg: "text", bg: "surface", required: 4.5 });
    expect(issue.ratio).toBeLessThan(4.5);
    expect(issue.message).toMatch(/main text/i);
    expect(issue.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(issue.suggestion, classic.colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("flags faint muted text", () => {
    const issues = themeContrastIssues(withColors(classic, { muted: "#9ca3af" }));
    expect(issues.map((i) => i.id)).toEqual(["muted-on-surface"]);
    expect(contrastRatio(issues[0].suggestion, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("checks button text on the accent fill, and prefers darkening a bright accent", () => {
    // White on the brand orange: 3.69:1. Darkening the orange is a far smaller
    // change than turning the button text nearly black.
    const theme = withColors(classic, { accent: "#e84e1b" });
    const issue = themeContrastIssues(theme).find((i) => i.id === "button-text-on-accent");
    expect(issue).toBeDefined();
    expect(issue).toMatchObject({ fg: "accent", bg: "accentText" });
    expect(contrastRatio("#ffffff", issue!.suggestion)).toBeGreaterThanOrEqual(4.5);
    // The suggested accent also keeps the 3:1 icon rule on the white card.
    expect(contrastRatio(issue!.suggestion, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("suggests recolouring the button text when that is the smaller change", () => {
    // A pale accent on a dark card: lightening the accent far enough would take
    // it nearly to white, while darkening the grey button text is a small step.
    const theme = withColors(CARD_PRESETS.midnight.theme, { accent: "#fdba74", accentText: "#6b7280" });
    expect(contrastRatio("#6b7280", "#fdba74")).toBeLessThan(4.5);
    const issue = themeContrastIssues(theme).find((i) => i.id === "button-text-on-accent")!;
    expect(issue).toMatchObject({ fg: "accentText", bg: "accent" });
    expect(contrastRatio(issue.suggestion, "#fdba74")).toBeGreaterThanOrEqual(4.5);
  });

  it("checks the accent as button text when buttons aren't filled", () => {
    const outline = { ...classic, buttons: { ...classic.buttons, style: "outline" as const } };
    const theme = withColors(outline, { accent: "#f59e0b" });
    const issues = themeContrastIssues(theme);
    expect(issues.map((i) => i.id)).toContain("button-text-on-surface");
    // One warning per colour: the 3:1 rule is covered by the 4.5:1 fix.
    expect(issues.map((i) => i.id)).not.toContain("accent-on-surface");
    const fix = issues.find((i) => i.id === "button-text-on-surface")!;
    expect(contrastRatio(fix.suggestion, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("measures soft buttons against their tinted fill, not the bare card", () => {
    // Classic's orange passes on white (5.2:1) but not on its own 14% tint.
    const soft = { ...classic, buttons: { ...classic.buttons, style: "soft" as const } };
    expect(contrastRatio(classic.colors.accent, classic.colors.surface)).toBeGreaterThanOrEqual(4.5);
    const issue = themeContrastIssues(soft).find((i) => i.id === "button-text-on-surface");
    expect(issue).toBeDefined();
    expect(themeContrastIssues(withColors(soft, { accent: issue!.suggestion }))).toEqual([]);
  });

  it("asks only 3:1 of the accent when buttons are filled", () => {
    // #d97706 is ~3.2:1 on white: fine for icons, and the filled buttons use
    // dark text on it.
    const theme = withColors(classic, { accent: "#d97706", accentText: "#111827" });
    expect(themeContrastIssues(theme)).toEqual([]);
    const tooPale = withColors(classic, { accent: "#fcd34d", accentText: "#111827" });
    expect(themeContrastIssues(tooPale).map((i) => i.id)).toEqual(["accent-on-surface"]);
  });

  it("holds a frosted card to every backdrop a photo could give it", () => {
    const glass = CARD_PRESETS.glass.theme;
    // Mid grey on white is fine on an opaque card...
    const opaque = withColors(classic, { muted: "#6b7280" });
    expect(themeContrastIssues(opaque)).toEqual([]);
    // ...but behind frosted glass a dark photo pulls the surface down to it.
    const frosted = withColors(glass, { muted: "#6b7280" });
    const issue = themeContrastIssues(frosted).find((i) => i.id === "muted-on-surface");
    expect(issue).toBeDefined();
    expect(themeContrastIssues(withColors(frosted, { muted: issue!.suggestion }))).toEqual([]);
  });

  it("produces suggestions that clear every issue when applied one at a time", () => {
    let theme = withColors(CARD_PRESETS.midnight.theme, {
      text: "#334155",
      muted: "#1e293b",
      accent: "#7c2d12",
      accentText: "#0f172a",
    });
    for (let round = 0; round < 6; round++) {
      const [issue] = themeContrastIssues(theme);
      if (!issue) break;
      theme = withColors(theme, { [issue.fg]: issue.suggestion });
    }
    expect(themeContrastIssues(theme)).toEqual([]);
  });

  it("reports ratios rounded down", () => {
    const [issue] = themeContrastIssues(withColors(classic, { text: "#777777" }));
    expect(issue.ratio).toBe(4.47);
  });
});

describe("suggestPassingColor", () => {
  it("returns the colour unchanged when it already passes", () => {
    expect(suggestPassingColor("#1B365D", "#ffffff", 4.5)).toBe("#1b365d");
  });

  it("darkens on a light background and lightens on a dark one, keeping the hue", () => {
    const onWhite = suggestPassingColor("#e84e1b", "#ffffff", 4.5);
    expect(contrastRatio(onWhite, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(onWhite, "#ffffff")).toBeLessThan(5.5);
    const onNavy = suggestPassingColor("#1e40af", "#0f172a", 4.5);
    expect(contrastRatio(onNavy, "#0f172a")).toBeGreaterThanOrEqual(4.5);
    // Still recognisably blue: blue channel dominant.
    const [r, , b] = [1, 3, 5].map((i) => parseInt(onNavy.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
  });

  it("can always reach 4.5:1, even against mid grey", () => {
    const fix = suggestPassingColor("#777777", "#767676", 4.5);
    expect(contrastRatio(fix, "#767676")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("themeCssVars", () => {
  it("exposes the theme as custom properties", () => {
    const style = themeCssVars(classic) as Record<string, string>;
    expect(style["--card-bg"]).toBe("#1b365d");
    expect(style["--card-surface"]).toBe("#ffffff");
    expect(style["--card-text"]).toBe("#1b365d");
    expect(style["--card-muted"]).toBe("#4b5563");
    expect(style["--card-accent"]).toBe("#c43e12");
    expect(style["--card-accent-text"]).toBe("#ffffff");
    expect(style["--card-font-body"]).toMatch(/^"Libre Franklin"/);
    expect(style["--card-button-radius"]).toBe("0.75rem");
    expect(style["--card-button-h"]).toBe("3.25rem");
    expect(style["--card-backdrop"]).toBe("none");
    expect(style.backgroundColor).toBe("#1b365d");
    expect(style.backgroundImage).toBeUndefined();
  });

  it("keeps buttons at least 44px tall at either density", () => {
    for (const density of ["compact", "comfortable"] as const) {
      const style = themeCssVars({ ...classic, density }) as Record<string, string>;
      expect(parseFloat(style["--card-button-h"]) * 16).toBeGreaterThanOrEqual(44);
    }
  });

  it("draws a gradient at the chosen angle", () => {
    const style = themeCssVars(CARD_PRESETS.sunrise.theme);
    expect(style.backgroundImage).toBe("linear-gradient(160deg, #e84e1b, #f5a623)");
  });

  it("puts a background photo under a dim overlay", () => {
    const theme = resolveTheme({ preset: "glass", background: { type: "image", dim: 30 } });
    const url = "https://abc.supabase.co/storage/v1/object/public/card-media/a/b.webp";
    const style = themeCssVars(theme, url);
    expect(style.backgroundImage).toBe(
      `linear-gradient(rgba(0, 0, 0, 0.30), rgba(0, 0, 0, 0.30)), url("${url}")`,
    );
    expect(style.backgroundSize).toBe("cover");
  });

  it("falls back to the gradient when there is no usable photo URL", () => {
    const theme = resolveTheme({ preset: "glass", background: { type: "image" } });
    const gradient = "linear-gradient(135deg, #4338ca, #e84e1b)";
    expect(themeCssVars(theme, null).backgroundImage).toBe(gradient);
    expect(themeCssVars(theme, 'https://x.test/a.webp") , url("https://evil.test/p.gif').backgroundImage).toBe(gradient);
    expect(themeCssVars(theme, "javascript:alert(1)").backgroundImage).toBe(gradient);
  });

  it("ignores a photo URL when the background isn't a photo", () => {
    expect(themeCssVars(classic, "https://x.test/a.webp").backgroundImage).toBeUndefined();
  });

  it("draws patterns with CSS gradients only", () => {
    for (const pattern of ["dots", "grid", "topo", "diagonal"] as const) {
      const theme = resolveTheme({ preset: "engineer", background: { type: "pattern", pattern } });
      const image = String(themeCssVars(theme).backgroundImage);
      expect(image).toMatch(/gradient\(/);
      expect(image).not.toMatch(/url\(/);
    }
  });

  it("makes the Glass card translucent and blurred", () => {
    const style = themeCssVars(CARD_PRESETS.glass.theme) as Record<string, string>;
    expect(style["--card-surface-fill"]).toBe("rgba(255, 255, 255, 0.8)");
    expect(style["--card-backdrop"]).toMatch(/blur\(/);
  });
});

describe("the professional collection", () => {
  const professional = CARD_PRESET_IDS.filter((id) => CARD_PRESETS[id].collection === "professional");

  it("adds six presets and keeps all seven originals", () => {
    expect(professional).toEqual(["executive", "editorial", "studio", "slate", "heritage", "signature"]);
    expect(CARD_PRESET_IDS.filter((id) => CARD_PRESETS[id].collection === "original")).toEqual([
      "shpe-classic",
      "sunrise",
      "midnight",
      "paper",
      "washu",
      "engineer",
      "glass",
    ]);
  });

  it("lists every preset exactly once, the professional collection first", () => {
    expect(CARD_PRESET_COLLECTIONS.map((c) => c.id)).toEqual(["professional", "original"]);
    const listed = CARD_PRESET_COLLECTIONS.flatMap((c) => [...c.presets]);
    expect([...listed].sort()).toEqual([...CARD_PRESET_IDS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("gives each one its own layout, not just a new palette", () => {
    const layouts = professional.map((id) => CARD_PRESETS[id].theme.layout);
    expect(new Set(layouts).size).toBe(professional.length);
    const originalLayouts = new Set(
      CARD_PRESET_IDS.filter((id) => CARD_PRESETS[id].collection === "original").map((id) => CARD_PRESETS[id].theme.layout),
    );
    for (const layout of layouts) expect(originalLayouts.has(layout), layout).toBe(false);
  });

  it("gives each one its own pairing of two type families", () => {
    const pairings = professional.map((id) => {
      const { heading, body } = CARD_PRESETS[id].theme.font;
      expect(heading, id).not.toBe(body);
      return `${heading}+${body}`;
    });
    expect(new Set(pairings).size).toBe(professional.length);
  });

  it("varies spacing and the link and button treatment across the set", () => {
    const treatments = professional.map((id) => {
      const { buttons, density } = CARD_PRESETS[id].theme;
      return `${buttons.arrangement}/${buttons.style}/${buttons.shape}/${buttons.primary}/${density}`;
    });
    expect(new Set(treatments).size).toBe(professional.length);
    expect(new Set(professional.map((id) => CARD_PRESETS[id].theme.density))).toEqual(
      new Set(["compact", "comfortable", "spacious"]),
    );
  });

  it("keeps the brief's palettes: Executive's navy button, Slate's dark card, Heritage's ink main button", () => {
    const executive = themeCssVars(CARD_PRESETS.executive.theme) as Record<string, string>;
    expect(executive["--card-primary"]).toBe(CARD_PRESETS.executive.theme.colors.text);
    expect(contrastRatio(CARD_PRESETS.slate.theme.colors.surface, "#000000")).toBeLessThan(2);
    expect(CARD_PRESETS.heritage.theme.buttons.primary).toBe("ink");
  });
});

describe("design tokens", () => {
  it("fills the main button with the accent, or with the text colour for ink", () => {
    const accent = themeCssVars(classic) as Record<string, string>;
    expect(accent["--card-primary"]).toBe(classic.colors.accent);
    expect(accent["--card-primary-text"]).toBe(classic.colors.accentText);

    const ink = themeCssVars({ ...classic, buttons: { ...classic.buttons, primary: "ink" } }) as Record<string, string>;
    expect(ink["--card-primary"]).toBe(classic.colors.text);
    expect(ink["--card-primary-text"]).toBe(classic.colors.surface);
  });

  it("defaults the main button to the accent for themes saved before it existed", () => {
    for (const id of ["shpe-classic", "sunrise", "midnight", "paper", "washu", "engineer", "glass"] as const) {
      expect(resolveTheme({ preset: id }).buttons.primary).toBe("accent");
    }
    expect(resolveTheme({ preset: "executive", buttons: { primary: "neon" } } as unknown as CardTheme).buttons.primary)
      .toBe("ink");
  });

  it("raises panels a shade toward the text colour, lighter on a dark card and darker on a light one", () => {
    const dark = themeCssVars(CARD_PRESETS.slate.theme) as Record<string, string>;
    const light = themeCssVars(classic) as Record<string, string>;
    expect(contrastRatio(dark["--card-raised"], "#000000")).toBeGreaterThan(
      contrastRatio(CARD_PRESETS.slate.theme.colors.surface, "#000000"),
    );
    expect(contrastRatio(light["--card-raised"], "#ffffff")).toBeGreaterThan(1);
    expect(dark["--card-raised"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gives Spacious more room between blocks than Comfortable, with padding that follows the screen", () => {
    const spacious = themeCssVars({ ...classic, density: "spacious" }) as Record<string, string>;
    const comfortable = themeCssVars(classic) as Record<string, string>;
    expect(parseFloat(spacious["--card-gap"])).toBeGreaterThan(parseFloat(comfortable["--card-gap"]));
    expect(spacious["--card-pad"]).toMatch(/^clamp\(/);
    // Never below the 44px touch target.
    expect(parseFloat(spacious["--card-button-h"]) * 16).toBeGreaterThanOrEqual(44);
  });
});

describe("themeContrastIssues: panels and hairline buttons", () => {
  it("holds text on a layered card to the raised panels as well as the card", () => {
    // Passes on the white card by a hair; the panels, a shade darker, are below 4.5:1.
    const muted = "#757575";
    expect(contrastRatio(muted, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    const flat = withColors(classic, { muted });
    expect(themeContrastIssues(flat)).toEqual([]);
    const layered = { ...flat, layout: "layered" as const };
    expect(themeUsesPanels(layered)).toBe(true);
    const issues = themeContrastIssues(layered);
    expect(issues.map((i) => i.id)).toEqual(["muted-on-surface"]);
    // The suggestion passes against the panel too.
    const fixed = withColors(layered, { muted: issues[0].suggestion });
    expect(themeContrastIssues(fixed)).toEqual([]);
  });

  it("doesn't ask hairline buttons' accent to pass as text, only as icons", () => {
    // 3.3:1 on white: enough for icons, not for a label.
    const accent = "#e2711d";
    expect(contrastRatio(accent, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(accent, "#ffffff")).toBeLessThan(4.5);
    const base = withColors(classic, { accent, accentText: "#000000" });
    const hairline = { ...base, buttons: { ...base.buttons, style: "hairline" as const } };
    const outline = { ...base, buttons: { ...base.buttons, style: "outline" as const } };
    expect(themeContrastIssues(hairline)).toEqual([]);
    expect(themeContrastIssues(outline).map((i) => i.id)).toEqual(["button-text-on-surface"]);
  });

  it("needs no separate rule for an ink main button: it's the text pairing, reversed", () => {
    const unreadable = withColors({ ...classic, buttons: { ...classic.buttons, primary: "ink" } }, { text: "#d1d5db" });
    expect(themeContrastIssues(unreadable).map((i) => i.id)).toContain("text-on-surface");
  });
});

import type { CSSProperties } from "react";
import {
  BACKGROUND_DIM_MAX,
  CARD_AVATAR_SHAPES,
  CARD_BACKGROUND_TYPES,
  CARD_BUTTON_ARRANGEMENTS,
  CARD_BUTTON_SHAPES,
  CARD_BUTTON_STYLES,
  CARD_COLOR_KEYS,
  CARD_DENSITIES,
  CARD_LAYOUTS,
  CARD_PATTERNS,
  CARD_PRESET_IDS,
  CARD_PRIMARY_FILLS,
  GRADIENT_ANGLE_MAX,
  HEX_COLOR_PATTERN,
  type CardAvatarShape,
  type CardBackgroundType,
  type CardButtonArrangement,
  type CardButtonShape,
  type CardButtonStyle,
  type CardColorKey,
  type CardDensity,
  type CardFontId,
  type CardLayout,
  type CardPattern,
  type CardPresetId,
  type CardPrimaryFill,
  type CardTheme,
} from "./model";
import { CARD_FONTS, isCardFontId } from "./fonts";

/**
 * Card themes: the thirteen presets in two collections, how a stored theme
 * resolves against them, how a resolved theme becomes CSS, and the contrast
 * rules that keep every card readable.
 *
 * A stored theme is `{ preset, ...overrides }` (see CardTheme in model.ts).
 * The renderer never trusts it: resolveTheme() takes each field from the
 * stored value only when that value is valid and otherwise from the preset, so
 * a theme saved before a rule tightened, or a hand-edited row, still renders
 * as something sensible rather than throwing.
 *
 * Colours only ever reach the page as validated #rrggbb strings in CSS custom
 * properties, and the only image URL ever used is the one the caller built
 * from a storage path (cardMediaUrl). There is no way to get raw CSS in.
 */

/* ── Resolved theme ──────────────────────────────────────────────────────── */

export interface ResolvedTheme {
  preset: CardPresetId;
  layout: CardLayout;
  /** All six, lowercase #rrggbb. */
  colors: Record<CardColorKey, string>;
  background: {
    type: CardBackgroundType;
    from: string;
    to: string;
    angle: number;
    dim: number;
    pattern: CardPattern;
  };
  font: { heading: CardFontId; body: CardFontId };
  buttons: {
    shape: CardButtonShape;
    style: CardButtonStyle;
    arrangement: CardButtonArrangement;
    icons: boolean;
    primary: CardPrimaryFill;
  };
  avatar: { shape: CardAvatarShape; ring: boolean };
  density: CardDensity;
}

export type CardPresetCollectionId = "professional" | "original";

export interface CardPresetInfo {
  label: string;
  /** One line for the preset gallery. */
  description: string;
  collection: CardPresetCollectionId;
  theme: ResolvedTheme;
}

/*
 * Every preset passes themeContrastIssues() with its own settings; the tests
 * hold it to that. Where a brand colour fails as text it is used decoratively
 * instead: SHPE orange #e84e1b is 3.69:1 against white, so the Classic
 * buttons use the site's own AA orange (#c43e12, 5.2:1) and the bright orange
 * appears in the banner band and the Sunrise gradient, where nothing has to be
 * read against it.
 *
 * The professional collection gives each preset its own layout, type pairing,
 * spacing and link treatment rather than a new palette on a shared layout:
 *
 *   Executive  profile layout, Source Serif 4 / Source Sans 3, contact rows,
 *              a navy (text-colour) main button with bronze kept for details
 *   Editorial  editorial layout, Instrument Serif / Instrument Sans, spacious,
 *              an indexed list of links between fine rules
 *   Studio     studio layout, Plus Jakarta Sans / Inter, compact, link cards
 *              grouped into work, professional and social
 *   Slate      layered layout, Manrope / Inter, raised panels on charcoal
 *   Heritage   letterhead layout, EB Garamond / Libre Franklin, the
 *              affiliation above the name, two columns of hairline buttons
 *   Signature  monogram layout, Cormorant Garamond / Inter, spacious, the
 *              name or initials as the centrepiece over plain rows
 */
export const CARD_PRESETS: Record<CardPresetId, CardPresetInfo> = {
  "shpe-classic": {
    label: "SHPE Classic",
    description: "Navy and orange on white, in the chapter's own colors.",
    collection: "original",
    theme: {
      preset: "shpe-classic",
      layout: "classic",
      colors: {
        background: "#1b365d",
        surface: "#ffffff",
        text: "#1b365d",
        muted: "#4b5563",
        accent: "#c43e12",
        accentText: "#ffffff",
      },
      background: { type: "solid", from: "#1b365d", to: "#e84e1b", angle: 135, dim: 40, pattern: "dots" },
      font: { heading: "libre-franklin", body: "libre-franklin" },
      buttons: { shape: "rounded", style: "filled", arrangement: "list", icons: true, primary: "accent" },
      avatar: { shape: "circle", ring: true },
      density: "comfortable",
    },
  },
  sunrise: {
    label: "Sunrise",
    description: "A warm orange-to-gold gradient behind a bright card.",
    collection: "original",
    theme: {
      preset: "sunrise",
      layout: "banner",
      colors: {
        background: "#e84e1b",
        surface: "#fffaf5",
        text: "#3d1a0a",
        muted: "#6e4a36",
        accent: "#b4400f",
        accentText: "#ffffff",
      },
      background: { type: "gradient", from: "#e84e1b", to: "#f5a623", angle: 160, dim: 40, pattern: "dots" },
      font: { heading: "dm-sans", body: "dm-sans" },
      buttons: { shape: "pill", style: "filled", arrangement: "list", icons: true, primary: "accent" },
      avatar: { shape: "circle", ring: true },
      density: "comfortable",
    },
  },
  midnight: {
    label: "Midnight",
    description: "Dark and quiet, with an accent that glows.",
    collection: "original",
    theme: {
      preset: "midnight",
      layout: "classic",
      colors: {
        background: "#020617",
        surface: "#0f172a",
        text: "#f8fafc",
        muted: "#cbd5e1",
        accent: "#fb923c",
        accentText: "#111827",
      },
      background: { type: "solid", from: "#0f172a", to: "#1e293b", angle: 180, dim: 40, pattern: "dots" },
      font: { heading: "space-grotesk", body: "inter" },
      buttons: { shape: "rounded", style: "outline", arrangement: "list", icons: true, primary: "accent" },
      avatar: { shape: "circle", ring: true },
      density: "comfortable",
    },
  },
  paper: {
    label: "Paper",
    description: "Off-white and typographic. Lets your words do the work.",
    collection: "original",
    theme: {
      preset: "paper",
      layout: "minimal",
      colors: {
        background: "#f4f1ea",
        surface: "#fbfaf7",
        text: "#1c1917",
        muted: "#57534e",
        accent: "#1c1917",
        accentText: "#fbfaf7",
      },
      background: { type: "solid", from: "#f4f1ea", to: "#e7e1d4", angle: 180, dim: 40, pattern: "dots" },
      font: { heading: "playfair-display", body: "inter" },
      buttons: { shape: "square", style: "outline", arrangement: "list", icons: false, primary: "accent" },
      avatar: { shape: "square", ring: false },
      density: "comfortable",
    },
  },
  washu: {
    label: "WashU",
    description: "University crimson and green, with a conference-badge look.",
    collection: "original",
    theme: {
      preset: "washu",
      layout: "badge",
      colors: {
        background: "#a51417",
        surface: "#ffffff",
        text: "#7a1014",
        muted: "#555555",
        accent: "#007360",
        accentText: "#ffffff",
      },
      background: { type: "solid", from: "#a51417", to: "#007360", angle: 135, dim: 40, pattern: "diagonal" },
      font: { heading: "libre-franklin", body: "libre-franklin" },
      buttons: { shape: "rounded", style: "filled", arrangement: "list", icons: true, primary: "accent" },
      avatar: { shape: "circle", ring: false },
      density: "comfortable",
    },
  },
  engineer: {
    label: "Engineer",
    description: "Monospace type on a blueprint grid.",
    collection: "original",
    theme: {
      preset: "engineer",
      layout: "split",
      colors: {
        background: "#0b3a6e",
        surface: "#f5f9ff",
        text: "#0b2545",
        muted: "#3d5a80",
        accent: "#0b5cad",
        accentText: "#ffffff",
      },
      background: { type: "pattern", from: "#0b3a6e", to: "#0b2545", angle: 180, dim: 40, pattern: "grid" },
      font: { heading: "jetbrains-mono", body: "jetbrains-mono" },
      buttons: { shape: "square", style: "outline", arrangement: "list", icons: true, primary: "accent" },
      avatar: { shape: "square", ring: false },
      density: "compact",
    },
  },
  glass: {
    label: "Glass",
    description: "A frosted card over your photo or a bold gradient.",
    collection: "original",
    theme: {
      preset: "glass",
      layout: "classic",
      colors: {
        background: "#4338ca",
        surface: "#ffffff",
        text: "#111827",
        muted: "#374151",
        accent: "#3730a3",
        accentText: "#ffffff",
      },
      background: { type: "gradient", from: "#4338ca", to: "#e84e1b", angle: 135, dim: 35, pattern: "topo" },
      font: { heading: "dm-sans", body: "dm-sans" },
      buttons: { shape: "pill", style: "glass", arrangement: "list", icons: true, primary: "accent" },
      avatar: { shape: "circle", ring: true },
      density: "comfortable",
    },
  },

  /* ── The professional collection ── */

  executive: {
    label: "Executive",
    description: "Navy and ivory with a touch of bronze. Your portrait beside your name, and quiet contact rows.",
    collection: "professional",
    theme: {
      preset: "executive",
      layout: "profile",
      colors: {
        background: "#13213a",
        surface: "#fbf8f1",
        text: "#15223b",
        muted: "#545e6f",
        accent: "#7a5c33",
        accentText: "#fffcf5",
      },
      background: { type: "solid", from: "#13213a", to: "#7a5c33", angle: 160, dim: 45, pattern: "diagonal" },
      font: { heading: "source-serif-4", body: "source-sans-3" },
      buttons: { shape: "rounded", style: "hairline", arrangement: "rows", icons: true, primary: "ink" },
      avatar: { shape: "rounded", ring: false },
      density: "comfortable",
    },
  },
  editorial: {
    label: "Editorial",
    description: "A serif name, generous margins and fine rules, set like a magazine profile.",
    collection: "professional",
    theme: {
      preset: "editorial",
      layout: "editorial",
      colors: {
        background: "#efece6",
        surface: "#fdfcf9",
        text: "#1f1e1c",
        muted: "#66625c",
        accent: "#3a3734",
        accentText: "#fdfcf9",
      },
      background: { type: "solid", from: "#efece6", to: "#d9d3c7", angle: 180, dim: 40, pattern: "grid" },
      font: { heading: "instrument-serif", body: "instrument-sans" },
      buttons: { shape: "square", style: "hairline", arrangement: "rows", icons: false, primary: "ink" },
      avatar: { shape: "square", ring: false },
      density: "spacious",
    },
  },
  studio: {
    label: "Studio",
    description: "Crisp white and graphite with one accent. Links sorted into work, professional and social.",
    collection: "professional",
    theme: {
      preset: "studio",
      layout: "studio",
      colors: {
        background: "#f3f4f6",
        surface: "#ffffff",
        text: "#16181d",
        muted: "#5b616b",
        accent: "#2949d6",
        accentText: "#ffffff",
      },
      background: { type: "solid", from: "#f3f4f6", to: "#dde3fb", angle: 180, dim: 40, pattern: "dots" },
      font: { heading: "plus-jakarta-sans", body: "inter" },
      buttons: { shape: "rounded", style: "soft", arrangement: "grouped", icons: true, primary: "accent" },
      avatar: { shape: "rounded", ring: false },
      density: "compact",
    },
  },
  slate: {
    label: "Slate",
    description: "Layered charcoal with soft blue accents. Depth from surfaces, not color.",
    collection: "professional",
    theme: {
      preset: "slate",
      layout: "layered",
      colors: {
        background: "#0f1114",
        surface: "#1a1d22",
        text: "#eceef1",
        muted: "#a7aeb8",
        accent: "#8fb1e6",
        accentText: "#0d1420",
      },
      background: { type: "gradient", from: "#1c2129", to: "#0b0c0f", angle: 180, dim: 40, pattern: "grid" },
      font: { heading: "manrope", body: "inter" },
      buttons: { shape: "rounded", style: "soft", arrangement: "rows", icons: true, primary: "accent" },
      avatar: { shape: "circle", ring: false },
      density: "comfortable",
    },
  },
  heritage: {
    label: "Heritage",
    description: "Ivory with crimson and navy. Your university or employer leads, like a letterhead.",
    collection: "professional",
    theme: {
      preset: "heritage",
      layout: "letterhead",
      colors: {
        background: "#ece5d6",
        surface: "#fdfaf2",
        text: "#1c2a48",
        muted: "#5a5e68",
        accent: "#9b1c31",
        accentText: "#fdfaf2",
      },
      background: { type: "solid", from: "#ece5d6", to: "#d6cbb3", angle: 180, dim: 40, pattern: "diagonal" },
      font: { heading: "eb-garamond", body: "libre-franklin" },
      buttons: { shape: "square", style: "hairline", arrangement: "compact", icons: true, primary: "ink" },
      avatar: { shape: "circle", ring: true },
      density: "comfortable",
    },
  },
  signature: {
    label: "Signature",
    description: "Your name or initials, set large. Fine rules, a single accent, and a photo only if you want one.",
    collection: "professional",
    theme: {
      preset: "signature",
      layout: "monogram",
      colors: {
        background: "#f4f2ee",
        surface: "#ffffff",
        text: "#141414",
        muted: "#5d5d5d",
        accent: "#23408e",
        accentText: "#ffffff",
      },
      background: { type: "solid", from: "#f4f2ee", to: "#dcd7cd", angle: 180, dim: 40, pattern: "dots" },
      font: { heading: "cormorant-garamond", body: "inter" },
      buttons: { shape: "pill", style: "hairline", arrangement: "rows", icons: false, primary: "accent" },
      avatar: { shape: "circle", ring: true },
      density: "spacious",
    },
  },
};

export interface CardPresetCollection {
  id: CardPresetCollectionId;
  label: string;
  description: string;
  presets: readonly CardPresetId[];
}

/** How the Design tab groups the gallery, in display order. */
export const CARD_PRESET_COLLECTIONS: readonly CardPresetCollection[] = [
  {
    id: "professional",
    label: "Professional",
    description: "Refined, quieter profiles to share with recruiters at a career fair or conference.",
    presets: CARD_PRESET_IDS.filter((id) => CARD_PRESETS[id].collection === "professional"),
  },
  {
    id: "original",
    label: "Originals",
    description: "The first seven designs: bolder color, patterns and the chapter's own look.",
    presets: CARD_PRESET_IDS.filter((id) => CARD_PRESETS[id].collection === "original"),
  },
];

/* ── Resolving a stored theme ────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : fallback;
}

function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * The preset's defaults with every valid override applied. Tolerant by
 * design: an unknown preset becomes SHPE Classic, and any field that is the
 * wrong type or out of range quietly takes the preset's value. Never throws.
 */
export function resolveTheme(theme: CardTheme | null | undefined): ResolvedTheme {
  const raw: Record<string, unknown> = isRecord(theme) ? theme : {};
  const presetId = oneOf(CARD_PRESET_IDS, raw.preset, "shpe-classic");
  const base = CARD_PRESETS[presetId].theme;

  const colorsIn = isRecord(raw.colors) ? raw.colors : {};
  const colors = {} as Record<CardColorKey, string>;
  for (const key of CARD_COLOR_KEYS) colors[key] = hexOr(colorsIn[key], base.colors[key]);

  const bg = isRecord(raw.background) ? raw.background : {};
  const font = isRecord(raw.font) ? raw.font : {};
  const buttons = isRecord(raw.buttons) ? raw.buttons : {};
  const avatar = isRecord(raw.avatar) ? raw.avatar : {};

  return {
    preset: presetId,
    layout: oneOf(CARD_LAYOUTS, raw.layout, base.layout),
    colors,
    background: {
      type: oneOf(CARD_BACKGROUND_TYPES, bg.type, base.background.type),
      from: hexOr(bg.from, base.background.from),
      to: hexOr(bg.to, base.background.to),
      angle: intInRange(bg.angle, 0, GRADIENT_ANGLE_MAX, base.background.angle),
      dim: intInRange(bg.dim, 0, BACKGROUND_DIM_MAX, base.background.dim),
      pattern: oneOf(CARD_PATTERNS, bg.pattern, base.background.pattern),
    },
    font: {
      heading: isCardFontId(font.heading) ? font.heading : base.font.heading,
      body: isCardFontId(font.body) ? font.body : base.font.body,
    },
    buttons: {
      shape: oneOf(CARD_BUTTON_SHAPES, buttons.shape, base.buttons.shape),
      style: oneOf(CARD_BUTTON_STYLES, buttons.style, base.buttons.style),
      arrangement: oneOf(CARD_BUTTON_ARRANGEMENTS, buttons.arrangement, base.buttons.arrangement),
      icons: boolOr(buttons.icons, base.buttons.icons),
      primary: oneOf(CARD_PRIMARY_FILLS, buttons.primary, base.buttons.primary),
    },
    avatar: {
      shape: oneOf(CARD_AVATAR_SHAPES, avatar.shape, base.avatar.shape),
      ring: boolOr(avatar.ring, base.avatar.ring),
    },
    density: oneOf(CARD_DENSITIES, raw.density, base.density),
  };
}

/*
 * Whether a resolved theme shows the photo. The rule lives in photoVisibility.ts
 * so the vCard and the link-preview edge function can share it without loading
 * this file; it is re-exported here for code that already has a ResolvedTheme.
 */
export { themeShowsPhoto } from "./photoVisibility";

/* ── Colour maths ────────────────────────────────────────────────────────── */

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function parseHex(value: string | null | undefined): Rgb | null {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** `t` of the way from a to b, per channel: what alpha compositing does. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb.map((c) => Math.round(c)).join(", ")}, ${alpha})`;
}

/** WCAG relative luminance (sRGB, with the corrected 0.04045 threshold). */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratioOfLuminances(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function rgbContrast(a: Rgb, b: Rgb): number {
  return ratioOfLuminances(luminance(a), luminance(b));
}

/**
 * WCAG 2.x contrast ratio, 1 to 21. Order doesn't matter. Anything that isn't
 * a hex colour counts as 1, the worst case, so bad input can only ever make a
 * check fail, never pass.
 */
export function contrastRatio(fg: string, bg: string): number {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return 1;
  return rgbContrast(a, b);
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const hn = h / 360;
  return [hue(hn + 1 / 3) * 255, hue(hn) * 255, hue(hn - 1 / 3) * 255];
}

/**
 * The nearest colour, by lightness alone, that satisfies `passes`. Hue and
 * saturation stay put so the suggestion still looks like the member's choice,
 * just lighter or darker. Both directions are tried and the smaller change
 * wins. Lightness runs all the way to black and white, so for a single
 * background a passing colour always exists at 4.5:1 (one of black or white is
 * always at least 4.58:1).
 */
function nudgeLightness(start: Rgb, passes: (candidate: Rgb) => boolean): { rgb: Rgb; delta: number } | null {
  const [h, s, l] = rgbToHsl(start);
  let best: { rgb: Rgb; delta: number } | null = null;
  for (const direction of [-1, 1]) {
    for (let step = 1; step <= 100; step++) {
      const lightness = Math.min(1, Math.max(0, l + (direction * step) / 100));
      const candidate = hslToRgb(h, s, lightness).map((c) => Math.round(c)) as unknown as Rgb;
      if (passes(candidate)) {
        if (!best || step < best.delta) best = { rgb: candidate, delta: step };
        break;
      }
      if (lightness === 0 || lightness === 1) break;
    }
  }
  return best;
}

/**
 * The colour closest to `fg` (by lightness) that reaches `required` against
 * `bg`. Returns `fg` itself when it already passes. Lowercase #rrggbb.
 */
export function suggestPassingColor(fg: string, bg: string, required: number): string {
  const start = parseHex(fg) ?? BLACK;
  const against = parseHex(bg);
  if (!against) return toHex(start);
  if (rgbContrast(start, against) >= required) return toHex(start);
  const found = nudgeLightness(start, (c) => rgbContrast(c, against) >= required);
  if (found) return toHex(found.rgb);
  return rgbContrast(BLACK, against) >= rgbContrast(WHITE, against) ? "#000000" : "#ffffff";
}

/* ── Surfaces and fills (shared by the CSS and the contrast checks) ──────── */

/*
 * The Glass preset's card is translucent so the background shows through it,
 * blurred. That means the colour behind its text depends on the photo. Rather
 * than guess, the checks assume the worst: the photo could be anything from
 * black to white, so text has to pass against the whole range of colours the
 * surface can turn into. Every other preset has an opaque surface, and its
 * checks see exactly the colour on screen.
 */
const FROSTED_SURFACE_ALPHA = 0.8;
const SOFT_FILL_ALPHA = 0.14;
const GLASS_FILL_ALPHA = 0.12;

/*
 * Raised panels (the Layered layout's blocks) are the card colour moved 6% of
 * the way to the text colour: a shade lighter on a dark card, a shade darker on
 * a light one. Opaque, even on a frosted card, so the checks know exactly what
 * sits behind panel text.
 */
const RAISED_MIX = 0.06;

/** Layouts that put their blocks on raised panels. */
const PANEL_LAYOUTS: ReadonlySet<CardLayout> = new Set<CardLayout>(["layered"]);

export function isFrostedTheme(theme: Pick<ResolvedTheme, "preset">): boolean {
  return theme.preset === "glass";
}

/** True when the theme's layout draws text on raised panels as well as the card. */
export function themeUsesPanels(theme: Pick<ResolvedTheme, "layout">): boolean {
  return PANEL_LAYOUTS.has(theme.layout);
}

function raisedColor(surface: Rgb, text: Rgb): Rgb {
  return mix(surface, text, RAISED_MIX);
}

/**
 * Button styles whose label is drawn in the accent colour. Filled buttons put
 * the button-text colour on the accent, and hairline buttons use the text
 * colour, so neither needs the accent to pass as text.
 */
function accentLabels(style: CardButtonStyle): boolean {
  return style === "outline" || style === "soft" || style === "glass";
}

/** What a button's fill composites to over a given (opaque) surface colour. */
function buttonFill(style: CardButtonStyle, accent: Rgb, surface: Rgb): Rgb {
  if (style === "filled") return accent;
  if (style === "soft") return mix(surface, accent, SOFT_FILL_ALPHA);
  if (style === "glass") return mix(surface, accent, GLASS_FILL_ALPHA);
  return surface;
}

/**
 * Every colour text can sit on: the card surface (for a frosted card, the
 * surface over a black and over a white backdrop, its two extremes) and, in a
 * panel layout, the raised panel too. `over` lets a check put a button fill on
 * top of each first.
 */
function backdrops(
  { frosted, panels }: { frosted: boolean; panels: boolean },
  colors: { surface: Rgb; text: Rgb },
  over: (s: Rgb) => Rgb = (s) => s,
): Rgb[] {
  const { surface, text } = colors;
  const list = frosted
    ? [mix(surface, BLACK, 1 - FROSTED_SURFACE_ALPHA), mix(surface, WHITE, 1 - FROSTED_SURFACE_ALPHA)]
    : [surface];
  if (panels) list.push(raisedColor(surface, text));
  return list.map(over);
}

/**
 * The worst contrast `fg` can have against any colour in the span the
 * backdrops cover. Luminance moves continuously across a frosted card, so if
 * `fg`'s own luminance falls inside that span some backdrop makes it vanish
 * entirely (ratio 1).
 */
function worstContrast(fg: Rgb, colors: Rgb[]): number {
  const lf = luminance(fg);
  const ls = colors.map(luminance);
  const low = Math.min(...ls);
  const high = Math.max(...ls);
  if (lf > low && lf < high) return 1;
  return Math.min(ratioOfLuminances(lf, low), ratioOfLuminances(lf, high));
}

/* ── Theme → CSS ─────────────────────────────────────────────────────────── */

const BUTTON_RADII: Record<CardButtonShape, string> = {
  pill: "9999px",
  rounded: "0.75rem",
  square: "0px",
};

/** The card's own corners follow the buttons, so the two always agree. */
const CARD_RADII: Record<CardButtonShape, string> = {
  pill: "1.75rem",
  rounded: "1.25rem",
  square: "0px",
};

const AVATAR_RADII: Record<CardAvatarShape, string> = {
  circle: "9999px",
  rounded: "24%",
  square: "0px",
  hidden: "0px",
};

/*
 * Button height never drops below 44px, the touch-target minimum: these are
 * pressed one-handed by someone standing at a career fair.
 *
 * Spacious grows the gaps between blocks everywhere, but its side padding
 * follows the screen (cqi is the card root's width, as BusinessCard's root is
 * the query container): about the same as Comfortable on a phone, where width
 * is scarce, and wider margins on a desktop.
 */
const DENSITY: Record<CardDensity, { pad: string; gap: string; buttonH: string; avatar: string }> = {
  compact: { pad: "1.25rem", gap: "1rem", buttonH: "2.75rem", avatar: "5.5rem" },
  comfortable: { pad: "1.75rem", gap: "1.5rem", buttonH: "3.25rem", avatar: "7rem" },
  spacious: { pad: "clamp(1.5rem, 8cqi, 2.5rem)", gap: "2.25rem", buttonH: "3.25rem", avatar: "7.5rem" },
};

/**
 * Only an http(s) URL with nothing that could break out of `url("...")`.
 * Callers pass cardMediaUrl() output, which already satisfies this; the check
 * is here so this function is safe on its own.
 */
function safeImageUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\/[^\s"'()\\<>]+$/i.test(url) ? url : null;
}

/**
 * Patterns are drawn in whichever of the card's surface or text colour stands
 * out more from the page background, at low opacity: white lines on a
 * blueprint blue, ink lines on cream paper. No image files involved.
 */
function patternStyle(pattern: CardPattern, base: Rgb, inkCandidates: Rgb[]): CSSProperties {
  const ink = inkCandidates.reduce((best, c) => (rgbContrast(c, base) > rgbContrast(best, base) ? c : best));
  const line = (alpha: number) => rgba(ink, alpha);
  switch (pattern) {
    case "dots":
      return {
        backgroundImage: `radial-gradient(${line(0.28)} 1.5px, transparent 1.75px)`,
        backgroundSize: "18px 18px",
      };
    case "grid":
      // A blueprint: fine lines every 20px, heavier ones every 100px.
      return {
        backgroundImage: [
          `linear-gradient(${line(0.28)} 1px, transparent 1px)`,
          `linear-gradient(90deg, ${line(0.28)} 1px, transparent 1px)`,
          `linear-gradient(${line(0.12)} 1px, transparent 1px)`,
          `linear-gradient(90deg, ${line(0.12)} 1px, transparent 1px)`,
        ].join(", "),
        backgroundSize: "100px 100px, 100px 100px, 20px 20px, 20px 20px",
        backgroundPosition: "-1px -1px, -1px -1px, -1px -1px, -1px -1px",
      };
    case "diagonal":
      return {
        backgroundImage: `repeating-linear-gradient(135deg, ${line(0.14)} 0 2px, transparent 2px 16px)`,
      };
    case "topo":
      // Two sets of offset rings interfere into something like contour lines.
      return {
        backgroundImage: [
          `repeating-radial-gradient(circle at 18% 22%, transparent 0 26px, ${line(0.18)} 26px 27.5px)`,
          `repeating-radial-gradient(circle at 82% 78%, transparent 0 34px, ${line(0.12)} 34px 35.5px)`,
        ].join(", "),
      };
  }
}

function backgroundStyle(theme: ResolvedTheme, imageUrl: string | null): CSSProperties {
  const { type, from, to, angle, dim, pattern } = theme.background;
  const base = parseHex(theme.colors.background) ?? BLACK;
  const gradient = `linear-gradient(${angle}deg, ${from}, ${to})`;

  if (type === "image") {
    const url = safeImageUrl(imageUrl);
    if (url) {
      const shade = `rgba(0, 0, 0, ${(dim / 100).toFixed(2)})`;
      return {
        backgroundColor: theme.colors.background,
        backgroundImage: `linear-gradient(${shade}, ${shade}), url("${url}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      };
    }
    // No photo yet (or it failed to resolve): the gradient keeps the card
    // looking intentional instead of falling back to a flat block.
    return { backgroundColor: from, backgroundImage: gradient };
  }
  if (type === "gradient") return { backgroundColor: from, backgroundImage: gradient };
  if (type === "pattern") {
    const inks = [parseHex(theme.colors.surface) ?? WHITE, parseHex(theme.colors.text) ?? BLACK];
    return { backgroundColor: theme.colors.background, ...patternStyle(pattern, base, inks) };
  }
  return { backgroundColor: theme.colors.background };
}

/**
 * The theme as CSS: custom properties for the card to read, plus the page
 * background itself. Put it on the element that should carry the background
 * (BusinessCard's root does this). `backgroundImageUrl` must come from
 * cardMediaUrl(); it is only used when the background type is "image".
 *
 *   --card-bg, --card-surface, --card-text, --card-muted, --card-accent,
 *   --card-accent-text    the six theme colours
 *   --card-primary, --card-primary-text   Add to Contacts and the featured link:
 *                         accent and button text, or text and card ("ink")
 *   --card-surface-fill   the card's fill (translucent for Glass)
 *   --card-raised         a raised panel: the card a shade toward the text
 *   --card-backdrop       backdrop-filter for the card ("none" unless frosted)
 *   --card-soft, --card-glass, --card-glass-border   button fills
 *   --card-rule           hairlines and chip borders
 *   --card-rule-strong    hairline button edges and emphasised rules
 *   --card-border         panel and card edges
 *   --card-band           banner fallback / badge band
 *   --card-focus          focus outline colour
 *   --card-font-heading, --card-font-body, --card-heading-weight
 *   --card-radius, --card-button-radius, --card-avatar-radius
 *   --card-pad, --card-gap, --card-button-h, --card-avatar-size
 */
export function themeCssVars(theme: ResolvedTheme, backgroundImageUrl?: string | null): CSSProperties {
  const c = theme.colors;
  const surface = parseHex(c.surface) ?? WHITE;
  const accent = parseHex(c.accent) ?? BLACK;
  const text = parseHex(c.text) ?? BLACK;
  const frosted = isFrostedTheme(theme);
  const ink = theme.buttons.primary === "ink";
  const density = DENSITY[theme.density] ?? DENSITY.comfortable;
  const band =
    theme.background.type === "gradient"
      ? `linear-gradient(135deg, ${theme.background.from}, ${theme.background.to})`
      : `linear-gradient(135deg, ${c.accent}, ${c.background})`;

  const vars: Record<string, string> = {
    "--card-bg": c.background,
    "--card-surface": c.surface,
    "--card-text": c.text,
    "--card-muted": c.muted,
    "--card-accent": c.accent,
    "--card-accent-text": c.accentText,
    // Ink reverses the text pairing, which the text check already covers.
    "--card-primary": ink ? c.text : c.accent,
    "--card-primary-text": ink ? c.surface : c.accentText,
    "--card-surface-fill": frosted ? rgba(surface, FROSTED_SURFACE_ALPHA) : c.surface,
    "--card-raised": toHex(raisedColor(surface, text)),
    "--card-backdrop": frosted ? "blur(18px) saturate(140%)" : "none",
    "--card-soft": rgba(accent, SOFT_FILL_ALPHA),
    "--card-glass": rgba(accent, GLASS_FILL_ALPHA),
    "--card-glass-border": rgba(accent, 0.4),
    "--card-rule": rgba(text, 0.16),
    "--card-rule-strong": rgba(text, 0.32),
    "--card-border": rgba(text, 0.12),
    "--card-band": band,
    "--card-focus": c.text,
    "--card-font-heading": CARD_FONTS[theme.font.heading]?.stack ?? CARD_FONTS["libre-franklin"].stack,
    "--card-font-body": CARD_FONTS[theme.font.body]?.stack ?? CARD_FONTS["libre-franklin"].stack,
    "--card-heading-weight": String(CARD_FONTS[theme.font.heading]?.headingWeight ?? 700),
    "--card-radius": CARD_RADII[theme.buttons.shape] ?? CARD_RADII.rounded,
    "--card-button-radius": BUTTON_RADII[theme.buttons.shape] ?? BUTTON_RADII.rounded,
    "--card-avatar-radius": AVATAR_RADII[theme.avatar.shape] ?? AVATAR_RADII.circle,
    "--card-pad": density.pad,
    "--card-gap": density.gap,
    "--card-button-h": density.buttonH,
    "--card-avatar-size": density.avatar,
  };

  return { ...vars, ...backgroundStyle(theme, backgroundImageUrl ?? null) } as CSSProperties;
}

/* ── Contrast checks ─────────────────────────────────────────────────────── */

export interface ContrastIssue {
  /** Stable id for the rule, e.g. "text-on-surface". */
  id: string;
  /** Plain-language explanation for the member. */
  message: string;
  /** The colour to change. `suggestion` is a replacement for this one. */
  fg: CardColorKey;
  /** The colour it has to stand out from. */
  bg: CardColorKey;
  /** The current ratio, rounded down to two decimals so 4.496 never shows as 4.5. */
  ratio: number;
  /** What it needs: 4.5 for text, 3 for icons and edges. */
  required: number;
  /** The nearest passing shade of `fg`, lowercase #rrggbb. */
  suggestion: string;
}

type ColorSet = Record<CardColorKey, Rgb>;

interface Check {
  id: string;
  /** The colour normally changed to fix it. */
  fg: CardColorKey;
  bg: CardColorKey;
  /** Other colours a fix may change instead, if that's the smaller change. */
  alsoFixableBy?: CardColorKey[];
  required: number;
  message: string;
  /** Every colour `measure` reads, so a fix can be re-checked against them all. */
  reads: CardColorKey[];
  measure: (colors: ColorSet) => number;
}

/*
 * The rules, matching what BusinessCard actually draws:
 *
 *   text and muted text sit on the card surface                    4.5:1
 *   button text on the accent fill must always pass: it labels
 *     Add to Contacts under an accent main button, filled links,
 *     and the initials when there's no photo                      4.5:1
 *   with outline / soft / glass buttons, the label is the accent
 *     colour on (a tint of) the surface                           4.5:1
 *   the accent as icons, the verified check, and filled button
 *     edges against the surface                                   3:1
 *
 * "The surface" means every colour text sits on: the card (both extremes of
 * a frosted one) and, in a panel layout, the raised panels too, which are
 * mixed from the card and text colours. An ink main button puts the card
 * colour on the text colour, the same pair as the first rule, so it needs no
 * rule of its own. Hairline buttons label in the text colour, likewise.
 */
function buildChecks(theme: ResolvedTheme): Check[] {
  const on = { frosted: isFrostedTheme(theme), panels: themeUsesPanels(theme) };
  const style = theme.buttons.style;
  // Panels are mixed from the card and the text, so with panels every check
  // against "the surface" also depends on the text colour.
  const surfaceKeys: CardColorKey[] = on.panels ? ["surface", "text"] : ["surface"];
  const checks: Check[] = [
    {
      id: "text-on-surface",
      fg: "text",
      bg: "surface",
      required: 4.5,
      message: "Your main text color is too close to the card color to read easily.",
      reads: ["text", "surface"],
      measure: (c) => worstContrast(c.text, backdrops(on, c)),
    },
    {
      id: "muted-on-surface",
      fg: "muted",
      bg: "surface",
      required: 4.5,
      message:
        "Your secondary text color (school, pronouns and section titles) is too close to the card color to read easily.",
      reads: ["muted", ...surfaceKeys],
      measure: (c) => worstContrast(c.muted, backdrops(on, c)),
    },
    {
      id: "button-text-on-accent",
      fg: "accentText",
      bg: "accent",
      alsoFixableBy: ["accent"],
      required: 4.5,
      message: "The text on your accent-colored buttons is too close to the button color to read easily.",
      reads: ["accentText", "accent"],
      measure: (c) => rgbContrast(c.accentText, c.accent),
    },
  ];
  if (accentLabels(style)) {
    checks.push({
      id: "button-text-on-surface",
      fg: "accent",
      bg: "surface",
      required: 4.5,
      message:
        "Your link buttons use the accent color for their text, and it's too close to the card color to read easily.",
      reads: ["accent", ...surfaceKeys],
      measure: (c) => worstContrast(c.accent, backdrops(on, c, (s) => buttonFill(style, c.accent, s))),
    });
  }
  checks.push({
    id: "accent-on-surface",
    fg: "accent",
    bg: "surface",
    required: 3,
    message: "Your accent color is too close to the card color for icons and button edges to stand out.",
    reads: ["accent", ...surfaceKeys],
    measure: (c) => worstContrast(c.accent, backdrops(on, c)),
  });
  return checks;
}

function colorSet(theme: ResolvedTheme): ColorSet {
  const fallback = CARD_PRESETS["shpe-classic"].theme.colors;
  const set = {} as ColorSet;
  for (const key of CARD_COLOR_KEYS) {
    set[key] = parseHex(theme.colors[key]) ?? (parseHex(fallback[key]) as Rgb);
  }
  return set;
}

/**
 * Finds a replacement for `key` that fixes `check`, preferring one that also
 * keeps every other rule involving `key` passing, so applying a suggestion
 * never just trades one warning for another.
 */
function suggestFor(
  check: Check,
  key: CardColorKey,
  colors: ColorSet,
  checks: Check[],
): { rgb: Rgb; delta: number } | null {
  const related = checks.filter((ch) => ch.reads.includes(key));
  const passesAll = (candidate: Rgb) => {
    const next = { ...colors, [key]: candidate };
    return related.every((ch) => ch.measure(next) >= ch.required);
  };
  const passesThis = (candidate: Rgb) => check.measure({ ...colors, [key]: candidate }) >= check.required;
  return nudgeLightness(colors[key], passesAll) ?? nudgeLightness(colors[key], passesThis);
}

/**
 * Every way the theme falls short of WCAG AA, with a suggested fix for each.
 * An empty array means the card is readable and may be saved; the editor
 * refuses to save otherwise. Every preset returns [].
 */
export function themeContrastIssues(theme: ResolvedTheme): ContrastIssue[] {
  const colors = colorSet(theme);
  const checks = buildChecks(theme);
  const failing = checks.filter((ch) => ch.measure(colors) < ch.required);
  const failingIds = new Set(failing.map((ch) => ch.id));

  return failing
    .filter(
      // The button-label fix for the accent already satisfies the 3:1 rule, so
      // two warnings about one colour would only be noise.
      (ch) => !(ch.id === "accent-on-surface" && failingIds.has("button-text-on-surface")),
    )
    .map((check) => {
      // Usually the foreground changes. For button text on the accent fill it
      // can be smaller to darken the fill than to recolour the text (a bright
      // orange with white text), so whichever needs the smaller nudge wins.
      let fg = check.fg;
      let best = suggestFor(check, check.fg, colors, checks);
      for (const alt of check.alsoFixableBy ?? []) {
        const candidate = suggestFor(check, alt, colors, checks);
        if (candidate && (!best || candidate.delta < best.delta)) {
          best = candidate;
          fg = alt;
        }
      }
      const bg = fg === check.fg ? check.bg : check.fg;
      const fallback = rgbContrast(BLACK, colors[bg]) >= rgbContrast(WHITE, colors[bg]) ? BLACK : WHITE;
      return {
        id: check.id,
        message: check.message,
        fg,
        bg,
        ratio: Math.floor(check.measure(colors) * 100) / 100,
        required: check.required,
        suggestion: toHex(best?.rgb ?? fallback),
      };
    });
}

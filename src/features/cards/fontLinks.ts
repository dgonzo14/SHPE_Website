/*
 * The ".ts" on this import is deliberate, as in photoVisibility.ts: the
 * card-meta edge function imports this file, and Netlify bundles edge
 * functions with Deno, which needs the extension and knows nothing of the
 * app's "@/" alias. So this file may import only model.ts, which imports
 * nothing at all. cardMetaEdge.test.ts walks the edge function's imports and
 * fails CI if either rule breaks.
 */
import {
  CARD_FONT_IDS,
  CARD_PRESET_IDS,
  type CardFontId,
  type CardPresetId,
} from "./model.ts";

/**
 * Which web fonts a card needs, and where they come from, in a form the edge
 * function can use as well as the app.
 *
 * The app loads a card's fonts itself (useCardFonts in fonts.ts), but only
 * once its JavaScript has run, so a visitor first sees the name in the
 * fallback face and then watches it reflow, most noticeably with the large
 * serif names. The card-meta edge function already reads the card while the
 * page is being fetched, so it writes the card's font stylesheets into <head>
 * too, tagged with data-card-font so the app sees them and doesn't add its
 * own. Both sides build the same URL from this file.
 */

/**
 * The `family=` value for the Google Fonts css2 API, spaces and all (they are
 * encoded when the URL is built). null when the page already has the font:
 * Libre Franklin is the site's own face, which index.html loads everywhere.
 */
export const GOOGLE_FONT_FAMILIES: Record<CardFontId, string | null> = {
  "libre-franklin": null,
  inter: "Inter:wght@400;500;600;700",
  "dm-sans": "DM Sans:wght@400;500;700",
  "space-grotesk": "Space Grotesk:wght@400;500;700",
  nunito: "Nunito:wght@400;600;700",
  "playfair-display": "Playfair Display:wght@400;600;700",
  // Ships in one weight.
  "dm-serif-display": "DM Serif Display",
  "jetbrains-mono": "JetBrains Mono:wght@400;500;700",
  // The optical-size axis tightens the letterforms at name sizes.
  "source-serif-4": "Source Serif 4:opsz,wght@8..60,400..700",
  "source-sans-3": "Source Sans 3:wght@400;600;700",
  // A display face in one weight, like DM Serif Display.
  "instrument-serif": "Instrument Serif",
  "instrument-sans": "Instrument Sans:wght@400;500;600;700",
  "plus-jakarta-sans": "Plus Jakarta Sans:wght@400;500;600;700",
  manrope: "Manrope:wght@400;500;600;700",
  "eb-garamond": "EB Garamond:wght@400;500;600",
  "cormorant-garamond": "Cormorant Garamond:wght@400;500;600",
};

function isFontId(value: unknown): value is CardFontId {
  return typeof value === "string" && (CARD_FONT_IDS as readonly string[]).includes(value);
}

/** The stylesheet URL for one family, or null when nothing needs fetching. */
export function googleFontHref(id: CardFontId): string | null {
  const family = isFontId(id) ? GOOGLE_FONT_FAMILIES[id] : null;
  if (!family) return null;
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}&display=swap`;
}

/**
 * Each preset's name and text fonts: the part of CARD_PRESETS in themes.ts
 * that decides what a card loads. Copied rather than imported, because
 * themes.ts pulls in React through the font catalog, which the edge function
 * can't load. fontLinks.test.ts fails if the two ever disagree.
 */
export const PRESET_FONT_DEFAULTS: Record<CardPresetId, { heading: CardFontId; body: CardFontId }> = {
  "shpe-classic": { heading: "libre-franklin", body: "libre-franklin" },
  sunrise: { heading: "dm-sans", body: "dm-sans" },
  midnight: { heading: "space-grotesk", body: "inter" },
  paper: { heading: "playfair-display", body: "inter" },
  washu: { heading: "libre-franklin", body: "libre-franklin" },
  engineer: { heading: "jetbrains-mono", body: "jetbrains-mono" },
  glass: { heading: "dm-sans", body: "dm-sans" },
  executive: { heading: "source-serif-4", body: "source-sans-3" },
  editorial: { heading: "instrument-serif", body: "instrument-sans" },
  studio: { heading: "plus-jakarta-sans", body: "inter" },
  slate: { heading: "manrope", body: "inter" },
  heritage: { heading: "eb-garamond", body: "libre-franklin" },
  signature: { heading: "cormorant-garamond", body: "inter" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The fonts a stored theme draws with, name font first, each once. Resolved
 * the way resolveTheme() does it: an unknown preset is SHPE Classic, and a
 * font that isn't in the catalog takes the preset's.
 */
export function storedThemeFonts(theme: unknown): CardFontId[] {
  const raw = isRecord(theme) ? theme : {};
  const preset =
    typeof raw.preset === "string" && (CARD_PRESET_IDS as readonly string[]).includes(raw.preset)
      ? (raw.preset as CardPresetId)
      : "shpe-classic";
  const defaults = PRESET_FONT_DEFAULTS[preset];
  const font = isRecord(raw.font) ? raw.font : {};
  const heading = isFontId(font.heading) ? font.heading : defaults.heading;
  const body = isFontId(font.body) ? font.body : defaults.body;
  return heading === body ? [heading] : [heading, body];
}

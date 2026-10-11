import { useEffect } from "react";
import { CARD_FONT_IDS, type CardFontId } from "./model";
import { GOOGLE_FONT_FAMILIES, googleFontHref } from "./fontLinks";

export { googleFontHref };

/**
 * The card's type catalog: sixteen families, each with a full fallback stack
 * so the card is readable before (or without) the web font arriving. The last
 * eight came with the professional presets, which each pair a name face with a
 * text face (Source Serif 4 with Source Sans 3, Instrument Serif with
 * Instrument Sans, and so on).
 *
 * Fonts load from Google only when a card actually uses them, and only on the
 * pages that render a card. fonts.googleapis.com and fonts.gstatic.com are
 * already in the CSP, and index.html already preconnects to both. Libre
 * Franklin is the site's own face and index.html loads it for every page, so it
 * has no family to fetch. The Google family strings live in fontLinks.ts,
 * which the link-preview edge function shares, so the stylesheets it writes
 * into a card page are exactly the ones this file would add.
 */

export interface CardFontInfo {
  label: string;
  /** A complete font-family value, web font first. */
  stack: string;
  /** The Google Fonts css2 `family=` value (see GOOGLE_FONT_FAMILIES), or null. */
  googleFamily: string | null;
  /**
   * Weight for the name. Display serifs that only ship a regular weight would
   * otherwise be smeared into a synthetic bold.
   */
  headingWeight: number;
}

const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF_FALLBACK = 'Georgia, Cambria, "Times New Roman", serif';
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

export const CARD_FONTS: Record<CardFontId, CardFontInfo> = {
  "libre-franklin": {
    label: "Libre Franklin",
    stack: `"Libre Franklin", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["libre-franklin"],
    headingWeight: 700,
  },
  inter: {
    label: "Inter",
    stack: `"Inter", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["inter"],
    headingWeight: 700,
  },
  "dm-sans": {
    label: "DM Sans",
    stack: `"DM Sans", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["dm-sans"],
    headingWeight: 700,
  },
  "space-grotesk": {
    label: "Space Grotesk",
    stack: `"Space Grotesk", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["space-grotesk"],
    headingWeight: 700,
  },
  nunito: {
    label: "Nunito",
    stack: `"Nunito", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["nunito"],
    headingWeight: 700,
  },
  "playfair-display": {
    label: "Playfair Display",
    stack: `"Playfair Display", ${SERIF_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["playfair-display"],
    headingWeight: 700,
  },
  "dm-serif-display": {
    label: "DM Serif Display",
    stack: `"DM Serif Display", ${SERIF_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["dm-serif-display"],
    headingWeight: 400,
  },
  "jetbrains-mono": {
    label: "JetBrains Mono",
    stack: `"JetBrains Mono", ${MONO_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["jetbrains-mono"],
    headingWeight: 700,
  },
  "source-serif-4": {
    label: "Source Serif 4",
    stack: `"Source Serif 4", ${SERIF_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["source-serif-4"],
    headingWeight: 600,
  },
  "source-sans-3": {
    label: "Source Sans 3",
    stack: `"Source Sans 3", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["source-sans-3"],
    headingWeight: 700,
  },
  "instrument-serif": {
    label: "Instrument Serif",
    stack: `"Instrument Serif", ${SERIF_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["instrument-serif"],
    headingWeight: 400,
  },
  "instrument-sans": {
    label: "Instrument Sans",
    stack: `"Instrument Sans", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["instrument-sans"],
    headingWeight: 600,
  },
  "plus-jakarta-sans": {
    label: "Plus Jakarta Sans",
    stack: `"Plus Jakarta Sans", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["plus-jakarta-sans"],
    headingWeight: 700,
  },
  manrope: {
    label: "Manrope",
    stack: `"Manrope", ${SANS_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["manrope"],
    headingWeight: 600,
  },
  "eb-garamond": {
    label: "EB Garamond",
    stack: `"EB Garamond", ${SERIF_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["eb-garamond"],
    headingWeight: 500,
  },
  "cormorant-garamond": {
    label: "Cormorant Garamond",
    stack: `"Cormorant Garamond", ${SERIF_FALLBACK}`,
    googleFamily: GOOGLE_FONT_FAMILIES["cormorant-garamond"],
    headingWeight: 600,
  },
};

export function isCardFontId(value: unknown): value is CardFontId {
  return typeof value === "string" && (CARD_FONT_IDS as readonly string[]).includes(value);
}

/**
 * Adds a family's stylesheet to <head> unless it is already there. Links are
 * never removed: switching fonts back and forth in the editor would otherwise
 * refetch and flash, and the browser caches them across cards anyway.
 */
export function ensureCardFont(id: CardFontId): void {
  if (typeof document === "undefined") return;
  const href = googleFontHref(id);
  if (!href) return;
  if (document.head.querySelector(`link[data-card-font="${id}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.cardFont = id;
  document.head.appendChild(link);
}

/**
 * Loads the given families for the life of the page, one <link> per family,
 * once. Unknown ids are ignored, so a junk theme can't inject anything.
 */
export function useCardFonts(ids: CardFontId[]): void {
  // A stable string key, so a fresh array with the same fonts doesn't re-run.
  const key = [...new Set(ids.filter(isCardFontId))].sort().join(",");
  useEffect(() => {
    if (!key) return;
    for (const id of key.split(",")) ensureCardFont(id as CardFontId);
  }, [key]);
}

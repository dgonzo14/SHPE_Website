import { createContext, useContext } from "react";

import type { CardLayout } from "./model";

/**
 * Layout tokens: what each layout changes about the card beyond the header
 * composition (which lives in HeaderBlock). One table, read by BusinessCard
 * and by the blocks through CardLayoutContext, so the public card and the
 * editor's preview are composed by exactly the same rules.
 *
 * Colour never comes from here. Every class below reads the theme's --card-*
 * custom properties, so a layout works with any preset's palette, and every
 * pairing it uses is one themeContrastIssues() checks: text and muted on the
 * card or a raised panel, accent marks at 3:1, and fills with their own text.
 *
 * Class strings are written out in full (never assembled) so Tailwind sees
 * them.
 */

/** How a block introduces itself. */
export type SectionStyle =
  /** Small caps in the muted colour (the original layouts). */
  | "caps"
  /** Small caps after a short accent rule (Profile). */
  | "accent"
  /** Small caps with a fine rule running out to the edge (Editorial). */
  | "ruled"
  /** A quiet sentence-case label (Studio). */
  | "label"
  /** The whole block on a raised, bordered panel (Layered). */
  | "panel"
  /** Centred small caps between two rules (Letterhead). */
  | "flanked"
  /** Centred, widely tracked small caps under a fine rule (Monogram). */
  | "fine";

export interface LayoutSpec {
  /** Blocks below the header are centred, as in Classic. */
  centered: boolean;
  /** Width, edge and shadow of the card itself, added to the shared classes. */
  card: string;
  /**
   * Added to the content wrapper: two columns once the screen is wide, or a
   * padding adjustment, or "".
   */
  columns: string;
  /** The header-and-actions column. */
  lead: string;
  /** The column of blocks. */
  sections: string;
  sectionStyle: SectionStyle;
  /**
   * Whether the links get a visible "Links" title. The original layouts let
   * the buttons speak for themselves and keep the title for screen readers.
   */
  linksTitle: boolean;
  /** Link rows numbered like a contents page, labels in the name font. */
  indexedRows: boolean;
  /** A fine rule above the first row and below the last. */
  framedRows: boolean;
  /** The "Currently" line: a bordered box, plain text, or a pull quote. */
  status: "box" | "plain" | "quote";
  /** A bold 3px photo ring, or a fine one. */
  ring: "bold" | "fine";
  /** No photo: initials on a filled tile, or set as a monogram in the name font. */
  initials: "tile" | "monogram";
  /** Initials in the name font rather than the text font. */
  initialsInHeadingFont: boolean;
}

/** The original layouts' deep drop shadow. */
const ORIGINAL_SHADOW = "shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)]";
/** The professional layouts sit lighter on the page. */
const SOFT_SHADOW = "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_20px_48px_-24px_rgba(0,0,0,0.32)]";

const ORIGINAL: Omit<LayoutSpec, "centered" | "card" | "columns"> = {
  lead: "",
  sections: "",
  sectionStyle: "caps",
  linksTitle: false,
  indexedRows: false,
  framedRows: false,
  status: "box",
  ring: "bold",
  initials: "tile",
  initialsInHeadingFont: false,
};

export const LAYOUT_SPECS: Record<CardLayout, LayoutSpec> = {
  classic: { ...ORIGINAL, centered: true, card: ORIGINAL_SHADOW, columns: "" },
  banner: { ...ORIGINAL, centered: true, card: ORIGINAL_SHADOW, columns: "" },
  split: {
    ...ORIGINAL,
    centered: false,
    card: `${ORIGINAL_SHADOW} @3xl:max-w-[52rem]`,
    columns: "@3xl:grid @3xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] @3xl:items-start @3xl:gap-x-10",
  },
  minimal: { ...ORIGINAL, centered: false, card: ORIGINAL_SHADOW, columns: "" },
  badge: { ...ORIGINAL, centered: true, card: ORIGINAL_SHADOW, columns: "" },

  profile: {
    ...ORIGINAL,
    centered: false,
    card: SOFT_SHADOW,
    columns: "",
    sectionStyle: "accent",
    linksTitle: true,
    initialsInHeadingFont: true,
  },
  editorial: {
    ...ORIGINAL,
    centered: false,
    // A two-page spread on a wide screen: the masthead and name on the left,
    // the blocks on the right across a fine rule.
    card: `${SOFT_SHADOW} @3xl:max-w-[56rem]`,
    columns: "@3xl:grid @3xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] @3xl:items-start @3xl:gap-x-0",
    lead: "@3xl:pr-12",
    sections: "@3xl:border-l @3xl:border-(--card-rule) @3xl:pl-12",
    sectionStyle: "ruled",
    linksTitle: true,
    indexedRows: true,
    status: "quote",
    initialsInHeadingFont: true,
  },
  studio: {
    ...ORIGINAL,
    centered: false,
    card: `border border-(--card-border) ${SOFT_SHADOW} @3xl:max-w-[56rem]`,
    // 18rem keeps "Add to Contacts" and the share button on one line beside each other.
    columns: "@3xl:grid @3xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] @3xl:items-start @3xl:gap-x-10",
    sectionStyle: "label",
    linksTitle: true,
    initialsInHeadingFont: true,
  },
  layered: {
    ...ORIGINAL,
    centered: false,
    card: "border border-(--card-border) shadow-[0_32px_80px_-32px_rgba(0,0,0,0.85)]",
    // The panels pad themselves, so on a phone the card gives up some of its
    // own side padding rather than nest three margins around every row.
    columns: "px-4 @sm:px-(--card-pad)",
    sectionStyle: "panel",
    linksTitle: true,
    status: "plain",
    initialsInHeadingFont: true,
  },
  letterhead: {
    ...ORIGINAL,
    centered: true,
    card: SOFT_SHADOW,
    columns: "",
    sectionStyle: "flanked",
    ring: "fine",
    initialsInHeadingFont: true,
  },
  monogram: {
    ...ORIGINAL,
    centered: true,
    card: SOFT_SHADOW,
    columns: "",
    sectionStyle: "fine",
    framedRows: true,
    status: "plain",
    ring: "fine",
    initials: "monogram",
    initialsInHeadingFont: true,
  },
};

export function layoutSpec(layout: CardLayout): LayoutSpec {
  return LAYOUT_SPECS[layout] ?? LAYOUT_SPECS.classic;
}

/** The layout of the card being drawn, for blocks that style themselves by it. */
export const CardLayoutContext = createContext<LayoutSpec>(LAYOUT_SPECS.classic);

export function useLayoutSpec(): LayoutSpec {
  return useContext(CardLayoutContext);
}

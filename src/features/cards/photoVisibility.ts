/*
 * The ".ts" on this import is deliberate. The card-meta edge function imports
 * this file, and Netlify bundles edge functions with Deno, which needs the
 * extension and knows nothing of the app's "@/" alias. So this file may import
 * only model.ts, which imports nothing at all. A test walks the edge function's
 * imports and fails CI if either rule breaks, rather than the deploy.
 */
import {
  CARD_AVATAR_SHAPES,
  CARD_LAYOUTS,
  CARD_PRESET_IDS,
  type CardAvatarShape,
  type CardLayout,
  type CardPresetId,
} from "./model.ts";

/**
 * Whether a card's design shows the member's photo, in one place.
 *
 * A member can hide their face in two ways: the "No photo" shape, or a layout
 * that has no photo at all (Minimal, which the Paper preset uses). The card
 * honours both, and so must everything else that could show the photo: the
 * contact file from Add to Contacts, and the link preview the edge function
 * writes for iMessage, Slack or LinkedIn. A face they chose not to show on the
 * card shouldn't turn up in someone's contacts or a group chat.
 *
 * The photo stays saved while it's hidden (switching back to a layout with a
 * photo brings it back). get_public_card() leaves the address out for a hidden
 * photo (private.card_theme_shows_photo), but the callers still ask, so the rule
 * holds even for a response from before that change or a hand-built preview.
 */

/** Layouts that draw no photo, whatever the photo shape says. */
const PHOTOLESS_LAYOUTS: ReadonlySet<CardLayout> = new Set<CardLayout>(["minimal"]);

/**
 * Each preset's default layout and photo shape: the two parts of CARD_PRESETS
 * in themes.ts that decide whether a photo shows. Copied rather than imported,
 * because themes.ts pulls in the font catalog, which the edge function can't
 * load. photoVisibility.test.ts fails if the two ever disagree.
 */
export const PRESET_PHOTO_DEFAULTS: Record<CardPresetId, { layout: CardLayout; avatarShape: CardAvatarShape }> = {
  "shpe-classic": { layout: "classic", avatarShape: "circle" },
  sunrise: { layout: "banner", avatarShape: "circle" },
  midnight: { layout: "classic", avatarShape: "circle" },
  paper: { layout: "minimal", avatarShape: "square" },
  washu: { layout: "badge", avatarShape: "circle" },
  engineer: { layout: "split", avatarShape: "square" },
  glass: { layout: "classic", avatarShape: "circle" },
  executive: { layout: "profile", avatarShape: "rounded" },
  editorial: { layout: "editorial", avatarShape: "square" },
  studio: { layout: "studio", avatarShape: "rounded" },
  slate: { layout: "layered", avatarShape: "circle" },
  heritage: { layout: "letterhead", avatarShape: "circle" },
  signature: { layout: "monogram", avatarShape: "circle" },
};

/** The two fields of a resolved theme (themes.ts ResolvedTheme) that matter here. */
export interface PhotoDesign {
  layout: CardLayout;
  avatar: { shape: CardAvatarShape };
}

/** For a resolved theme: what BusinessCard draws. */
export function themeShowsPhoto(theme: PhotoDesign): boolean {
  return !PHOTOLESS_LAYOUTS.has(theme.layout) && theme.avatar.shape !== "hidden";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * For a theme as stored, which is usually sparse: Paper is saved as just
 * `{ preset: "paper" }`, so its Minimal layout has to come from the preset.
 * Fills the layout and shape the same way resolveTheme() does (an unknown
 * preset is SHPE Classic, an invalid field takes the preset's value), so the
 * answer always matches what the card shows.
 */
export function storedThemeShowsPhoto(theme: unknown): boolean {
  const raw = isRecord(theme) ? theme : {};
  const defaults = PRESET_PHOTO_DEFAULTS[oneOf(CARD_PRESET_IDS, raw.preset, "shpe-classic")];
  const avatar = isRecord(raw.avatar) ? raw.avatar : {};
  return themeShowsPhoto({
    layout: oneOf(CARD_LAYOUTS, raw.layout, defaults.layout),
    avatar: { shape: oneOf(CARD_AVATAR_SHAPES, avatar.shape, defaults.avatarShape) },
  });
}

/**
 * The card's photo path when the card shows it, otherwise null: a starter card
 * (which never shows a photo), no photo, or a design that hides it. Takes the
 * card loosely typed because the edge function reads it straight from JSON.
 */
export function visiblePhotoPath(card: { is_starter?: unknown; avatar_path?: unknown; theme?: unknown }): string | null {
  if (card.is_starter) return null;
  if (typeof card.avatar_path !== "string" || card.avatar_path.trim() === "") return null;
  return storedThemeShowsPhoto(card.theme) ? card.avatar_path : null;
}

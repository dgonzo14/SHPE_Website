/**
 * The business card's vocabulary: every enum, limit and pattern that the
 * database, the Zod schemas, the renderer and the editor have to agree on.
 *
 * The database is the authority. `private.card_theme_is_valid()`,
 * `private.card_sections_are_valid()` and the CHECK constraints in
 * 20260914000001_member_business_cards.sql enforce the same lists as this file;
 * a value accepted here but not there fails on save with a 22023, never
 * silently. Change one, change the other in the same commit.
 */

/* ── Handles ─────────────────────────────────────────────────────────────── */

/**
 * 3–30 characters of a–z, 0–9 and single hyphens, starting and ending with a
 * letter or digit. Identical to the member_cards_handle_shape CHECK.
 */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

/** A member can hold at most this many handles over the card's lifetime. */
export const MAX_HANDLES_PER_MEMBER = 5;

/**
 * Client copy of public.reserved_card_handles, for an instant "reserved"
 * message while typing. The table is the control; adding a word here alone
 * reserves nothing.
 */
export const RESERVED_HANDLES: readonly string[] = [
  // Routes and infrastructure
  "about", "admin", "administrator", "api", "app", "apps", "assets", "auth", "c", "card",
  "cards", "contact", "dashboard", "edit", "events", "help", "home", "images", "join", "login",
  "logout", "me", "member", "members", "my", "new", "nfc", "null", "portal", "privacy", "qr",
  "register", "root", "security", "settings", "signup", "static", "support", "system", "terms",
  "test", "undefined", "www",
  // Brand
  "chapter", "national", "official", "shpe", "shpe-washu", "sponsor", "sponsors", "sponsorship",
  "washu", "washu-shpe", "washushpe", "wustl", "leadership", "team", "staff",
  // Roles: kept free for officer cards that pass from one holder to the next
  "eboard", "exec", "executive", "officer", "officers", "president", "vice-president", "vp",
  "treasurer", "secretary", "external", "internal", "external-representative",
  "internal-representative", "moderator", "mod",
];

export function isHandleShapeValid(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

/** Lowercases and trims what a member typed, without otherwise rewriting it. */
export function normalizeHandleInput(raw: string): string {
  return raw.trim().toLowerCase();
}

/* ── Content limits (mirror the member_cards_lengths CHECK) ──────────────── */

export const CARD_LIMITS = {
  displayName: 80,
  pronouns: 30,
  headline: 100,
  organization: 100,
  statusLine: 120,
  bio: 600,
  location: 80,
  skills: 15,
  skillLength: 30,
  languages: 8,
  languageLength: 30,
  links: 20,
  linkLabel: 40,
  linkValue: 500,
  hiddenReason: 300,
  positionTitle: 60,
  /** Bucket file_size_limit. Uploads are resized well below this first. */
  imageBytes: 2 * 1024 * 1024,
} as const;

export const DEFAULT_ORGANIZATION = "Washington University in St. Louis";

/* ── Links ───────────────────────────────────────────────────────────────── */

export const CARD_LINK_KINDS = [
  "linkedin",
  "github",
  "email",
  "phone",
  "website",
  "portfolio",
  "resume",
  "instagram",
  "x",
  "tiktok",
  "youtube",
  "handshake",
  "devpost",
  "calendly",
  "discord",
  "custom",
] as const;
export type CardLinkKind = (typeof CARD_LINK_KINDS)[number];

/**
 * Same rules as private.card_link_value_ok() behind the member_card_links_value
 * CHECK. Besides @ and whitespace, the email rule refuses the characters that
 * would make `mailto:<value>` more than an address -- a scheme (`:`), a path,
 * a query (`?cc=`), a fragment, markup or a list separator -- so a value like
 * `javascript:x@y.co` or `a@b.co?bcc=c@d.co` can't be stored at all.
 */
export const LINK_EMAIL_PATTERN = /^[^@\s:/?#&<>",;\\]+@[^@\s:/?#&<>",;\\]+\.[^@\s:/?#&<>",;\\]+$/;
export const LINK_PHONE_PATTERN = /^\+?[0-9 ().-]{7,20}$/;
export const LINK_URL_PATTERN = /^https:\/\/[^\s<>"']+$/i;

export function isLinkValueValid(kind: CardLinkKind, value: string): boolean {
  if (value.length === 0 || value.length > CARD_LIMITS.linkValue) return false;
  if (kind === "email") return LINK_EMAIL_PATTERN.test(value);
  if (kind === "phone") {
    return LINK_PHONE_PATTERN.test(value) && (value.match(/[0-9]/g)?.length ?? 0) >= 7;
  }
  return LINK_URL_PATTERN.test(value);
}

/* ── Theme ───────────────────────────────────────────────────────────────── */

export const CARD_PRESET_IDS = [
  "shpe-classic",
  "sunrise",
  "midnight",
  "paper",
  "washu",
  "engineer",
  "glass",
] as const;
export type CardPresetId = (typeof CARD_PRESET_IDS)[number];

export const CARD_LAYOUTS = ["classic", "banner", "split", "minimal", "badge"] as const;
export type CardLayout = (typeof CARD_LAYOUTS)[number];

export const CARD_FONT_IDS = [
  "libre-franklin",
  "inter",
  "dm-sans",
  "space-grotesk",
  "nunito",
  "playfair-display",
  "dm-serif-display",
  "jetbrains-mono",
] as const;
export type CardFontId = (typeof CARD_FONT_IDS)[number];

export const CARD_COLOR_KEYS = [
  "background",
  "surface",
  "text",
  "muted",
  "accent",
  "accentText",
] as const;
export type CardColorKey = (typeof CARD_COLOR_KEYS)[number];

export const CARD_BACKGROUND_TYPES = ["solid", "gradient", "image", "pattern"] as const;
export type CardBackgroundType = (typeof CARD_BACKGROUND_TYPES)[number];

export const CARD_PATTERNS = ["dots", "grid", "topo", "diagonal"] as const;
export type CardPattern = (typeof CARD_PATTERNS)[number];

export const CARD_BUTTON_SHAPES = ["pill", "rounded", "square"] as const;
export type CardButtonShape = (typeof CARD_BUTTON_SHAPES)[number];

export const CARD_BUTTON_STYLES = ["filled", "outline", "soft", "glass"] as const;
export type CardButtonStyle = (typeof CARD_BUTTON_STYLES)[number];

export const CARD_BUTTON_ARRANGEMENTS = ["list", "icon-grid"] as const;
export type CardButtonArrangement = (typeof CARD_BUTTON_ARRANGEMENTS)[number];

export const CARD_AVATAR_SHAPES = ["circle", "rounded", "square", "hidden"] as const;
export type CardAvatarShape = (typeof CARD_AVATAR_SHAPES)[number];

export const CARD_DENSITIES = ["compact", "comfortable"] as const;
export type CardDensity = (typeof CARD_DENSITIES)[number];

/** `#rrggbb`, case-insensitive. Stored lowercase by convention, not by rule. */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const GRADIENT_ANGLE_MAX = 360;
export const BACKGROUND_DIM_MAX = 80;

/**
 * A stored theme: a preset to start from plus any overrides. Everything but
 * `preset` is optional, and the renderer fills gaps from the preset (see
 * resolveTheme in themes.ts). Choosing a new preset in the editor replaces the
 * theme with `{ preset }`, which is what makes "reset to preset" free.
 *
 * Unknown keys are rejected by the database, so this interface is the whole
 * shape, not a minimum.
 */
export interface CardTheme {
  preset: CardPresetId;
  layout?: CardLayout;
  colors?: Partial<Record<CardColorKey, string>>;
  background?: {
    type: CardBackgroundType;
    /** Gradient start. */
    from?: string;
    /** Gradient end. */
    to?: string;
    /** Gradient angle in degrees, 0–360. */
    angle?: number;
    /** Darkening over a background photo, 0–80 (percent). */
    dim?: number;
    pattern?: CardPattern;
  };
  font?: { heading?: CardFontId; body?: CardFontId };
  buttons?: {
    shape?: CardButtonShape;
    style?: CardButtonStyle;
    arrangement?: CardButtonArrangement;
    icons?: boolean;
  };
  avatar?: { shape?: CardAvatarShape; ring?: boolean };
  density?: CardDensity;
}

export const DEFAULT_CARD_THEME: CardTheme = { preset: "shpe-classic" };

/* ── Sections ────────────────────────────────────────────────────────────── */

/**
 * Content blocks below the header. `sections` on a card is the ordered list of
 * the ones shown; a block that isn't listed is hidden. The header (name, photo,
 * position) is always first, and Add to Contacts plus the SHPE footer are always
 * present, so none of those are sections.
 */
export const CARD_SECTION_IDS = [
  "status",
  "links",
  "about",
  "education",
  "shpe",
  "skills",
  "languages",
  "featured",
] as const;
export type CardSectionId = (typeof CARD_SECTION_IDS)[number];

export const DEFAULT_CARD_SECTIONS: readonly CardSectionId[] = [
  "status",
  "featured",
  "links",
  "about",
  "education",
  "shpe",
];

export const CARD_SECTION_LABELS: Record<CardSectionId, string> = {
  status: "Currently",
  links: "Links",
  about: "About",
  education: "Education",
  shpe: "SHPE",
  skills: "Skills",
  languages: "Languages",
  featured: "Featured link",
};

/* ── Insights ────────────────────────────────────────────────────────────── */

/** Where a visit came from: the chip, a printed or on-screen QR, or a shared link. */
export const CARD_SOURCES = ["nfc", "qr", "link"] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

export const CARD_EVENTS = ["view", "save", "share", "link_click"] as const;
export type CardEvent = (typeof CARD_EVENTS)[number];

/** Reads `?src=` from a card URL; anything unrecognised counts as a shared link. */
export function parseCardSource(value: string | null | undefined): CardSource {
  return value === "nfc" || value === "qr" ? value : "link";
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

export const CARD_MEDIA_BUCKET = "card-media";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * `<member uuid>/<file uuid>.<ext>`. Same rule as the database's media-path
 * check, which also requires the first segment to be the card owner's id.
 */
export const CARD_MEDIA_PATH_PATTERN = new RegExp(`^${UUID}/${UUID}\\.(webp|jpg|png)$`);

export const CARD_MEDIA_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;

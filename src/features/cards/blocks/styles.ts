import type { CardButtonStyle } from "../model";

/**
 * Class strings shared by the card's blocks. Every colour here is a
 * `--card-*` custom property set by themeCssVars(), so the same classes draw
 * every theme, and each foreground/background pairing used below is one that
 * themeContrastIssues() checks:
 *
 *   --card-text / --card-muted on the surface        text, muted
 *   --card-accent-text on --card-accent              primary buttons, initials, badge band
 *   --card-accent on the surface or its tints        outline / soft / glass labels, icons
 *
 * Anything that would pair colours outside that list (say, accent text on a
 * filled-style card, where only 3:1 is checked) uses the neutral treatment
 * instead.
 *
 * Global link styles in colors.css colour every <a> navy and underline it on
 * hover; `no-link-style` and explicit text colours opt the card out.
 */

/** A visible, offset focus ring in the card's own text colour (≥4.5:1 on the surface). */
export const FOCUS_RING =
  "focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-(--card-focus)";

/**
 * Motion is a 1px lift on hover, only where the device can hover and the
 * member hasn't asked for reduced motion. Colours never change on hover, so a
 * hover state can't fall below the contrast the checks approved.
 */
const LIFT =
  "motion-safe:transition-[translate,box-shadow] motion-safe:duration-150 motion-safe:hover:-translate-y-px hover:shadow-md active:translate-y-0";

/** Fill, border and label colour for each button style. */
export const BUTTON_FILLS: Record<CardButtonStyle | "primary" | "neutral", string> = {
  primary: "border-2 border-transparent bg-(--card-accent) text-(--card-accent-text) shadow-sm",
  filled: "border-2 border-transparent bg-(--card-accent) text-(--card-accent-text) shadow-sm",
  outline: "border-2 border-(--card-accent) bg-transparent text-(--card-accent)",
  soft: "border-2 border-transparent bg-(--card-soft) text-(--card-accent)",
  glass:
    "border border-(--card-glass-border) bg-(--card-glass) text-(--card-accent) " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] [backdrop-filter:blur(10px)]",
  /** Text colour on the surface, for secondary actions that must pass under any style. */
  neutral: "border-2 border-(--card-rule) bg-transparent text-(--card-text)",
};

/**
 * A full button: at least 44px tall (--card-button-h never goes lower), the
 * theme's corner radius, and the chosen fill.
 */
export function buttonClass(fill: keyof typeof BUTTON_FILLS): string {
  return [
    "no-link-style inline-flex min-h-(--card-button-h) w-full min-w-0 items-center gap-3",
    "rounded-(--card-button-radius) px-5 py-2 text-base leading-snug font-semibold no-underline",
    "cursor-pointer select-none",
    BUTTON_FILLS[fill],
    LIFT,
    FOCUS_RING,
  ].join(" ");
}

/** A square icon tile for the icon-grid arrangement. */
export function tileClass(fill: keyof typeof BUTTON_FILLS): string {
  return [
    "flex aspect-square w-full items-center justify-center rounded-(--card-button-radius)",
    BUTTON_FILLS[fill],
    LIFT,
  ].join(" ");
}

/** Section titles: small caps in the muted colour. */
export const SECTION_TITLE = "text-xs font-semibold uppercase tracking-[0.14em] text-(--card-muted)";

/** Wrap anything a member typed, however long the unbroken word. */
export const WRAP_ANYWHERE = "min-w-0 [overflow-wrap:anywhere]";

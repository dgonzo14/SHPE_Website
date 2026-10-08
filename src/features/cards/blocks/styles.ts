import type { CardButtonStyle } from "../model";
import type { SectionStyle } from "../layouts";

/**
 * Class strings shared by the card's blocks. Every colour here is a
 * `--card-*` custom property set by themeCssVars(), so the same classes draw
 * every theme, and each foreground/background pairing used below is one that
 * themeContrastIssues() checks:
 *
 *   --card-text / --card-muted on the surface        text, muted
 *   --card-accent-text on --card-accent              filled buttons, initials, badge band
 *   --card-primary-text on --card-primary            Add to Contacts, the featured link
 *                                                    (accent pair, or text and card reversed)
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
export const LIFT =
  "motion-safe:transition-[translate,box-shadow] motion-safe:duration-150 motion-safe:hover:-translate-y-px hover:shadow-md active:translate-y-0";

/** Fill, border and label colour for each button style. */
export const BUTTON_FILLS: Record<CardButtonStyle | "primary" | "neutral", string> = {
  primary: "border-2 border-transparent bg-(--card-primary) text-(--card-primary-text) shadow-sm",
  filled: "border-2 border-transparent bg-(--card-accent) text-(--card-accent-text) shadow-sm",
  outline: "border-2 border-(--card-accent) bg-transparent text-(--card-accent)",
  soft: "border-2 border-transparent bg-(--card-soft) text-(--card-accent)",
  glass:
    "border border-(--card-glass-border) bg-(--card-glass) text-(--card-accent) " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] [backdrop-filter:blur(10px)]",
  /** A fine edge and the text colour; icons take the accent (see iconTone). */
  hairline: "border border-(--card-rule-strong) bg-transparent text-(--card-text)",
  /** Text colour on the surface, for secondary actions that must pass under any style. */
  neutral: "border-2 border-(--card-rule) bg-transparent text-(--card-text)",
};

/**
 * A full button: at least 44px tall (--card-button-h never goes lower), the
 * theme's corner radius, and the chosen fill. "compact" is the two-column
 * size: exactly the 44px minimum, with a smaller label.
 */
export function buttonClass(fill: keyof typeof BUTTON_FILLS, size: "full" | "compact" = "full"): string {
  return [
    size === "full"
      ? "no-link-style inline-flex min-h-(--card-button-h) w-full min-w-0 items-center gap-3 px-5 py-2 text-base"
      : "no-link-style inline-flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-2 text-[0.9375rem]",
    "rounded-(--card-button-radius) leading-snug font-semibold no-underline",
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

/**
 * A link icon beside a label. Hairline buttons label in the text colour, so
 * the icon carries the accent instead (3:1, which the checks hold); every
 * other style's icon simply follows its label.
 */
export function iconTone(style: CardButtonStyle): string {
  return style === "hairline" ? "text-(--card-accent)" : "";
}

/**
 * The small mark beside a link row or card: the icon on a chip drawn in the
 * button style, so "Soft" looks the same on a row as on a button. Hairline
 * has no chip at all, just the accent icon.
 */
export const ICON_CHIPS: Record<CardButtonStyle, string> = {
  filled: "flex size-9 shrink-0 items-center justify-center rounded-(--card-button-radius) bg-(--card-accent) text-(--card-accent-text)",
  outline: "flex size-9 shrink-0 items-center justify-center rounded-(--card-button-radius) border border-(--card-accent) text-(--card-accent)",
  soft: "flex size-9 shrink-0 items-center justify-center rounded-(--card-button-radius) bg-(--card-soft) text-(--card-accent)",
  glass:
    "flex size-9 shrink-0 items-center justify-center rounded-(--card-button-radius) border border-(--card-glass-border) bg-(--card-glass) text-(--card-accent)",
  hairline: "flex size-6 shrink-0 items-center justify-center text-(--card-accent)",
};

/** Section titles: small caps in the muted colour. */
export const SECTION_TITLE = "text-xs font-semibold uppercase tracking-[0.14em] text-(--card-muted)";

/**
 * Each section style as the block's own classes and its title's. Rules are
 * drawn with ::before / ::after so a title stays a single text node for
 * assistive technology.
 */
export const SECTION_STYLES: Record<SectionStyle, { section: string; title: string }> = {
  caps: { section: "flex flex-col gap-2", title: SECTION_TITLE },
  accent: {
    section: "flex flex-col gap-3",
    title:
      "flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-(--card-muted) " +
      "before:h-0.5 before:w-4 before:shrink-0 before:bg-(--card-accent)",
  },
  ruled: {
    section: "flex flex-col gap-3",
    title:
      "flex items-center gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-(--card-muted) " +
      "after:h-px after:flex-1 after:bg-(--card-rule)",
  },
  label: { section: "flex flex-col gap-2.5", title: "text-[0.8125rem] font-semibold text-(--card-muted)" },
  panel: {
    section:
      "flex flex-col gap-3 rounded-[min(var(--card-radius),1rem)] border border-(--card-border) bg-(--card-raised) p-4 @sm:p-5",
    title: SECTION_TITLE,
  },
  flanked: {
    section: "flex flex-col gap-3",
    title:
      "flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-(--card-text) " +
      "before:h-px before:flex-1 before:bg-(--card-rule-strong) after:h-px after:flex-1 after:bg-(--card-rule-strong)",
  },
  fine: {
    section: "flex flex-col gap-3",
    title: "text-[0.6875rem] font-medium uppercase tracking-[0.24em] text-(--card-muted)",
  },
};

/** Wrap anything a member typed, however long the unbroken word. */
export const WRAP_ANYWHERE = "min-w-0 [overflow-wrap:anywhere]";

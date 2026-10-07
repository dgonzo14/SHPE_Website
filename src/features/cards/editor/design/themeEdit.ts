import type { CSSProperties } from "react";

import {
  CARD_SECTION_IDS,
  HEX_COLOR_PATTERN,
  type CardColorKey,
  type CardSectionId,
  type CardTheme,
} from "../../model";
import {
  CARD_PRESETS,
  resolveTheme,
  suggestPassingColor,
  themeContrastIssues,
  themeCssVars,
  type ContrastIssue,
  type ResolvedTheme,
} from "../../themes";

/**
 * The Design tab's edits, as pure functions over the stored theme.
 *
 * A stored theme is `{ preset, ...overrides }`. Every edit here goes the same
 * way: resolve the stored theme against its preset, apply the change to the
 * resolved values, then store only what still differs from the preset. That
 * has three useful consequences:
 *
 *   - the JSON never carries an `undefined`, an empty object, or a key the
 *     strict theme schema would refuse, because it is rebuilt from validated
 *     values every time;
 *   - "reset this colour" is just setting it back to the preset's value, and
 *     the override disappears by itself;
 *   - "has the member customised anything?" is a key count, so switching
 *     presets only asks for confirmation when there is something to lose.
 *
 * Junk in a stored theme (a hand-edited row, a value from before a rule
 * tightened) is dropped by resolveTheme on the first edit, which also makes
 * the theme valid again.
 */

/** What each theme colour is called in the editor. */
export const COLOR_LABELS: Record<CardColorKey, string> = {
  background: "Page background",
  surface: "Card",
  text: "Text",
  muted: "Secondary text",
  accent: "Accent",
  accentText: "Button text",
};

export interface ThemePatch {
  layout?: ResolvedTheme["layout"];
  colors?: Partial<ResolvedTheme["colors"]>;
  background?: Partial<ResolvedTheme["background"]>;
  font?: Partial<ResolvedTheme["font"]>;
  buttons?: Partial<ResolvedTheme["buttons"]>;
  avatar?: Partial<ResolvedTheme["avatar"]>;
  density?: ResolvedTheme["density"];
}

/** The fields of `next` that differ from `base`, or null when none do. */
function changed<T extends object>(next: T, base: T): Partial<T> | null {
  const out: Partial<T> = {};
  let any = false;
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== base[key]) {
      out[key] = next[key];
      any = true;
    }
  }
  return any ? out : null;
}

/** Drops keys whose value is undefined, so a spread can't erase a real value. */
function defined<T extends object>(patch: Partial<T> | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (!patch) return out;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

/** The preset a stored theme starts from, fully resolved. */
export function presetDefaults(theme: CardTheme | null | undefined): ResolvedTheme {
  return CARD_PRESETS[resolveTheme(theme).preset].theme;
}

/**
 * The smallest stored theme that resolves to `resolved`: the preset plus every
 * field that differs from it. Key order is fixed so the JSON is stable.
 */
export function compactTheme(resolved: ResolvedTheme): CardTheme {
  const base = CARD_PRESETS[resolved.preset].theme;
  const theme: CardTheme = { preset: resolved.preset };

  if (resolved.layout !== base.layout) theme.layout = resolved.layout;

  const colors = changed(resolved.colors, base.colors);
  if (colors) theme.colors = colors;

  // `type` is required whenever a background object is stored at all.
  const background = changed(resolved.background, base.background);
  if (background) theme.background = { type: resolved.background.type, ...background };

  const font = changed(resolved.font, base.font);
  if (font) theme.font = font;

  const buttons = changed(resolved.buttons, base.buttons);
  if (buttons) theme.buttons = buttons;

  const avatar = changed(resolved.avatar, base.avatar);
  if (avatar) theme.avatar = avatar;

  if (resolved.density !== base.density) theme.density = resolved.density;

  return theme;
}

/** Normalises colour input to lowercase `#rrggbb`; anything else is dropped. */
function cleanColors(colors: ThemePatch["colors"]): ThemePatch["colors"] {
  const out: Partial<Record<CardColorKey, string>> = {};
  for (const [key, value] of Object.entries(defined(colors))) {
    if (typeof value === "string" && HEX_COLOR_PATTERN.test(value)) {
      out[key as CardColorKey] = value.toLowerCase();
    }
  }
  return out;
}

/**
 * The stored theme with `patch` applied. The merged result goes back through
 * resolveTheme, so an out-of-range number or a malformed colour in the patch
 * quietly keeps the current value instead of reaching the form.
 */
export function applyThemePatch(theme: CardTheme | null | undefined, patch: ThemePatch): CardTheme {
  const current = resolveTheme(theme);
  const background = { ...current.background, ...defined(patch.background) };
  for (const key of ["from", "to"] as const) {
    background[key] = background[key].toLowerCase();
  }
  const merged: ResolvedTheme = {
    preset: current.preset,
    layout: patch.layout ?? current.layout,
    colors: { ...current.colors, ...cleanColors(patch.colors) },
    background,
    font: { ...current.font, ...defined(patch.font) },
    buttons: { ...current.buttons, ...defined(patch.buttons) },
    avatar: { ...current.avatar, ...defined(patch.avatar) },
    density: patch.density ?? current.density,
  };
  return compactTheme(resolveTheme(merged));
}

/** Puts one colour back to the preset's value. */
export function resetThemeColor(theme: CardTheme | null | undefined, key: CardColorKey): CardTheme {
  return applyThemePatch(theme, { colors: { [key]: presetDefaults(theme).colors[key] } });
}

export function isColorOverridden(theme: CardTheme | null | undefined, key: CardColorKey): boolean {
  return resolveTheme(theme).colors[key] !== presetDefaults(theme).colors[key];
}

/** True when the theme changes anything about its preset. */
export function hasThemeOverrides(theme: CardTheme | null | undefined): boolean {
  return Object.keys(compactTheme(resolveTheme(theme))).length > 1;
}

/* ── Contrast fixes ──────────────────────────────────────────────────────── */

export interface ContrastFix {
  key: CardColorKey;
  color: string;
}

/**
 * The colour change to offer for a contrast issue, or null when no simple
 * change helps.
 *
 * Whenever the issue's own suggestion (its `fg` colour set to `suggestion`)
 * fixes the problem without creating a new one, that is what is offered: it is
 * the nearest passing shade of the colour the warning is about. But a
 * suggestion can fix its rule by breaking another: on a dark card, lightening
 * the accent so icons show (3:1) can make white button text unreadable
 * (4.5:1), and darkening it again for the text undoes the first fix, so
 * "Use …" would bounce between two warnings forever. And on a mid-tone or
 * frosted card no shade of the text may reach 4.5:1 at all, so the suggestion
 * is black and still fails.
 *
 * Only then are other candidates tried, nearest first: the nearest passing
 * shade of the OTHER colour in the pair; then black and white for either. Each
 * is scored by actually re-running the checks. The winner fixes this issue if
 * anything does, adds the fewest new problems, leaves the fewest problems
 * overall, and is the nearest change among equals. A candidate that neither
 * fixes this issue nor reduces the count is never offered, so a "Use" button
 * always makes progress.
 */
export function contrastFix(theme: CardTheme | null | undefined, issue: ContrastIssue): ContrastFix | null {
  const resolved = resolveTheme(theme);
  const colors = resolved.colors;
  const before = themeContrastIssues(resolved);
  const beforeIds = new Set(before.map((i) => i.id));

  const candidates: ContrastFix[] = [
    { key: issue.fg, color: issue.suggestion },
    { key: issue.bg, color: suggestPassingColor(colors[issue.bg], colors[issue.fg], issue.required) },
    { key: issue.fg, color: "#000000" },
    { key: issue.fg, color: "#ffffff" },
    { key: issue.bg, color: "#000000" },
    { key: issue.bg, color: "#ffffff" },
  ];

  let best: ContrastFix | null = null;
  let bestScore: number[] = [];
  for (const [index, fix] of candidates.entries()) {
    const color = fix.color.toLowerCase();
    if (color === colors[fix.key]) continue;
    const after = themeContrastIssues(resolveTheme(applyThemePatch(theme, { colors: { [fix.key]: color } })));
    const stillThere = after.some((i) => i.id === issue.id);
    if (stillThere && after.length >= before.length) continue;
    const added = after.filter((i) => !beforeIds.has(i.id)).length;
    // The issue's own suggestion, when it is a clean fix, beats any other.
    if (index === 0 && !stillThere && added === 0) return { key: fix.key, color };
    const score = [stillThere ? 1 : 0, added, after.length, index];
    if (!best || lexicographicallyLess(score, bestScore)) {
      best = { key: fix.key, color };
      bestScore = score;
    }
  }
  return best;
}

function lexicographicallyLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/* ── Hex input ───────────────────────────────────────────────────────────── */

/**
 * What a member typed into a hex field, as `#rrggbb`, or null if it isn't a
 * colour. Forgives a missing `#`, capitals, surrounding spaces and the
 * three-digit shorthand (`#fa0` → `#ffaa00`).
 */
export function parseHexInput(raw: string): string | null {
  const text = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(text)) {
    return `#${text
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return /^[0-9a-f]{6}$/.test(text) ? `#${text}` : null;
}

/* ── Block order ─────────────────────────────────────────────────────────── */

/** Known section ids, each once, in the stored order. */
export function shownSections(sections: readonly unknown[] | null | undefined): CardSectionId[] {
  const seen: CardSectionId[] = [];
  for (const id of sections ?? []) {
    if ((CARD_SECTION_IDS as readonly unknown[]).includes(id) && !seen.includes(id as CardSectionId)) {
      seen.push(id as CardSectionId);
    }
  }
  return seen;
}

/** The blocks that aren't shown, in the catalog's order. */
export function hiddenSections(sections: readonly unknown[] | null | undefined): CardSectionId[] {
  const shown = shownSections(sections);
  return CARD_SECTION_IDS.filter((id) => !shown.includes(id));
}

/** Moves a shown block up (-1) or down (+1). Out of range is a no-op. */
export function moveSection(
  sections: readonly unknown[] | null | undefined,
  id: CardSectionId,
  delta: -1 | 1,
): CardSectionId[] {
  const list = shownSections(sections);
  const from = list.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list;
}

export function hideSection(
  sections: readonly unknown[] | null | undefined,
  id: CardSectionId,
): CardSectionId[] {
  return shownSections(sections).filter((s) => s !== id);
}

/** Shows a hidden block at the end of the card, where the member can move it from. */
export function showSection(
  sections: readonly unknown[] | null | undefined,
  id: CardSectionId,
): CardSectionId[] {
  const list = shownSections(sections);
  return list.includes(id) ? list : [...list, id];
}

/* ── Previews ────────────────────────────────────────────────────────────── */

/**
 * Just the `--card-*` custom properties of a theme, without its page
 * background, for small previews that borrow the card's colours.
 */
export function cardColorVars(theme: ResolvedTheme): CSSProperties {
  const vars: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(themeCssVars(theme))) {
    if (key.startsWith("--")) vars[key] = value;
  }
  return vars as CSSProperties;
}

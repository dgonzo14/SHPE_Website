import type { FieldErrors, Path } from "react-hook-form";

import type { CardFormValues } from "@/lib/validation";
import type { CardProfileFields } from "@/types/database";
import { cardUrl } from "@/services/cards";

/**
 * Pure helpers for the card editor: which tab a field lives on, which stored
 * images a save made unreachable, and how addresses are written for people.
 * Kept out of the components so the rules can be tested without rendering.
 */

/* ── Tabs ────────────────────────────────────────────────────────────────── */

export type EditorTabId = "content" | "links" | "design" | "share" | "insights";

export const EDITOR_TABS: readonly { id: EditorTabId; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "links", label: "Links" },
  { id: "design", label: "Design" },
  { id: "share", label: "Share" },
  { id: "insights", label: "Insights" },
];

/** ids tying each tab to its panel (aria-controls / aria-labelledby). */
export function editorTabId(prefix: string, id: EditorTabId): string {
  return `${prefix}-tab-${id}`;
}

export function editorPanelId(prefix: string, id: EditorTabId): string {
  return `${prefix}-panel-${id}`;
}

/** The tabs whose panels hold form fields; Share and Insights only read. */
export const FORM_TABS: ReadonlySet<EditorTabId> = new Set(["content", "links", "design"]);

/**
 * Where each form field is edited, so a save that fails validation can open
 * the tab holding the problem instead of leaving the member hunting for it.
 * A Record over every key, so adding a field to the schema without deciding
 * its tab is a type error. Listed in screen order within each tab.
 */
const FIELD_TABS: Record<keyof CardFormValues, EditorTabId> = {
  handle: "content",
  display_name: "content",
  pronouns: "content",
  headline: "content",
  organization: "content",
  location: "content",
  status_line: "content",
  bio: "content",
  avatar_path: "content",
  banner_path: "content",
  skills: "content",
  languages: "content",
  show_major: "content",
  show_graduation_year: "content",
  show_member_since: "content",
  show_national_member: "content",
  show_chapter_position: "content",
  allow_indexing: "content",
  links: "links",
  background_path: "design",
  theme: "design",
  sections: "design",
};

/** Field names in the order they appear on screen, tab by tab. */
const FIELD_ORDER = (Object.keys(FIELD_TABS) as (keyof CardFormValues)[]).sort(
  (a, b) => tabIndex(FIELD_TABS[a]) - tabIndex(FIELD_TABS[b]),
);

function tabIndex(id: EditorTabId): number {
  return EDITOR_TABS.findIndex((tab) => tab.id === id);
}

/** Every tab holding at least one invalid field. */
export function tabsWithErrors(errors: FieldErrors<CardFormValues>): Set<EditorTabId> {
  const tabs = new Set<EditorTabId>();
  for (const key of Object.keys(errors) as (keyof CardFormValues)[]) {
    const tab = FIELD_TABS[key];
    if (tab && errors[key]) tabs.add(tab);
  }
  return tabs;
}

/** The first invalid field in screen order, and the tab it's on. */
export function firstError(
  errors: FieldErrors<CardFormValues>,
): { field: keyof CardFormValues; tab: EditorTabId } | null {
  const field = FIELD_ORDER.find((key) => errors[key]);
  return field ? { field, tab: FIELD_TABS[field] } : null;
}

/**
 * The input to focus for an invalid field: the field itself, or for links the
 * first broken row's value (or label). null when there's no single input to
 * focus, as for the theme, whose controls live on the Design tab.
 */
export function errorFocusName(
  errors: FieldErrors<CardFormValues>,
  field: keyof CardFormValues,
): Path<CardFormValues> | null {
  if (field === "theme" || field === "sections") return null;
  if (field !== "links") return field;
  const rows = errors.links;
  if (!Array.isArray(rows)) return null;
  const index = rows.findIndex(Boolean);
  if (index < 0) return null;
  const row = rows[index] as { value?: unknown; label?: unknown };
  return row.label && !row.value ? `links.${index}.label` : `links.${index}.value`;
}

/**
 * The message for an array field (links, skills, languages), whose error can
 * sit on the array itself, on `root` (field arrays), or on one of its items.
 */
export function arrayErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { message?: unknown; root?: { message?: unknown } };
  if (typeof e.message === "string" && e.message) return e.message;
  if (typeof e.root?.message === "string" && e.root.message) return e.root.message;
  if (Array.isArray(error)) {
    for (const item of error) {
      const message = arrayErrorMessage(item);
      if (message) return message;
    }
  }
  return undefined;
}

/* ── Re-seeding ──────────────────────────────────────────────────────────── */

/**
 * Structural equality for form values: plain objects, arrays and primitives.
 * Key order doesn't matter (jsonb hands theme keys back in its own order), and
 * a key holding undefined counts as absent, as it would once sent as JSON.
 */
export function sameFormValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameFormValue(item, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameFormValue(left[key], right[key])) return false;
  }
  return true;
}

/**
 * The form after the stored card changed under an edit in progress. A field
 * the member has changed (it differs from `baseline`, what the form was last
 * seeded with) keeps their value; every other field takes the stored one, so
 * saving never writes back a value that only this tab still remembers.
 *
 * Whole top-level fields, never parts of one: the links list or the theme is
 * either the member's or the stored copy, not a mix of the two.
 */
export function mergeServerValues(
  current: CardFormValues,
  baseline: CardFormValues | undefined,
  server: CardFormValues,
): CardFormValues {
  const merged: CardFormValues = { ...server };
  const keep = <K extends keyof CardFormValues>(key: K) => {
    merged[key] = current[key];
  };
  for (const key of Object.keys(server) as (keyof CardFormValues)[]) {
    if (!sameFormValue(current[key], baseline?.[key])) keep(key);
  }
  return merged;
}

/* ── Images ──────────────────────────────────────────────────────────────── */

type MediaSource = {
  avatar_path: string | null;
  banner_path: string | null;
  background_path: string | null;
};

/** The storage paths a card (or the form) points at, blanks dropped. */
export function mediaPathsOf(source: MediaSource | null | undefined): string[] {
  if (!source) return [];
  return [source.avatar_path, source.banner_path, source.background_path].filter(
    (path): path is string => Boolean(path),
  );
}

/**
 * Images nothing points at any more: everything in `candidates` (the paths the
 * card used before a save, plus anything uploaded since) that isn't in `keep`
 * (what the card uses now). Paths are random per upload and live only in this
 * member's folder, so a path that isn't kept is genuinely orphaned.
 */
export function imagesToRemove(
  candidates: Iterable<string | null | undefined>,
  keep: Iterable<string | null | undefined>,
): string[] {
  const kept = new Set<string>();
  for (const path of keep) if (path) kept.add(path);
  const out = new Set<string>();
  for (const path of candidates) if (path && !kept.has(path)) out.add(path);
  return [...out];
}

/* ── Words ───────────────────────────────────────────────────────────────── */

/** "Ana Rivera" from the profile, blank parts skipped. */
export function profileDisplayName(
  profile: Pick<CardProfileFields, "first_name" | "last_name">,
): string {
  return [profile.first_name, profile.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * A card address as people read it: "washushpe.org/card/ana-rivera". The
 * scheme adds nothing for a human and makes the line wrap sooner on a phone.
 */
export function displayCardUrl(handle: string): string {
  return cardUrl(handle).replace(/^https?:\/\//, "");
}

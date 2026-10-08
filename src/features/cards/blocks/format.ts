import type { DegreeLevel } from "@/types/database";

/**
 * Small formatting helpers for card text. Kept apart from the components so
 * they can be tested and reused without rendering anything.
 */

/** Up to two letters for the photo placeholder: first and last word. */
export function initials(name: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  // Spread, not [0], so a name starting with an astral character isn't split in half.
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/**
 * How far a large display name steps down in size: 0 up to 18 characters, 1
 * up to 28, 2 beyond. Counts characters, not UTF-16 units, so accents and
 * other scripts count the way they read.
 */
export function nameLengthStep(name: string): 0 | 1 | 2 {
  const length = [...(name ?? "").trim()].length;
  return length <= 18 ? 0 : length <= 28 ? 1 : 2;
}

/** 2027 → "’27", the way class years are written on a name tag. */
export function shortClassYear(year: number): string {
  return `’${String(year).slice(-2).padStart(2, "0")}`;
}

/*
 * Labels repeated from DEGREE_LEVELS in lib/validation.ts rather than imported:
 * that module pulls in Zod, and the public card page must stay light. "Other"
 * tells a stranger nothing, so it isn't shown.
 */
const DEGREE_LABELS: Partial<Record<DegreeLevel, string>> = {
  undergraduate: "Undergraduate",
  masters: "Master's",
  phd: "PhD",
};

export function degreeLabel(level: DegreeLevel | null | undefined): string | null {
  return (level && DEGREE_LABELS[level]) || null;
}

/**
 * "2025-08-25" → "August 2025". Parsed by hand and formatted in UTC so the
 * month can't slip back a day (and a month) in a timezone west of Greenwich.
 */
export function formatMonthYear(isoDate: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12) return null;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

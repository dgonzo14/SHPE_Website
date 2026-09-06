/**
 * Date/time handling for a chapter that lives in one timezone.
 *
 * Timestamps are stored in UTC (`timestamptz`) and displayed in America/Chicago.
 * Everything here goes through Intl with an explicit `timeZone`, so daylight
 * saving is handled by the platform's tz database rather than by a fixed offset
 * that would be an hour wrong for half the academic year.
 */

import { CHAPTER_TIMEZONE } from "./config";

export const TIMEZONE_LABEL = "CT";

type DateLike = string | number | Date | null | undefined;

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", { timeZone: CHAPTER_TIMEZONE, ...options });
}

/** "September 18, 2026" */
export function formatDate(value: DateLike): string {
  const d = toDate(value);
  if (!d) return "";
  return fmt({ month: "long", day: "numeric", year: "numeric" }).format(d);
}

/** "Thu, Sep 18" */
export function formatShortDate(value: DateLike): string {
  const d = toDate(value);
  if (!d) return "";
  return fmt({ weekday: "short", month: "short", day: "numeric" }).format(d);
}

/** "6:30 PM" */
export function formatTime(value: DateLike): string {
  const d = toDate(value);
  if (!d) return "";
  return fmt({ hour: "numeric", minute: "2-digit" }).format(d);
}

/** "Thursday, September 18 at 6:30 PM" */
export function formatDateTime(value: DateLike): string {
  const d = toDate(value);
  if (!d) return "";
  const date = fmt({ weekday: "long", month: "long", day: "numeric" }).format(d);
  return `${date} at ${formatTime(d)}`;
}

/** "6:30 – 8:00 PM", collapsing the date when both ends share one day. */
export function formatTimeRange(start: DateLike, end: DateLike): string {
  const s = toDate(start);
  const e = toDate(end);
  if (!s) return "";
  if (!e) return formatTime(s);
  const sameDay = fmt({ dateStyle: "short" }).format(s) === fmt({ dateStyle: "short" }).format(e);
  return sameDay
    ? `${formatTime(s)} – ${formatTime(e)}`
    : `${formatDateTime(s)} – ${formatDateTime(e)}`;
}

/** "in 3 days", "2 hours ago", "just now" — for recent-activity lists. */
export function formatRelative(value: DateLike, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";

  const diffMs = d.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return "just now";
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), "day");
  return formatDate(d);
}

/* ── datetime-local <-> UTC ───────────────────────────────────────────────
 *
 * A `datetime-local` input has no timezone: it is a wall-clock reading. The
 * officer filling in the admin event form is entering chapter-local time, so
 * these two helpers convert between that reading and a real instant.
 */

/** Milliseconds the zone is ahead of UTC at a given instant (negative for CT). */
function zoneOffsetMs(instantMs: number): number {
  const parts = fmt({
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // Intl can render midnight as hour 24 in some engines.
  const hour = get("hour") % 24;

  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return asIfUtc - instantMs;
}

/**
 * "2026-09-18T18:30" understood as chapter-local time → ISO instant.
 *
 * Iterates twice so a time that lands near a DST transition still resolves to
 * the correct instant: the first pass picks an offset, the second re-checks it
 * using that candidate instant.
 */
export function localInputToUtcIso(localValue: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localValue ?? "");
  if (!match) return null;

  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);

  let instant = naive;
  for (let i = 0; i < 2; i += 1) {
    instant = naive - zoneOffsetMs(instant);
  }
  return new Date(instant).toISOString();
}

/** ISO instant → "2026-09-18T18:30" in chapter-local time, for form inputs. */
export function utcIsoToLocalInput(value: DateLike): string {
  const d = toDate(value);
  if (!d) return "";

  const parts = fmt({
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const hour = String(Number(get("hour")) % 24).padStart(2, "0");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** Compact UTC stamp for .ics files: 20260918T233000Z */
export function toIcsStamp(value: DateLike): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

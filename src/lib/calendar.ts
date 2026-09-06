/**
 * Month-grid arithmetic for the chapter calendar.
 *
 * Pure, and deliberately separate from any component: a calendar that puts an
 * event on the wrong day is worse than no calendar, and this is the part worth
 * testing directly.
 *
 * Everything here works in UTC internally. That is not a timezone decision —
 * these are plain calendar dates with no time attached, and using UTC keeps the
 * grid identical no matter where the browser is. Events are bucketed against it
 * using `chapterDateKey`, which resolves an *instant* to its chapter-local date,
 * so an 8pm event never drifts onto tomorrow.
 */

export interface CalendarDay {
  /** "2026-09-18" — matches the key produced by chapterDateKey. */
  key: string;
  day: number;
  /** False for the leading/trailing days borrowed from adjacent months. */
  inMonth: boolean;
}

const MS_PER_DAY = 86_400_000;

function keyFromUtc(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Six weeks of seven days covering `monthIndex` (0-based), padded with the
 * surrounding months so every row is full.
 *
 * Always six rows, so the grid does not change height as the user pages
 * through months — a calendar that jumps around is unpleasant to click.
 */
export function buildMonthGrid(year: number, monthIndex: number): CalendarDay[][] {
  const firstOfMonth = Date.UTC(year, monthIndex, 1);
  const leading = new Date(firstOfMonth).getUTCDay(); // 0 = Sunday
  const gridStart = firstOfMonth - leading * MS_PER_DAY;

  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: CalendarDay[] = [];
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      const ms = gridStart + (week * 7 + dayOfWeek) * MS_PER_DAY;
      const date = new Date(ms);
      days.push({
        key: keyFromUtc(ms),
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === monthIndex && date.getUTCFullYear() === year,
      });
    }
    weeks.push(days);
  }
  return weeks;
}

/**
 * The instant window to fetch events for, when showing this month's grid.
 *
 * Derived from the grid itself rather than from the month, because the grid is
 * always six weeks and can extend up to ten days past the end of a short month.
 * A fixed "one week either side" padding leaves the last row unfetched, which
 * shows up as events silently missing from the trailing cells.
 *
 * The extra day at each end covers the offset between a chapter-local calendar
 * date and the UTC instant it starts at. Over-fetching a day is free; missing
 * an event is not.
 */
export function monthRange(year: number, monthIndex: number): { from: string; to: string } {
  const grid = buildMonthGrid(year, monthIndex).flat();
  const first = Date.parse(`${grid[0].key}T00:00:00.000Z`);
  const last = Date.parse(`${grid[grid.length - 1].key}T00:00:00.000Z`);

  return {
    from: new Date(first - MS_PER_DAY).toISOString(),
    to: new Date(last + 2 * MS_PER_DAY).toISOString(),
  };
}

export function addMonths(year: number, monthIndex: number, delta: number) {
  const d = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
}

export function monthLabel(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

export const WEEKDAY_LABELS = [
  { short: "Sun", long: "Sunday" },
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
] as const;

/** Groups events under their chapter-local date key. */
export function groupByDay<T>(
  items: readonly T[],
  dateKeyOf: (item: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = dateKeyOf(item);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}

/**
 * Insights days arrive as plain Chicago-local dates ("2026-10-06"). Parsing
 * one with `new Date(day)` would mean midnight UTC, which is the evening
 * before in Chicago, so every label would be a day early. These read the date
 * parts directly and format at noon UTC, where no timezone can shift the day.
 */

function parseDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isNaN(date.getTime()) ? null : date;
}

const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const LONG = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
});

/** "Oct 6" */
export function formatDayShort(day: string): string {
  const date = parseDay(day);
  return date ? SHORT.format(date) : day;
}

/** "Tue" */
export function formatWeekday(day: string): string {
  const date = parseDay(day);
  return date ? WEEKDAY.format(date) : day;
}

/** "Tuesday, October 6" */
export function formatDayLong(day: string): string {
  const date = parseDay(day);
  return date ? LONG.format(date) : day;
}

/** "1 view", "3 views" */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

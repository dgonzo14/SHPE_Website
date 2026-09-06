/**
 * One place that decides what an event's state is.
 *
 * Every surface — dashboard, event card, event detail, admin table — asks this
 * module rather than comparing dates inline, so "is check-in open?" cannot mean
 * three subtly different things in three components.
 *
 * The check-in window itself is decided by the database: a trigger fills
 * check_in_opens_at/check_in_closes_at on every write (defaulting to 30 minutes
 * either side of the event). This module reads those columns, it does not
 * re-derive them, so the UI and the RPC always agree about the window.
 */

import type { EventStatus } from "@/types/database";

export type EventDisplayStatus =
  | "draft"
  | "cancelled"
  | "checkin_open"
  | "in_progress"
  | "upcoming"
  | "ended";

export interface EventTiming {
  status: EventStatus;
  start_at: string;
  end_at: string;
  check_in_opens_at: string | null;
  check_in_closes_at: string | null;
}

const ms = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

export function eventDisplayStatus(
  event: EventTiming,
  now: Date = new Date(),
): EventDisplayStatus {
  if (event.status === "draft") return "draft";
  if (event.status === "cancelled") return "cancelled";

  const t = now.getTime();
  const start = ms(event.start_at);
  const end = ms(event.end_at);
  const opens = ms(event.check_in_opens_at);
  const closes = ms(event.check_in_closes_at);

  if (opens !== null && closes !== null && t >= opens && t <= closes) {
    return "checkin_open";
  }
  if (start !== null && end !== null && t >= start && t <= end) {
    return "in_progress";
  }
  if (end !== null && t > end) return "ended";
  return "upcoming";
}

/**
 * Whether the check-in form should be offered. This is a UI affordance only —
 * the database re-checks the window on every attempt, so a stale tab cannot
 * check anyone in late.
 */
export function isCheckInOpen(event: EventTiming, now: Date = new Date()): boolean {
  return eventDisplayStatus(event, now) === "checkin_open";
}

export function isPastEvent(event: EventTiming, now: Date = new Date()): boolean {
  const end = ms(event.end_at);
  return end !== null && end < now.getTime();
}

export const EVENT_STATUS_LABELS: Record<EventDisplayStatus, string> = {
  draft: "Draft",
  cancelled: "Cancelled",
  checkin_open: "Check-in open",
  in_progress: "Happening now",
  upcoming: "Upcoming",
  ended: "Ended",
};

/**
 * Status is conveyed by label first. Colour is decoration, never the only
 * signal — a cancelled event says "Cancelled", it is not merely grey.
 */
export const EVENT_STATUS_TONE: Record<
  EventDisplayStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  draft: "neutral",
  cancelled: "danger",
  checkin_open: "success",
  in_progress: "warning",
  upcoming: "info",
  ended: "neutral",
};

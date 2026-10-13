import type { BadgeTone } from "@/components/ui/primitives";
import { chapterDateKey, formatShortDate, formatTime } from "@/lib/datetime";
import type { EventRow } from "@/types/database";

/**
 * Whether an event's attendance form is taking responses, in words an officer
 * can act on.
 *
 * This mirrors get_attendance_form() and submit_event_attendance() rather than
 * asking them, so the roster can say "opens at 6:30 PM" without a round trip
 * and update itself as the clock passes the boundary. The database stays the
 * judge: if this and it ever disagree, a response is accepted or refused by
 * the database, and this line is only wrong about what it predicted.
 *
 * The comparisons match the SQL exactly (before the opening instant is "not
 * open", after the closing one is "closed", both ends inclusive), and so do
 * the statuses: drafts don't have a working link at all, cancelled events
 * refuse responses, and a completed event counts as closed.
 */

export type AttendanceWindowState =
  | "draft"
  | "cancelled"
  | "completed"
  | "not_open"
  | "open"
  | "closed";

export interface AttendanceWindowStatus {
  state: AttendanceWindowState;
  /** A few words for a badge. */
  label: string;
  tone: BadgeTone;
  /** One or two sentences saying what the form does right now. */
  message: string;
}

export type WindowEvent = Pick<
  EventRow,
  "status" | "start_at" | "end_at" | "check_in_opens_at" | "check_in_closes_at"
>;

const HALF_HOUR_MS = 30 * 60_000;

/**
 * How long after the window closes the roster keeps refreshing itself. A
 * response sent in the window's last seconds, or judged by a database clock a
 * little behind the officer's laptop, still lands after the page's clock says
 * "closed"; two more minutes of polling picks it up without a reload.
 */
export const LIVE_AFTER_CLOSE_MS = 2 * 60_000;

/**
 * What an officer can still do once the form has shut. Add attendee only finds
 * people who have an account, so the newcomers the form exists for are pointed
 * at the add-by-name action on the same page; both work after the window.
 */
const ADD_LATECOMERS =
  "Add anyone who was missed with Add attendee if they have an account, or with Add by name and email if they don't.";

/**
 * The stored window, or the one the database would store.
 *
 * A trigger fills a blank window with 30 minutes either side of the event
 * whenever an event is saved, so both ends are always set on a real row. The
 * fallback only keeps this function total; it is the trigger's rule, not a
 * new one.
 */
function windowBounds(event: WindowEvent): { opens: number; closes: number } {
  const opens = event.check_in_opens_at
    ? new Date(event.check_in_opens_at).getTime()
    : new Date(event.start_at).getTime() - HALF_HOUR_MS;
  const closes = event.check_in_closes_at
    ? new Date(event.check_in_closes_at).getTime()
    : new Date(event.end_at).getTime() + HALF_HOUR_MS;
  return { opens, closes };
}

/** "today at 6:30 PM" or "Tue, Oct 14 at 6:30 PM", by the chapter's calendar. */
function moment(instant: number, now: number): string {
  const day = chapterDateKey(instant) === chapterDateKey(now) ? "today" : formatShortDate(instant);
  return `${day} at ${formatTime(instant)}`;
}

/** "7:30 PM" when it's later today, otherwise with the date in front. */
function until(instant: number, now: number): string {
  return chapterDateKey(instant) === chapterDateKey(now)
    ? formatTime(instant)
    : `${formatShortDate(instant)} at ${formatTime(instant)}`;
}

export function attendanceWindowStatus(
  event: WindowEvent,
  now: Date | number = Date.now(),
): AttendanceWindowStatus {
  const at = typeof now === "number" ? now : now.getTime();

  if (event.status === "draft") {
    return {
      state: "draft",
      label: "Draft",
      tone: "warning",
      message:
        "Publish the event before the form can take responses. Until then the link says it doesn't work.",
    };
  }
  if (event.status === "cancelled") {
    return {
      state: "cancelled",
      label: "Cancelled",
      tone: "danger",
      message: "This event was cancelled, so the form isn't taking responses.",
    };
  }
  if (event.status === "completed") {
    return {
      state: "completed",
      label: "Closed",
      tone: "neutral",
      message: `This event is marked completed, so the form has closed. ${ADD_LATECOMERS}`,
    };
  }

  const { opens, closes } = windowBounds(event);

  if (at < opens) {
    const closing =
      chapterDateKey(opens) === chapterDateKey(closes)
        ? `at ${formatTime(closes)}`
        : `${formatShortDate(closes)} at ${formatTime(closes)}`;
    return {
      state: "not_open",
      label: "Not open yet",
      tone: "info",
      message: `Opens ${moment(opens, at)} and closes ${closing}.`,
    };
  }
  if (at > closes) {
    return {
      state: "closed",
      label: "Closed",
      tone: "neutral",
      message: `Closed ${moment(closes, at)}. ${ADD_LATECOMERS}`,
    };
  }
  return {
    state: "open",
    label: "Open",
    tone: "success",
    message: `Taking responses now, until ${until(closes, at)}.`,
  };
}

/**
 * Whether an officer's roster should keep refreshing itself: while the window
 * is open, when form responses and code check-ins arrive without anyone on the
 * page doing anything, and for LIVE_AFTER_CLOSE_MS after it closes. Outside
 * that nothing changes unless an officer changes it, and their own actions
 * refresh the page, so polling would only cost requests.
 */
export function rosterIsLive(event: WindowEvent, now: Date | number = Date.now()): boolean {
  const at = typeof now === "number" ? now : now.getTime();
  const { state } = attendanceWindowStatus(event, at);
  if (state === "open") return true;
  return state === "closed" && at - windowBounds(event).closes <= LIVE_AFTER_CLOSE_MS;
}

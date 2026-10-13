import { describe, expect, it } from "vitest";

import { LIVE_AFTER_CLOSE_MS, attendanceWindowStatus, rosterIsLive } from "../attendanceWindow";
import type { EventRow } from "@/types/database";

/*
 * The roster's prediction of what the attendance form will say. The database
 * decides (get_attendance_form / submit_event_attendance); these pin the
 * same boundaries and statuses, and the sentences officers read.
 *
 * Wednesday, October 14, 2026 is in daylight time, so Chicago is UTC-5:
 * 6:00 PM CT is 23:00Z and 8:30 PM CT is 01:30Z the next day.
 */

const EVENT: Pick<
  EventRow,
  "status" | "start_at" | "end_at" | "check_in_opens_at" | "check_in_closes_at"
> = {
  status: "published",
  start_at: "2026-10-14T23:30:00.000Z",
  end_at: "2026-10-15T01:00:00.000Z",
  check_in_opens_at: "2026-10-14T23:00:00.000Z",
  check_in_closes_at: "2026-10-15T01:30:00.000Z",
};

const at = (iso: string) => new Date(iso);

describe("attendanceWindowStatus", () => {
  it("is open inside the window and says until when", () => {
    const status = attendanceWindowStatus(EVENT, at("2026-10-14T23:10:00Z"));
    expect(status).toMatchObject({ state: "open", label: "Open", tone: "success" });
    expect(status.message).toBe("Taking responses now, until 8:30 PM.");
  });

  it("treats both ends of the window as open, like the database", () => {
    expect(attendanceWindowStatus(EVENT, at(EVENT.check_in_opens_at!)).state).toBe("open");
    expect(attendanceWindowStatus(EVENT, at(EVENT.check_in_closes_at!)).state).toBe("open");
  });

  it("dates the closing time when it falls on another day", () => {
    const lateNight = { ...EVENT, check_in_closes_at: "2026-10-15T06:00:00.000Z" };
    expect(attendanceWindowStatus(lateNight, at("2026-10-15T02:00:00Z")).message).toBe(
      "Taking responses now, until Thu, Oct 15 at 1:00 AM.",
    );
  });

  it("says when it opens, as 'today' on the day itself", () => {
    const sameDay = attendanceWindowStatus(EVENT, at("2026-10-14T20:00:00Z"));
    expect(sameDay).toMatchObject({ state: "not_open", label: "Not open yet" });
    expect(sameDay.message).toBe("Opens today at 6:00 PM and closes at 8:30 PM.");

    expect(attendanceWindowStatus(EVENT, at("2026-10-12T15:00:00Z")).message).toBe(
      "Opens Wed, Oct 14 at 6:00 PM and closes at 8:30 PM.",
    );
  });

  it("says when it closed and what to do about latecomers, with or without an account", () => {
    const status = attendanceWindowStatus(EVENT, at("2026-10-15T02:00:00Z"));
    expect(status).toMatchObject({ state: "closed", label: "Closed" });
    expect(status.message).toBe(
      "Closed today at 8:30 PM. Add anyone who was missed with Add attendee if they have an account, or with Add by name and email if they don't.",
    );
    expect(attendanceWindowStatus(EVENT, at("2026-10-20T15:00:00Z")).message).toMatch(
      /^Closed Wed, Oct 14 at 8:30 PM\./,
    );
  });

  it("puts the event's status ahead of the clock", () => {
    const insideWindow = at("2026-10-14T23:10:00Z");

    const draft = attendanceWindowStatus({ ...EVENT, status: "draft" }, insideWindow);
    expect(draft).toMatchObject({ state: "draft", label: "Draft" });
    expect(draft.message).toMatch(/^Publish the event before the form can take responses/);

    const cancelled = attendanceWindowStatus({ ...EVENT, status: "cancelled" }, insideWindow);
    expect(cancelled).toMatchObject({ state: "cancelled", label: "Cancelled" });
    expect(cancelled.message).toMatch(/cancelled, so the form isn't taking responses/);

    // get_attendance_form() reports a completed event as closed.
    const completed = attendanceWindowStatus({ ...EVENT, status: "completed" }, insideWindow);
    expect(completed).toMatchObject({ state: "completed", label: "Closed" });
    expect(completed.message).toMatch(/Add attendee if they have an account, or with Add by name and email/);
  });

  it("falls back to the trigger's 30 minutes either side when the window is blank", () => {
    const blank = { ...EVENT, check_in_opens_at: null, check_in_closes_at: null };
    // 30 minutes before the 6:30 PM start, and 30 minutes after the 8:00 PM end.
    expect(attendanceWindowStatus(blank, at("2026-10-14T22:59:00Z")).state).toBe("not_open");
    expect(attendanceWindowStatus(blank, at("2026-10-14T23:00:00Z")).state).toBe("open");
    expect(attendanceWindowStatus(blank, at("2026-10-15T01:30:00Z")).state).toBe("open");
    expect(attendanceWindowStatus(blank, at("2026-10-15T01:31:00Z")).state).toBe("closed");
  });
});

describe("rosterIsLive", () => {
  const closes = new Date(EVENT.check_in_closes_at!).getTime();

  it("is live while the window is open, and not before it", () => {
    expect(rosterIsLive(EVENT, at("2026-10-14T22:59:00Z"))).toBe(false);
    expect(rosterIsLive(EVENT, at(EVENT.check_in_opens_at!))).toBe(true);
    expect(rosterIsLive(EVENT, at("2026-10-15T00:00:00Z"))).toBe(true);
  });

  it("stays live a little after closing, for the responses sent at the last moment", () => {
    expect(rosterIsLive(EVENT, closes + 60_000)).toBe(true);
    expect(rosterIsLive(EVENT, closes + LIVE_AFTER_CLOSE_MS)).toBe(true);
    expect(rosterIsLive(EVENT, closes + LIVE_AFTER_CLOSE_MS + 1)).toBe(false);
    expect(rosterIsLive(EVENT, at("2026-10-20T15:00:00Z"))).toBe(false);
  });

  it("is never live for an event that can't take responses", () => {
    const insideWindow = at("2026-10-14T23:10:00Z");
    expect(rosterIsLive({ ...EVENT, status: "draft" }, insideWindow)).toBe(false);
    expect(rosterIsLive({ ...EVENT, status: "cancelled" }, insideWindow)).toBe(false);
    expect(rosterIsLive({ ...EVENT, status: "completed" }, insideWindow)).toBe(false);
  });
});

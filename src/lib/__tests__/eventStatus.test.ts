import { describe, expect, it } from "vitest";
import {
  eventDisplayStatus,
  isCheckInOpen,
  isPastEvent,
  type EventTiming,
} from "../eventStatus";

const NOW = new Date("2026-09-18T23:30:00.000Z"); // 6:30 PM in St. Louis

function event(overrides: Partial<EventTiming> = {}): EventTiming {
  return {
    status: "published",
    start_at: "2026-09-18T23:30:00.000Z",
    end_at: "2026-09-19T01:00:00.000Z",
    check_in_opens_at: "2026-09-18T23:00:00.000Z",
    check_in_closes_at: "2026-09-19T01:30:00.000Z",
    ...overrides,
  };
}

describe("eventDisplayStatus", () => {
  it("reports check-in open inside the window", () => {
    expect(eventDisplayStatus(event(), NOW)).toBe("checkin_open");
  });

  it("reports upcoming before the window opens", () => {
    const before = new Date("2026-09-18T20:00:00.000Z");
    expect(eventDisplayStatus(event(), before)).toBe("upcoming");
  });

  it("reports in progress once check-in has closed but the event is running", () => {
    const running = event({ check_in_closes_at: "2026-09-18T23:45:00.000Z" });
    expect(eventDisplayStatus(running, new Date("2026-09-19T00:30:00.000Z"))).toBe(
      "in_progress",
    );
  });

  it("reports ended after the event finishes", () => {
    const after = new Date("2026-09-19T05:00:00.000Z");
    expect(eventDisplayStatus(event(), after)).toBe("ended");
  });

  it("prefers cancelled over any timing state", () => {
    // A cancelled event happening right now must never look checkin-able.
    expect(eventDisplayStatus(event({ status: "cancelled" }), NOW)).toBe("cancelled");
  });

  it("prefers draft over any timing state", () => {
    expect(eventDisplayStatus(event({ status: "draft" }), NOW)).toBe("draft");
  });
});

describe("isCheckInOpen", () => {
  it("is true only inside the stored window", () => {
    expect(isCheckInOpen(event(), NOW)).toBe(true);
    expect(isCheckInOpen(event(), new Date("2026-09-18T22:00:00.000Z"))).toBe(false);
    expect(isCheckInOpen(event(), new Date("2026-09-19T02:00:00.000Z"))).toBe(false);
  });

  it("is false for a cancelled event even mid-window", () => {
    expect(isCheckInOpen(event({ status: "cancelled" }), NOW)).toBe(false);
  });

  it("is false when no window has been stored", () => {
    // Every event gets a window from a database trigger, so a null pair means
    // something is wrong — fail closed rather than guessing.
    const noWindow = event({ check_in_opens_at: null, check_in_closes_at: null });
    expect(isCheckInOpen(noWindow, NOW)).toBe(false);
  });

  it("is false for a draft, whatever the window says", () => {
    expect(isCheckInOpen(event({ status: "draft" }), NOW)).toBe(false);
  });
});

describe("isPastEvent", () => {
  it("is true only after the end time", () => {
    expect(isPastEvent(event(), NOW)).toBe(false);
    expect(isPastEvent(event(), new Date("2026-09-19T02:00:00.000Z"))).toBe(true);
  });
});

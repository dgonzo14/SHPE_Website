import { describe, expect, it } from "vitest";
import { checkInErrorMessage, describeError, errorText } from "../errors";
import type { CheckInFailure } from "@/types/database";

describe("check-in failure messages", () => {
  it("explains an invalid code without hinting at which events are live", () => {
    const message = checkInErrorMessage({ ok: false, code: "INVALID_CODE" });
    expect(message.title).toMatch(/isn't valid/i);
    expect(message.detail).toMatch(/try again/i);
  });

  it("tells the member when check-in opens", () => {
    const failure: CheckInFailure = {
      ok: false,
      code: "CHECKIN_NOT_OPEN",
      opens_at: "2026-09-18T23:45:00.000Z", // 6:45 PM in St. Louis
    };
    expect(checkInErrorMessage(failure).detail).toBe("Check-in opens at 6:45 PM.");
  });

  it("tells the member when check-in closed and what to do instead", () => {
    const failure: CheckInFailure = {
      ok: false,
      code: "CHECKIN_CLOSED",
      closed_at: "2026-09-19T01:30:00.000Z",
    };
    const detail = checkInErrorMessage(failure).detail ?? "";
    expect(detail).toContain("8:30 PM");
    expect(detail).toMatch(/officer/i);
  });

  it("reassures rather than alarms on a duplicate check-in", () => {
    const failure: CheckInFailure = {
      ok: false,
      code: "ALREADY_CHECKED_IN",
      event_title: "GBM #3",
    };
    const message = checkInErrorMessage(failure);
    expect(message.title).toMatch(/already checked in/i);
    expect(message.detail).toContain("GBM #3");
  });

  it("explains an inactive membership as a status issue, not a failure", () => {
    const message = checkInErrorMessage({ ok: false, code: "MEMBER_NOT_ACTIVE" });
    expect(message.title).toMatch(/isn't active/i);
    expect(message.detail).toMatch(/officer/i);
  });

  it("falls back to a safe message for an unrecognised code", () => {
    const message = checkInErrorMessage({
      ok: false,
      code: "SOMETHING_NEW" as CheckInFailure["code"],
    });
    expect(message.title).toBeTruthy();
  });
});

describe("describeError", () => {
  it("maps a permission error to a role explanation, not a stack trace", () => {
    const message = describeError({ code: "42501", message: "permission denied for table" });
    expect(message.title).toMatch(/don't have access/i);
    expect(errorText({ code: "42501" })).not.toContain("42501");
  });

  it("maps an expired JWT to a re-login prompt", () => {
    const message = describeError({ code: "PGRST301", message: "JWT expired" });
    expect(message.title).toMatch(/session expired/i);
  });

  it("maps bad credentials to something a member can act on", () => {
    const message = describeError({ message: "Invalid login credentials" });
    expect(message.title).toMatch(/incorrect/i);
  });

  it("translates the opaque GoTrue signup failure into the real cause", () => {
    // GoTrue wraps any exception from the signup trigger in this one string,
    // and the domain restriction is by far the most likely cause.
    const message = describeError({ message: "Database error saving new user" });
    expect(message.detail).toMatch(/approved email addresses/i);
  });

  it("never leaks an unrecognised database message verbatim", () => {
    const message = describeError({
      message: 'relation "public.point_transactions" does not exist',
      code: "42P01",
    });
    expect(message.title).not.toContain("point_transactions");
    expect(message.detail).not.toContain("point_transactions");
  });

  it("uses the caller's fallback when nothing matches", () => {
    expect(describeError({}, "We couldn't save that").title).toBe("We couldn't save that");
  });
});

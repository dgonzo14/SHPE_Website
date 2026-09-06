import { describe, expect, it } from "vitest";
import {
  formatShortDate,
  formatTime,
  formatTimeRange,
  localInputToUtcIso,
  toIcsStamp,
  utcIsoToLocalInput,
} from "../datetime";

/**
 * The chapter runs on America/Chicago, which is UTC-5 in summer and UTC-6 in
 * winter. Getting this wrong means every event in one half of the academic year
 * displays an hour off, so the DST boundary cases are the point of this file.
 */
describe("chapter-local time conversion", () => {
  it("treats a datetime-local value as Central Daylight Time in September", () => {
    // 18 Sep 2026 18:30 CDT === 23:30 UTC
    expect(localInputToUtcIso("2026-09-18T18:30")).toBe("2026-09-18T23:30:00.000Z");
  });

  it("treats a datetime-local value as Central Standard Time in January", () => {
    // 15 Jan 2027 18:30 CST === 00:30 UTC the next day
    expect(localInputToUtcIso("2027-01-15T18:30")).toBe("2027-01-16T00:30:00.000Z");
  });

  it("round-trips a summer instant back to the same wall clock", () => {
    const local = "2026-09-18T18:30";
    expect(utcIsoToLocalInput(localInputToUtcIso(local) as string)).toBe(local);
  });

  it("round-trips a winter instant back to the same wall clock", () => {
    const local = "2027-01-15T08:05";
    expect(utcIsoToLocalInput(localInputToUtcIso(local) as string)).toBe(local);
  });

  it("resolves times either side of the spring-forward transition", () => {
    // DST starts 08 Mar 2026 at 02:00 local.
    expect(localInputToUtcIso("2026-03-07T12:00")).toBe("2026-03-07T18:00:00.000Z"); // CST, UTC-6
    expect(localInputToUtcIso("2026-03-09T12:00")).toBe("2026-03-09T17:00:00.000Z"); // CDT, UTC-5
  });

  it("resolves times either side of the fall-back transition", () => {
    // DST ends 01 Nov 2026 at 02:00 local.
    expect(localInputToUtcIso("2026-10-31T12:00")).toBe("2026-10-31T17:00:00.000Z"); // CDT
    expect(localInputToUtcIso("2026-11-02T12:00")).toBe("2026-11-02T18:00:00.000Z"); // CST
  });

  it("rejects input that is not a datetime-local value", () => {
    expect(localInputToUtcIso("")).toBeNull();
    expect(localInputToUtcIso("not a date")).toBeNull();
    expect(localInputToUtcIso("2026-09-18")).toBeNull();
  });

  it("returns an empty string rather than throwing on missing values", () => {
    expect(utcIsoToLocalInput(null)).toBe("");
    expect(utcIsoToLocalInput(undefined)).toBe("");
    expect(utcIsoToLocalInput("nonsense")).toBe("");
  });
});

describe("display formatting", () => {
  it("renders a UTC instant in chapter-local time", () => {
    // 23:30 UTC is 6:30 PM in St. Louis, not 11:30 PM.
    expect(formatTime("2026-09-18T23:30:00.000Z")).toBe("6:30 PM");
    expect(formatShortDate("2026-09-18T23:30:00.000Z")).toBe("Fri, Sep 18");
  });

  it("keeps a late-evening event on its own local day", () => {
    // 01:00 UTC on the 19th is still 8pm on the 18th in St. Louis.
    expect(formatShortDate("2026-09-19T01:00:00.000Z")).toBe("Fri, Sep 18");
  });

  it("collapses the date for a same-day range", () => {
    expect(
      formatTimeRange("2026-09-18T23:30:00.000Z", "2026-09-19T01:00:00.000Z"),
    ).toBe("6:30 PM – 8:00 PM");
  });

  it("shows both dates when a range crosses midnight locally", () => {
    const range = formatTimeRange("2026-09-18T23:30:00.000Z", "2026-09-19T06:00:00.000Z");
    expect(range).toContain("–");
    expect(range).toContain("September 18");
    expect(range).toContain("September 19");
  });

  it("returns an empty string for missing values instead of 'Invalid Date'", () => {
    expect(formatTime(null)).toBe("");
    expect(formatShortDate(undefined)).toBe("");
    expect(formatTimeRange(null, null)).toBe("");
  });
});

describe("calendar stamps", () => {
  it("emits a compact UTC stamp", () => {
    expect(toIcsStamp("2026-09-18T23:30:00.000Z")).toBe("20260918T233000Z");
  });
});

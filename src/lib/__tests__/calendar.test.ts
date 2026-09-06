import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildMonthGrid,
  groupByDay,
  monthLabel,
  monthRange,
} from "../calendar";
import { chapterDateKey } from "../datetime";

describe("buildMonthGrid", () => {
  it("always returns six full weeks, so the grid never changes height", () => {
    for (let m = 0; m < 12; m += 1) {
      const grid = buildMonthGrid(2026, m);
      expect(grid).toHaveLength(6);
      for (const week of grid) expect(week).toHaveLength(7);
    }
  });

  it("starts every week on a Sunday", () => {
    const grid = buildMonthGrid(2026, 8); // September 2026
    for (const week of grid) {
      expect(new Date(`${week[0].key}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it("pads the leading days from the previous month", () => {
    // 1 September 2026 is a Tuesday, so Sunday 30 Aug and Monday 31 Aug lead.
    const [firstWeek] = buildMonthGrid(2026, 8);
    expect(firstWeek[0]).toMatchObject({ key: "2026-08-30", day: 30, inMonth: false });
    expect(firstWeek[1]).toMatchObject({ key: "2026-08-31", day: 31, inMonth: false });
    expect(firstWeek[2]).toMatchObject({ key: "2026-09-01", day: 1, inMonth: true });
  });

  it("marks only the target month as in-month", () => {
    const days = buildMonthGrid(2026, 8).flat();
    const inMonth = days.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(30); // September
    expect(inMonth[0].key).toBe("2026-09-01");
    expect(inMonth[29].key).toBe("2026-09-30");
  });

  it("handles a 31-day month that starts on a Sunday", () => {
    // 1 March 2026 is a Sunday: no leading padding at all.
    const grid = buildMonthGrid(2026, 2);
    expect(grid[0][0]).toMatchObject({ key: "2026-03-01", inMonth: true });
    expect(grid.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });

  it("handles February in a leap year and a common year", () => {
    expect(buildMonthGrid(2028, 1).flat().filter((d) => d.inMonth)).toHaveLength(29);
    expect(buildMonthGrid(2026, 1).flat().filter((d) => d.inMonth)).toHaveLength(28);
  });

  it("does not shift across a daylight-saving boundary", () => {
    // March 2026 contains the spring-forward transition. Naive local-time date
    // arithmetic loses or duplicates a day here; UTC arithmetic does not.
    const march = buildMonthGrid(2026, 2).flat().filter((d) => d.inMonth);
    expect(march.map((d) => d.day)).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1),
    );

    // November 2026 contains the fall-back transition.
    const november = buildMonthGrid(2026, 10).flat().filter((d) => d.inMonth);
    expect(november.map((d) => d.day)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });
});

describe("month navigation", () => {
  it("rolls over the year in both directions", () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, monthIndex: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 });
  });

  it("labels the month without drifting into the previous one", () => {
    // Formatting a month boundary in local time is a classic off-by-one.
    expect(monthLabel(2026, 8)).toBe("September 2026");
    expect(monthLabel(2026, 0)).toBe("January 2026");
    expect(monthLabel(2026, 11)).toBe("December 2026");
  });
});

describe("monthRange", () => {
  it("spans the whole six-week grid, not just the month", () => {
    // September 2026's grid runs 30 Aug to 10 Oct. A fixed one-week padding
    // around the month would stop at 8 Oct and lose the last two cells.
    const { from, to } = monthRange(2026, 8);
    expect(from).toBe("2026-08-29T00:00:00.000Z");
    expect(to).toBe("2026-10-12T00:00:00.000Z");
  });

  it("covers the trailing cells of a short month too", () => {
    // February 2026 is 28 days starting on a Sunday, so the grid runs a full
    // ten days past the end of the month.
    const grid = buildMonthGrid(2026, 1).flat();
    const { to } = monthRange(2026, 1);
    expect(grid[grid.length - 1].key).toBe("2026-03-14");
    expect(to.slice(0, 10) >= "2026-03-14").toBe(true);
  });

  it("covers every day the grid can display", () => {
    const grid = buildMonthGrid(2026, 8).flat();
    const { from, to } = monthRange(2026, 8);
    for (const day of grid) {
      expect(day.key >= from.slice(0, 10)).toBe(true);
      expect(day.key <= to.slice(0, 10)).toBe(true);
    }
  });
});

describe("bucketing events into days", () => {
  it("keeps an evening event on its chapter-local day", () => {
    // 01:00 UTC on 19 September is 8pm on the 18th in St. Louis. Bucketing on
    // the raw ISO string would push most evening events onto the next day.
    expect(chapterDateKey("2026-09-19T01:00:00.000Z")).toBe("2026-09-18");
    expect(chapterDateKey("2026-09-18T23:30:00.000Z")).toBe("2026-09-18");
  });

  it("groups several events under one day", () => {
    const events = [
      { id: "a", start_at: "2026-09-18T23:30:00.000Z" },
      { id: "b", start_at: "2026-09-19T01:00:00.000Z" },
      { id: "c", start_at: "2026-09-20T18:00:00.000Z" },
    ];
    const grouped = groupByDay(events, (e) => chapterDateKey(e.start_at));

    expect(grouped.get("2026-09-18")?.map((e) => e.id)).toEqual(["a", "b"]);
    expect(grouped.get("2026-09-20")?.map((e) => e.id)).toEqual(["c"]);
    expect(grouped.has("2026-09-19")).toBe(false);
  });

  it("produces keys that match the grid's keys", () => {
    const grid = buildMonthGrid(2026, 8).flat();
    const key = chapterDateKey("2026-09-18T23:30:00.000Z");
    expect(grid.some((day) => day.key === key)).toBe(true);
  });
});

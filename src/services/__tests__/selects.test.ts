import { describe, expect, it } from "vitest";

import { EVENT_ATTENDANCE_SELECT } from "@/services/events";
import { RECENT_ATTENDANCE_SELECT } from "@/services/admin";

/**
 * event_attendance has two foreign keys to profiles (member_id, verified_by),
 * so any embed of profiles from it must name which one. Without the hint
 * PostgREST rejects the request with PGRST201 at planning time -- before the
 * database is touched, and identically whether the table is empty or full.
 * That is how it reached production and stayed there until the first meeting
 * with real attendance.
 *
 * These assert the hint is present. They cannot assert the query is valid --
 * that needs a live PostgREST, and the check that actually proved it was run
 * against production by hand. This is the regression guard, not the proof.
 */
describe("attendance select strings", () => {
  for (const [name, select] of [
    ["EVENT_ATTENDANCE_SELECT", EVENT_ATTENDANCE_SELECT],
    ["RECENT_ATTENDANCE_SELECT", RECENT_ATTENDANCE_SELECT],
  ] as const) {
    it(`${name} names which foreign key it embeds profiles through`, () => {
      expect(select).toContain("profiles!event_attendance_member_id_fkey(");
      expect(select, "a bare profiles( embed is the PGRST201 bug").not.toMatch(
        /[^!_a-z]profiles\s*\(/,
      );
    });
  }
});

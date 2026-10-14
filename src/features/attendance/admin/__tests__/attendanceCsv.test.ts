import { describe, expect, it } from "vitest";

import { WAITING_CHECK_IN_METHOD, attendanceCsv } from "../attendanceCsv";
import { checkInMethodLabel, submissionName } from "../labels";
import type { WaitingSubmission } from "@/services/attendanceForm";
import type { EventAttendee } from "@/services/events";

const EVENT = {
  title: "Boeing Night",
  points_value: 10,
  category: { id: "c1", name: "Professional", slug: "professional", color: null },
};

const ATTENDEE: EventAttendee = {
  id: "a1",
  member_id: "m1",
  checked_in_at: "2026-10-14T23:05:00.000Z",
  check_in_method: "form",
  verified_by: null,
  member: {
    id: "m1",
    first_name: "Ana",
    last_name: "Rivera",
    email: "ana.rivera@wustl.edu",
    graduation_year: 2028,
    major: "Computer Science",
  },
};

const WAITING: WaitingSubmission = {
  id: "s1",
  event_id: "e1",
  first_name: "Luis",
  last_name: "Ortiz",
  email: "luis.ortiz@gmail.com",
  added_by: null,
  submitted_at: "2026-10-14T23:12:00.000Z",
};

describe("attendanceCsv", () => {
  it("lists the roster, then the waiting responses with no points", () => {
    const lines = attendanceCsv(EVENT, [ATTENDEE], [WAITING]).split("\r\n");

    expect(lines[0]).toBe(
      "Member name,Email,Major,Graduation year,Event,Category,Checked in at,Check-in method,Points awarded",
    );
    expect(lines[1]).toBe(
      'Ana Rivera,ana.rivera@wustl.edu,Computer Science,2028,Boeing Night,Professional,"Wednesday, October 14 at 6:05 PM",form,10',
    );
    expect(lines[2]).toBe(
      `Luis Ortiz,luis.ortiz@gmail.com,,,Boeing Night,Professional,"Wednesday, October 14 at 6:12 PM",${WAITING_CHECK_IN_METHOD},0`,
    );
    expect(lines).toHaveLength(3);
  });

  it("doesn't call a response an officer typed in a form response", () => {
    // It becomes manual attendance once claimed, so it's listed as that.
    const typedIn: WaitingSubmission = { ...WAITING, id: "s2", added_by: "o1" };
    const lines = attendanceCsv(EVENT, [], [WAITING, typedIn]).split("\r\n");

    expect(lines[1]).toMatch(/,form \(waiting for an account\),0$/);
    expect(lines[2]).toMatch(/,manual \(waiting for an account\),0$/);
  });

  it("still guards the form's free-text fields against spreadsheet formulas", () => {
    const csv = attendanceCsv(EVENT, [], [{ ...WAITING, first_name: "=HYPERLINK(1)" }]);
    expect(csv).toContain("'=HYPERLINK(1) Ortiz");
  });
});

describe("labels", () => {
  it("names each check-in method, the form included", () => {
    expect(checkInMethodLabel("form")).toBe("Form");
    expect(checkInMethodLabel("qr")).toBe("QR");
    expect(checkInMethodLabel("code")).toBe("Code");
    // A method from a future migration still reads as a word.
    expect(checkInMethodLabel("kiosk")).toBe("Kiosk");
  });

  it("joins a response's name as typed", () => {
    expect(submissionName(WAITING)).toBe("Luis Ortiz");
  });
});

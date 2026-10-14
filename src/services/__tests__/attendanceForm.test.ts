import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_SUBMIT_MESSAGES,
  attendanceFormPath,
  attendanceFormUrl,
  isAttendanceToken,
} from "../attendanceForm";

/*
 * The pure helpers around the attendance link. isAttendanceToken is what lets
 * the page answer "this link doesn't work" without a round trip, so it has to
 * agree with the shape the database issues and checks
 * (event_attendance_links_token_shape: ^[0-9a-f]{32}$) -- too loose and junk
 * reaches the RPC, too strict and a real link is turned away at the door.
 */

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("isAttendanceToken", () => {
  it("accepts the shape the database issues", () => {
    expect(isAttendanceToken(TOKEN)).toBe(true);
    // What admin_rotate_attendance_link() makes: a v4 UUID without its dashes.
    expect(isAttendanceToken("5f0c6b1e9a2d4c3b8e7f6a5b4c3d2e1f")).toBe(true);
  });

  /*
   * Lowercase only. The page lowercases what's in the address bar before
   * asking, so a link that arrives in capitals still works; this checks the
   * normalised value.
   */
  it("rejects capitals, which the page normalises before asking", () => {
    expect(isAttendanceToken(TOKEN.toUpperCase())).toBe(false);
  });

  it("rejects a link that was copied incompletely or with extra characters", () => {
    expect(isAttendanceToken(TOKEN.slice(0, 31))).toBe(false);
    expect(isAttendanceToken(`${TOKEN}0`)).toBe(false);
    expect(isAttendanceToken(` ${TOKEN}`)).toBe(false);
    expect(isAttendanceToken(`${TOKEN}\n`)).toBe(false);
  });

  it("rejects anything that isn't hex", () => {
    expect(isAttendanceToken("0123456789abcdef0123456789abcdeg")).toBe(false);
    expect(isAttendanceToken("01234567-89ab-cdef-0123-456789abcdef")).toBe(false);
    expect(isAttendanceToken("../../../../../../../../../../../")).toBe(false);
  });

  it("rejects a missing route parameter", () => {
    expect(isAttendanceToken(undefined)).toBe(false);
    expect(isAttendanceToken("")).toBe(false);
  });
});

describe("attendance form addresses", () => {
  it("puts the token in the path, never in the query string", () => {
    // A ?code= parameter would be taken for an auth redirect by Supabase's
    // session detection (the client runs PKCE with detectSessionInUrl).
    expect(attendanceFormPath(TOKEN)).toBe(`/attend/${TOKEN}`);
  });

  it("builds the absolute URL the QR code carries from the same path", () => {
    const url = attendanceFormUrl(TOKEN);
    expect(url).toMatch(/^https?:\/\//);
    expect(new URL(url).pathname.endsWith(attendanceFormPath(TOKEN))).toBe(true);
    expect(new URL(url).search).toBe("");
  });
});

describe("ATTENDANCE_SUBMIT_MESSAGES", () => {
  it("gives every refusal a human title and never shows the code", () => {
    for (const [code, message] of Object.entries(ATTENDANCE_SUBMIT_MESSAGES)) {
      expect(message.title.trim(), code).not.toBe("");
      expect(`${message.title} ${message.detail ?? ""}`, code).not.toContain(code);
      expect(`${message.title} ${message.detail ?? ""}`, code).not.toMatch(/_/);
    }
  });
});

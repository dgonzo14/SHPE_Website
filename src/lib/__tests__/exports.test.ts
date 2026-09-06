import { describe, expect, it } from "vitest";
import { csvFilename, toCsv } from "../csv";
import { buildIcs, googleCalendarUrl } from "../ics";

interface Row {
  name: string;
  email: string;
  points: number;
}

const columns = [
  { header: "Member name", value: (r: Row) => r.name },
  { header: "Email", value: (r: Row) => r.email },
  { header: "Points", value: (r: Row) => r.points },
];

describe("CSV export", () => {
  it("writes a header row and one line per record", () => {
    const csv = toCsv<Row>(
      [{ name: "Ana Rivera", email: "ana@wustl.edu", points: 15 }],
      columns,
    );
    expect(csv.split("\r\n")).toEqual([
      "Member name,Email,Points",
      "Ana Rivera,ana@wustl.edu,15",
    ]);
  });

  it("quotes values containing commas, quotes or newlines", () => {
    const csv = toCsv<Row>(
      [{ name: 'Rivera, Ana "Anita"', email: "ana@wustl.edu", points: 15 }],
      columns,
    );
    expect(csv).toContain('"Rivera, Ana ""Anita"""');
  });

  it("neutralises spreadsheet formula injection from member-supplied text", () => {
    // A major or a correction reason is free text. Without the guard, Excel
    // would execute this when an officer opens the export.
    const csv = toCsv<Row>(
      [{ name: "=HYPERLINK(\"http://evil\",\"click\")", email: "a@wustl.edu", points: 1 }],
      columns,
    );
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.split("\r\n")[1].startsWith("=")).toBe(false);
  });

  it("renders empty cells for null and undefined rather than the word 'null'", () => {
    const csv = toCsv<{ a: string | null; b: undefined }>([{ a: null, b: undefined }], [
      { header: "A", value: (r) => r.a },
      { header: "B", value: (r) => r.b },
    ]);
    expect(csv.split("\r\n")[1]).toBe(",");
  });

  it("builds a readable, filesystem-safe filename", () => {
    expect(csvFilename("Boeing Networking Night", "attendance")).toBe(
      "boeing-networking-night-attendance.csv",
    );
    expect(csvFilename(null, undefined)).toBe("export.csv");
  });
});

describe("calendar export", () => {
  const event = {
    id: "8b1f2c3d-0000-4000-8000-000000000001",
    title: "Boeing Networking Night",
    description: "Meet Boeing engineers; bring a resume.",
    location: "Knight Hall",
    start_at: "2026-09-18T23:30:00.000Z",
    end_at: "2026-09-19T01:00:00.000Z",
  };

  it("emits a valid VEVENT with UTC stamps", () => {
    const ics = buildIcs(event);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20260918T233000Z");
    expect(ics).toContain("DTEND:20260919T010000Z");
    expect(ics).toContain("SUMMARY:Boeing Networking Night");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("escapes commas and semicolons per RFC 5545", () => {
    const ics = buildIcs({ ...event, location: "Knight Hall, Room 101; Danforth" });
    expect(ics).toContain("LOCATION:Knight Hall\\, Room 101\\; Danforth");
  });

  it("escapes newlines in the description", () => {
    const ics = buildIcs({ ...event, description: "Line one\nLine two" });
    expect(ics).toContain("Line one\\nLine two");
  });

  it("uses CRLF line endings", () => {
    expect(buildIcs(event)).toContain("\r\n");
  });

  it("builds a Google Calendar link with the same instants", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.searchParams.get("dates")).toBe("20260918T233000Z/20260919T010000Z");
    expect(url.searchParams.get("text")).toBe("Boeing Networking Night");
    expect(url.searchParams.get("location")).toBe("Knight Hall");
  });
});

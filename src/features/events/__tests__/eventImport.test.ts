import { describe, expect, it } from "vitest";
import { normaliseHeader, parseCsv, toTable } from "@/lib/csvParse";
import { eventCsvTemplate, parseEventCsv } from "../eventImport";
import type { EventCategoryRow } from "@/types/database";

const categories = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "General Body Meeting",
    slug: "general-body-meeting",
    description: null,
    color: null,
    sort_order: 10,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Corporate",
    slug: "corporate",
    description: null,
    color: null,
    sort_order: 30,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
] satisfies EventCategoryRow[];

const HEADER =
  "title,category,start,end,location,points,status,is_public,description,capacity,organizer_name,organizer_email";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseCsv", () => {
  it("keeps a quoted comma inside one field", () => {
    // The single most likely way a naive split breaks a real export.
    const rows = parseCsv('a,"Boeing Night, with recruiters",c');
    expect(rows).toEqual([["a", "Boeing Night, with recruiters", "c"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a,"She said ""bring a resume""",c')).toEqual([
      ["a", 'She said "bring a resume"', "c"],
    ]);
  });

  it("keeps a newline inside a quoted field", () => {
    const rows = parseCsv('title,description\nGBM,"Line one\nLine two"');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe("Line one\nLine two");
  });

  it("handles CRLF line endings, which is what Excel writes", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips a UTF-8 BOM so the first header is not corrupted", () => {
    const withBom = `${String.fromCharCode(0xfeff)}title,category\nGBM,corporate`;
    expect(toTable(parseCsv(withBom)).headers[0]).toBe("title");
  });

  it("ignores a trailing newline rather than inventing an empty row", () => {
    expect(parseCsv("a,b\nc,d\n")).toHaveLength(2);
  });

  it("pads short rows so missing trailing columns read as empty", () => {
    const { records } = toTable(parseCsv("title,category,location\nGBM,corporate"));
    expect(records[0]).toEqual({ title: "GBM", category: "corporate", location: "" });
  });
});

describe("normaliseHeader", () => {
  it("accepts the spellings an officer would actually type", () => {
    expect(normaliseHeader("Start Time")).toBe("start_time");
    expect(normaliseHeader("  POINTS  ")).toBe("points");
    expect(normaliseHeader("organizer-email")).toBe("organizer_email");
  });
});

describe("parseEventCsv", () => {
  it("maps a complete row to a create payload", () => {
    const result = parseEventCsv(
      csv(
        "Boeing Networking Night,corporate,2026-09-18 18:30,2026-09-18 20:00,Knight Hall,15,published,true,Meet recruiters,60,Tomas Herrera,shpe@wustl.edu",
      ),
      categories,
    );

    expect(result.invalid).toHaveLength(0);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].payload).toMatchObject({
      title: "Boeing Networking Night",
      category_id: "22222222-2222-4222-8222-222222222222",
      location: "Knight Hall",
      points_value: 15,
      capacity: 60,
      status: "published",
      is_public: true,
      organizer_email: "shpe@wustl.edu",
    });
  });

  it("reads times as St. Louis local and stores them as UTC", () => {
    // 18:30 CDT on 18 September is 23:30 UTC. Storing the literal string would
    // put every event five hours out.
    const result = parseEventCsv(
      csv("GBM,general-body-meeting,2026-09-18 18:30,2026-09-18 20:00,,10"),
      categories,
    );
    expect(result.valid[0].payload?.start_at).toBe("2026-09-18T23:30:00.000Z");
  });

  it("gets the offset right on the other side of daylight saving", () => {
    const result = parseEventCsv(
      csv("Spring GBM,general-body-meeting,2027-01-15 18:30,2027-01-15 20:00,,10"),
      categories,
    );
    expect(result.valid[0].payload?.start_at).toBe("2027-01-16T00:30:00.000Z");
  });

  it("defaults to draft, so a bulk import never goes live unreviewed", () => {
    const result = parseEventCsv(
      csv("GBM,general-body-meeting,2026-09-18 18:30,2026-09-18 20:00,,10"),
      categories,
    );
    expect(result.valid[0].payload?.status).toBe("draft");
  });

  it("defaults to public, and understands the ways people write no", () => {
    const result = parseEventCsv(
      csv(
        "A,corporate,2026-09-18 18:30,2026-09-18 20:00,,10,draft,",
        "B,corporate,2026-09-18 18:30,2026-09-18 20:00,,10,draft,false",
        "C,corporate,2026-09-18 18:30,2026-09-18 20:00,,10,draft,no",
        "D,corporate,2026-09-18 18:30,2026-09-18 20:00,,10,draft,internal",
        "E,corporate,2026-09-18 18:30,2026-09-18 20:00,,10,draft,YES",
      ),
      categories,
    );
    expect(result.valid.map((r) => r.payload?.is_public)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
  });

  it("matches a category by slug or by display name, case-insensitively", () => {
    const result = parseEventCsv(
      csv(
        "A,corporate,2026-09-18 18:30,2026-09-18 20:00,,10",
        "B,Corporate,2026-09-18 18:30,2026-09-18 20:00,,10",
        "C,General Body Meeting,2026-09-18 18:30,2026-09-18 20:00,,10",
      ),
      categories,
    );
    expect(result.invalid).toHaveLength(0);
    expect(result.valid.map((r) => r.payload?.category_id)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("leaves the check-in window to the database trigger", () => {
    const result = parseEventCsv(
      csv("GBM,general-body-meeting,2026-09-18 18:30,2026-09-18 20:00,,10"),
      categories,
    );
    expect(result.valid[0].payload?.check_in_opens_at).toBeNull();
    expect(result.valid[0].payload?.check_in_closes_at).toBeNull();
  });

  describe("rejects bad rows with a message naming the problem", () => {
    const cases: [string, string, RegExp][] = [
      ["a missing title", ",corporate,2026-09-18 18:30,2026-09-18 20:00,,10", /Title is required/],
      [
        "an unknown category",
        "GBM,social-hour,2026-09-18 18:30,2026-09-18 20:00,,10",
        /Unknown category "social-hour"/,
      ],
      [
        "an ambiguous US-style date",
        "GBM,corporate,9/18/2026 18:30,2026-09-18 20:00,,10",
        /not YYYY-MM-DD HH:MM/,
      ],
      [
        "an end before the start",
        "GBM,corporate,2026-09-18 20:00,2026-09-18 18:30,,10",
        /End has to be after start/,
      ],
      [
        "negative points",
        "GBM,corporate,2026-09-18 18:30,2026-09-18 20:00,,-5",
        /Points cannot be negative/,
      ],
      [
        "fractional points",
        "GBM,corporate,2026-09-18 18:30,2026-09-18 20:00,,2.5",
        /not a whole number/,
      ],
      [
        "an unknown status",
        "GBM,corporate,2026-09-18 18:30,2026-09-18 20:00,,10,live",
        /Unknown status "live"/,
      ],
      [
        "a malformed organiser email",
        "GBM,corporate,2026-09-18 18:30,2026-09-18 20:00,,10,draft,true,,,Someone,not-an-email",
        /not a valid email address/,
      ],
    ];

    it.each(cases)("%s", (_label, row, expected) => {
      const result = parseEventCsv(csv(row), categories);
      expect(result.valid).toHaveLength(0);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0].errors.join(" ")).toMatch(expected);
    });
  });

  it("imports the good rows and skips the bad ones", () => {
    // A typo on line 3 must not cost the officer the other two events.
    const result = parseEventCsv(
      csv(
        "Good One,corporate,2026-09-18 18:30,2026-09-18 20:00,,10",
        "Bad One,not-a-category,2026-09-19 18:30,2026-09-19 20:00,,10",
        "Good Two,corporate,2026-09-20 18:30,2026-09-20 20:00,,10",
      ),
      categories,
    );
    expect(result.valid.map((r) => r.title)).toEqual(["Good One", "Good Two"]);
    expect(result.invalid.map((r) => r.title)).toEqual(["Bad One"]);
  });

  it("reports the spreadsheet line number, header row included", () => {
    const result = parseEventCsv(
      csv(
        "Good,corporate,2026-09-18 18:30,2026-09-18 20:00,,10",
        "Bad,nope,2026-09-19 18:30,2026-09-19 20:00,,10",
      ),
      categories,
    );
    // The bad row is the third line of the file as the officer sees it.
    expect(result.invalid[0].line).toBe(3);
  });

  it("flags columns it does not understand instead of ignoring them silently", () => {
    const result = parseEventCsv(
      ["title,category,start,end,speaker", "GBM,corporate,2026-09-18 18:30,2026-09-18 20:00,Ana"].join(
        "\n",
      ),
      categories,
    );
    expect(result.unknownHeaders).toEqual(["speaker"]);
  });

  it("parses its own template cleanly", () => {
    // The template ships with a quoted comma and a non-public row, so this also
    // exercises the parser end to end.
    const withTemplateCategories = [
      ...categories,
      {
        ...categories[0],
        id: "33333333-3333-4333-8333-333333333333",
        name: "Professional Development",
        slug: "professional-development",
      },
      {
        ...categories[0],
        id: "44444444-4444-4444-8444-444444444444",
        name: "Other",
        slug: "other",
      },
    ];

    const result = parseEventCsv(eventCsvTemplate(), withTemplateCategories);
    expect(result.invalid).toHaveLength(0);
    expect(result.valid).toHaveLength(3);
    expect(result.valid[0].payload?.description).toContain(
      "Chapter updates, committee sign-ups",
    );
    expect(result.valid[2].payload?.is_public).toBe(false);
  });
});

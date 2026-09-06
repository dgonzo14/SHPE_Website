/**
 * Turning a spreadsheet into events.
 *
 * Kept pure and separate from the dialog so the interesting part — what counts
 * as a valid row, and what the officer is told when it is not — is directly
 * testable. The UI does nothing but render what this returns.
 *
 * Imported events default to **draft**. A bulk import is exactly where a typo
 * gets multiplied by twelve, so nothing goes live until an officer has looked
 * at the list and published it.
 */

import { parseCsv, pick, toTable } from "@/lib/csvParse";
import { localInputToUtcIso } from "@/lib/datetime";
import type { EventWritePayload } from "@/services/events";
import type { EventCategoryRow, EventStatus } from "@/types/database";

export interface ImportRow {
  /** 1-based row number as it appears in the spreadsheet, header included. */
  line: number;
  title: string;
  payload: EventWritePayload | null;
  errors: string[];
}

export interface ImportResult {
  rows: ImportRow[];
  valid: ImportRow[];
  invalid: ImportRow[];
  /** Header names in the file that this importer does not use. */
  unknownHeaders: string[];
}

const KNOWN_HEADERS = new Set([
  "title",
  "category",
  "category_slug",
  "start",
  "start_at",
  "start_time",
  "end",
  "end_at",
  "end_time",
  "location",
  "points",
  "points_value",
  "status",
  "is_public",
  "public",
  "description",
  "capacity",
  "organizer_name",
  "organizer",
  "organizer_email",
]);

const VALID_STATUSES: EventStatus[] = ["draft", "published", "cancelled", "completed"];

/**
 * Accepts "2026-09-18 18:30", "2026-09-18T18:30", and the same with seconds.
 * Deliberately does NOT accept "9/18/2026": that is ambiguous between US and
 * international ordering, and silently guessing wrong would put an event a
 * month out.
 */
function parseLocalDateTime(raw: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi] = match;
  return localInputToUtcIso(`${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}`);
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (value === "") return fallback;
  if (["true", "yes", "y", "1", "public"].includes(value)) return true;
  if (["false", "no", "n", "0", "internal", "private"].includes(value)) return false;
  return fallback;
}

function parseInteger(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw.trim());
  return Number.isInteger(value) ? value : null;
}

/**
 * Matches a category by slug or by display name, case-insensitively, so the
 * officer can write "Corporate" or "corporate" or "general-body-meeting".
 */
function resolveCategory(raw: string, categories: readonly EventCategoryRow[]) {
  const needle = raw.trim().toLowerCase();
  return (
    categories.find((c) => c.slug.toLowerCase() === needle) ??
    categories.find((c) => c.name.toLowerCase() === needle) ??
    null
  );
}

export function parseEventCsv(
  text: string,
  categories: readonly EventCategoryRow[],
): ImportResult {
  const { headers, records } = toTable(parseCsv(text));
  const unknownHeaders = headers.filter((h) => h !== "" && !KNOWN_HEADERS.has(h));

  const rows: ImportRow[] = records.map((record, index) => {
    const line = index + 2; // +1 for the header row, +1 for 1-based numbering
    const errors: string[] = [];

    const title = pick(record, "title");
    if (!title) errors.push("Title is required");

    const categoryRaw = pick(record, "category", "category_slug");
    const category = categoryRaw ? resolveCategory(categoryRaw, categories) : null;
    if (!categoryRaw) {
      errors.push("Category is required");
    } else if (!category) {
      errors.push(`Unknown category "${categoryRaw}"`);
    }

    const startRaw = pick(record, "start", "start_at", "start_time");
    const start = startRaw ? parseLocalDateTime(startRaw) : null;
    if (!startRaw) errors.push("Start is required");
    else if (!start) errors.push(`Start "${startRaw}" is not YYYY-MM-DD HH:MM`);

    const endRaw = pick(record, "end", "end_at", "end_time");
    const end = endRaw ? parseLocalDateTime(endRaw) : null;
    if (!endRaw) errors.push("End is required");
    else if (!end) errors.push(`End "${endRaw}" is not YYYY-MM-DD HH:MM`);

    if (start && end && end <= start) {
      errors.push("End has to be after start");
    }

    const pointsRaw = pick(record, "points", "points_value");
    const points = pointsRaw === "" ? 0 : parseInteger(pointsRaw);
    if (points === null) errors.push(`Points "${pointsRaw}" is not a whole number`);
    else if (points < 0) errors.push("Points cannot be negative");

    const capacityRaw = pick(record, "capacity");
    const capacity = capacityRaw === "" ? null : parseInteger(capacityRaw);
    if (capacityRaw !== "" && (capacity === null || capacity < 1)) {
      errors.push(`Capacity "${capacityRaw}" is not a positive whole number`);
    }

    const statusRaw = pick(record, "status").toLowerCase();
    let status: EventStatus = "draft";
    if (statusRaw !== "") {
      if ((VALID_STATUSES as string[]).includes(statusRaw)) {
        status = statusRaw as EventStatus;
      } else {
        errors.push(`Unknown status "${statusRaw}"`);
      }
    }

    const email = pick(record, "organizer_email");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push(`"${email}" is not a valid email address`);
    }

    if (errors.length > 0 || !category || !start || !end || points === null) {
      return { line, title: title || `Row ${line}`, payload: null, errors };
    }

    return {
      line,
      title,
      errors: [],
      payload: {
        title,
        description: pick(record, "description") || null,
        category_id: category.id,
        start_at: start,
        end_at: end,
        // Left null so the database trigger fills the standard window
        // (30 minutes either side). A CSV is not the place to hand-tune that.
        check_in_opens_at: null,
        check_in_closes_at: null,
        location: pick(record, "location") || null,
        points_value: points,
        capacity,
        status,
        is_public: parseBoolean(pick(record, "is_public", "public"), true),
        organizer_name: pick(record, "organizer_name", "organizer") || null,
        organizer_email: email || null,
        image_url: null,
      },
    };
  });

  return {
    rows,
    valid: rows.filter((r) => r.payload !== null),
    invalid: rows.filter((r) => r.payload === null),
    unknownHeaders,
  };
}

/** A filled-in example, so nobody has to guess the column names. */
export function eventCsvTemplate(): string {
  return [
    "title,category,start,end,location,points,status,is_public,description,capacity,organizer_name,organizer_email",
    'General Body Meeting #1,general-body-meeting,2026-09-04 19:00,2026-09-04 20:30,Lopata Hall 101,10,draft,true,"Chapter updates, committee sign-ups, dinner provided",,Olivia Officer,shpe@wustl.edu',
    "Resume Review Workshop,Professional Development,2026-09-11 18:00,2026-09-11 19:30,Whitaker Hall 218,10,draft,true,Bring a draft resume,40,,",
    "Exec Board Sync,Other,2026-09-13 17:00,2026-09-13 18:00,Zoom,0,draft,false,Officers only,,,",
    "",
  ].join("\r\n");
}

/**
 * A small RFC 4180 CSV reader.
 *
 * Hand-written rather than pulled from a package because the requirement is
 * narrow — read a spreadsheet an officer exported — and the failure modes that
 * matter are the ones a naive `split(",")` gets wrong:
 *
 *   "Boeing Networking Night, with recruiters"   → one field, not two
 *   "She said ""bring a resume"""                → embedded quotes
 *   "Line one\nLine two"                         → a newline inside a field
 *
 * Excel and Google Sheets both emit all three.
 */

/** Splits CSV text into rows of raw string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
  // part of the first header name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline should not produce a phantom empty row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Handles CRLF and a lone CR.
      if (input[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export interface CsvTable {
  /** Header names, lower-cased and trimmed, for tolerant matching. */
  headers: string[];
  /** One record per data row, keyed by header. Short rows pad with "". */
  records: Record<string, string>[];
}

/**
 * Turns parsed rows into header-keyed records.
 *
 * Headers are normalised (lower-cased, punctuation collapsed to underscores) so
 * "Start Time", "start time" and "start_time" all resolve to the same field.
 * Officers build these files by hand; being fussy about capitalisation would
 * only generate support questions.
 */
export function toTable(rows: string[][]): CsvTable {
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map(normaliseHeader);
  const records = rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (row[index] ?? "").trim();
    });
    return record;
  });

  return { headers, records };
}

export function normaliseHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Reads the first non-empty value among several accepted header spellings. */
export function pick(record: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return "";
}

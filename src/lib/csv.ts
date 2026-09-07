/**
 * Client-side CSV export.
 *
 * The rows have already been fetched through an authorised, RLS-checked query,
 * so building the file in the browser adds no new access path — and there is no
 * permanent, guessable export URL sitting on a server with member data behind it.
 */

/**
 * Escapes a value for CSV. The leading-quote guard on +, -, =, @ stops a
 * spreadsheet from treating a cell such as `=HYPERLINK(...)` in a member-supplied
 * field as a formula when an officer opens the export.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface CsvColumn<T> {
  /** Header text written to the file. Should read as English, not as a column name. */
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(","));
  return [header, ...body].join("\r\n");
}

/** Triggers a download of `content` as `filename`. No network round trip. */
export function downloadCsv(filename: string, content: string): void {
  // A UTF-8 BOM makes Excel open the export without mangling accented names.
  // Written via fromCharCode rather than pasted, so it stays visible in review.
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** "boeing-networking-night-attendance-2026-09-18.csv" */
export function csvFilename(...parts: (string | null | undefined)[]): string {
  const slug = parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "export"}.csv`;
}

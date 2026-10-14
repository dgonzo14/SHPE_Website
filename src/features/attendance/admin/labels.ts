import type { WaitingSubmission } from "@/services/attendanceForm";
import type { CheckinMethod } from "@/types/database";

const METHOD_LABELS: Record<CheckinMethod, string> = {
  code: "Code",
  qr: "QR",
  manual: "Manual",
  import: "Import",
  form: "Form",
};

/**
 * How a check-in arrived, for the roster.
 *
 * A lookup rather than CSS capitalisation, which turned "qr" into "Qr". The
 * column is typed as a plain string because PostgREST hands back whatever the
 * enum holds, so a method added in a later migration still shows, capitalised,
 * instead of an empty cell.
 */
export function checkInMethodLabel(method: string): string {
  if (Object.hasOwn(METHOD_LABELS, method)) return METHOD_LABELS[method as CheckinMethod];
  return method ? method.charAt(0).toUpperCase() + method.slice(1) : "";
}

/** "Ana Rivera", as they typed it on the attendance form. */
export function submissionName(
  submission: Pick<WaitingSubmission, "first_name" | "last_name">,
): string {
  return `${submission.first_name} ${submission.last_name}`.trim();
}

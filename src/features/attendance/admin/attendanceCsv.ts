import { toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/datetime";
import { memberName } from "@/services/members";
import type { WaitingSubmission } from "@/services/attendanceForm";
import type { EventAttendee, EventWithCategory } from "@/services/events";
import { submissionName } from "./labels";

/**
 * Written in the check-in method column for a form response that hasn't
 * reached an account yet. Lowercase like the stored methods beside it, so a
 * spreadsheet filter on "form" catches both kinds.
 */
export const WAITING_CHECK_IN_METHOD = "form (waiting for an account)";

/**
 * The same for a response an officer typed in by name and email. It never
 * went through the form, and it becomes 'manual' attendance once an account
 * claims it, so it's listed as what it will be, like the form's.
 */
export const WAITING_MANUAL_CHECK_IN_METHOD = "manual (waiting for an account)";

interface ExportRow {
  name: string;
  email: string;
  major: string;
  graduationYear: number | "";
  checkedInAt: string;
  method: string;
  points: number;
}

/**
 * An event's attendance as CSV: everyone on the roster, then everyone whose
 * response (through the form, or typed in by an officer) is still waiting for
 * an account.
 *
 * The waiting rows are there because the export is how officers report who
 * came (to sponsors, to SHPE National), and someone who filled in the form at
 * the door, or was added by name, attended whether or not they've made an
 * account yet. They carry 0 points because none have been awarded: those
 * arrive with the account, and the export says only what is true at the
 * moment it's taken.
 */
export function attendanceCsv(
  event: Pick<EventWithCategory, "title" | "points_value" | "category">,
  attendees: readonly EventAttendee[],
  waiting: readonly WaitingSubmission[],
): string {
  const rows: ExportRow[] = [
    ...attendees.map((row) => ({
      name: row.member ? memberName(row.member) : "",
      email: row.member?.email ?? "",
      major: row.member?.major ?? "",
      graduationYear: row.member?.graduation_year ?? ("" as const),
      checkedInAt: row.checked_in_at,
      method: row.check_in_method,
      points: event.points_value,
    })),
    ...waiting.map((submission) => ({
      name: submissionName(submission),
      email: submission.email,
      major: "",
      graduationYear: "" as const,
      checkedInAt: submission.submitted_at,
      method:
        submission.added_by === null ? WAITING_CHECK_IN_METHOD : WAITING_MANUAL_CHECK_IN_METHOD,
      points: 0,
    })),
  ];

  return toCsv(rows, [
    { header: "Member name", value: (r) => r.name },
    { header: "Email", value: (r) => r.email },
    { header: "Major", value: (r) => r.major },
    { header: "Graduation year", value: (r) => r.graduationYear },
    { header: "Event", value: () => event.title },
    { header: "Category", value: () => event.category?.name ?? "" },
    { header: "Checked in at", value: (r) => formatDateTime(r.checkedInAt) },
    { header: "Check-in method", value: (r) => r.method },
    { header: "Points awarded", value: (r) => r.points },
  ]);
}

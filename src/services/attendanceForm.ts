import { getSupabase } from "@/lib/supabase";
import { absoluteAppUrl } from "@/lib/config";
import type { AttendanceFormValues } from "@/lib/validation";
import type {
  AddAttendanceSubmissionResult,
  AttendanceFormResponse,
  AttendanceLinkStatus,
  AttendanceSubmitErrorCode,
  AttendanceSubmitResult,
  CheckInResult,
  EventAttendanceSubmissionRow,
} from "@/types/database";

/**
 * The attendance form: check in to an event with a name and an email, no
 * account needed.
 *
 * Thin wrappers over RPCs, like every other service. The rules live in the
 * database (20260918000002_attendance_form.sql): the link's token is the only
 * way to reach an event's form, responses are accepted only during the
 * check-in window, a response whose email belongs to an account is checked in
 * to that member, and the rest wait for an account to be created with that
 * email. None of that is enforced here.
 */

/** Route of the public form for a link token. */
export function attendanceFormPath(token: string): string {
  return `/attend/${token}`;
}

/** Absolute URL of the form, for copying and for the QR code. */
export function attendanceFormUrl(token: string): string {
  return absoluteAppUrl(attendanceFormPath(token));
}

/** The shape the database issues tokens in. Anything else can't be a link. */
export function isAttendanceToken(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

/* ── Public form ─────────────────────────────────────────────────────────── */

export async function fetchAttendanceForm(token: string): Promise<AttendanceFormResponse> {
  const { data, error } = await getSupabase().rpc("get_attendance_form", { p_token: token });
  if (error) throw error;
  return data as AttendanceFormResponse;
}

export async function submitAttendance(
  token: string,
  values: AttendanceFormValues,
): Promise<AttendanceSubmitResult> {
  const { data, error } = await getSupabase().rpc("submit_event_attendance", {
    p_token: token,
    p_first_name: values.first_name,
    p_last_name: values.last_name,
    p_email: values.email,
  });
  if (error) throw error;
  return data as AttendanceSubmitResult;
}

/**
 * Message for each way the form can turn a response away.
 *
 * Kept beside the type so a new code from the database shows up as a
 * TypeScript error here rather than as a blank alert at the door.
 */
export const ATTENDANCE_SUBMIT_MESSAGES: Record<
  AttendanceSubmitErrorCode,
  { title: string; detail?: string }
> = {
  FORM_NOT_FOUND: {
    title: "This attendance link doesn't work",
    detail:
      "It may have been replaced with a new one, or copied incompletely. Ask an officer for the current link or QR code.",
  },
  FORM_NOT_OPEN: {
    title: "Attendance isn't open yet",
    detail: "Try again closer to the start of the event.",
  },
  FORM_CLOSED: {
    title: "Attendance for this event has closed",
    detail: "If you were there, ask an officer to add you.",
  },
  EVENT_CANCELLED: {
    title: "This event was cancelled",
  },
  FORM_FULL: {
    title: "This form isn't taking more responses",
    detail: "Ask an officer to check you in.",
  },
};

/* ── Officer controls ────────────────────────────────────────────────────── */

/** The event's current link, if it has one. Officers only. */
export async function fetchAttendanceLink(eventId: string): Promise<AttendanceLinkStatus> {
  const { data, error } = await getSupabase().rpc("admin_attendance_link", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data as AttendanceLinkStatus;
}

/**
 * Makes the event's link if it has none. Never replaces one: if another
 * officer made a link first, that link comes back with created: false, so a
 * second "Create" can't kill a QR code already on a screen.
 */
export async function createAttendanceLink(eventId: string): Promise<AttendanceLinkStatus> {
  const { data, error } = await getSupabase().rpc("admin_create_attendance_link", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data as AttendanceLinkStatus;
}

/**
 * Replaces the event's link. Immediate: the old link and every QR code printed
 * from it stop working, and the new link can take responses again even if the
 * old one had been flooded.
 */
export async function rotateAttendanceLink(eventId: string): Promise<AttendanceLinkStatus> {
  const { data, error } = await getSupabase().rpc("admin_rotate_attendance_link", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data as AttendanceLinkStatus;
}

export type WaitingSubmission = Pick<
  EventAttendanceSubmissionRow,
  "id" | "event_id" | "first_name" | "last_name" | "email" | "added_by" | "submitted_at"
>;

/** Responses to this event still waiting for an account, oldest first. */
export async function fetchWaitingSubmissions(eventId: string): Promise<WaitingSubmission[]> {
  const { data, error } = await getSupabase()
    .from("event_attendance_submissions")
    .select("id, event_id, first_name, last_name, email, added_by, submitted_at")
    .eq("event_id", eventId)
    .is("member_id", null)
    .order("submitted_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as WaitingSubmission[];
}

/**
 * Puts a waiting response on a member's record, for someone who used a
 * different address on the form than on their account. Checks them in exactly
 * as a matching address would have, points included.
 */
export async function linkAttendanceSubmission(
  submissionId: string,
  memberId: string,
): Promise<CheckInResult> {
  const { data, error } = await getSupabase().rpc("admin_link_attendance_submission", {
    p_submission_id: submissionId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return data as CheckInResult;
}

/**
 * Records someone by name and email, for when the form can't: no phone, after
 * the window, or the link was down. Add attendee only reaches people with an
 * account; this reaches everyone. Matches an account now if one has the
 * address, and otherwise waits like a form response.
 */
export async function addAttendanceSubmission(
  eventId: string,
  values: AttendanceFormValues,
): Promise<AddAttendanceSubmissionResult> {
  const { data, error } = await getSupabase().rpc("admin_add_attendance_submission", {
    p_event_id: eventId,
    p_first_name: values.first_name,
    p_last_name: values.last_name,
    p_email: values.email,
  });
  if (error) throw error;
  return data as AddAttendanceSubmissionResult;
}

/**
 * Deletes, in one audited step, the waiting responses that came through the
 * form before `before` -- in practice, the moment a leaked link was replaced.
 * Responses officers typed in, and anything on someone's record, are kept.
 */
export async function deleteWaitingSubmissionsBefore(
  eventId: string,
  before: string,
): Promise<number> {
  const { data, error } = await getSupabase().rpc("admin_delete_waiting_submissions", {
    p_event_id: eventId,
    p_submitted_before: before,
  });
  if (error) throw error;
  return (data as { deleted: number }).deleted;
}

/** Deletes a waiting response, e.g. spam. Recorded in the audit log. */
export async function deleteAttendanceSubmission(submissionId: string): Promise<void> {
  const { error } = await getSupabase().rpc("admin_delete_attendance_submission", {
    p_submission_id: submissionId,
  });
  if (error) throw error;
}

import { getSupabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import type { AdminAnalytics, AuditLogRow, CheckInResult } from "@/types/database";

/* ── Check-in codes ──────────────────────────────────────────────────────── */

/**
 * Returns the plaintext code once. Nothing stores it afterwards, and no other
 * query can read it back — rotating again is the only way to get a new one.
 */
export async function rotateEventCode(eventId: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("admin_rotate_event_code", {
    p_event_id: eventId,
  });
  if (error) throw error;
  const result = data as { ok: boolean; code: string };
  return result.code;
}

export interface EventCodeStatus {
  has_code: boolean;
  updated_at: string | null;
  rotated_by: string | null;
}

export async function fetchEventCodeStatus(eventId: string): Promise<EventCodeStatus> {
  const { data, error } = await getSupabase().rpc("admin_event_code_status", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data as EventCodeStatus;
}

/* ── Attendance corrections ──────────────────────────────────────────────── */

export async function addAttendance(
  eventId: string,
  memberId: string,
): Promise<CheckInResult> {
  const { data, error } = await getSupabase().rpc("admin_add_attendance", {
    p_event_id: eventId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return data as CheckInResult;
}

/**
 * Removing attendance also posts a compensating point transaction, so the
 * member's total is correct immediately and the original award stays visible in
 * the ledger. The reason is required and lands in the audit log.
 */
export async function removeAttendance(
  attendanceId: string,
  reason: string,
): Promise<{ reversed_points: number }> {
  const { data, error } = await getSupabase().rpc("admin_remove_attendance", {
    p_attendance_id: attendanceId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { reversed_points: number };
}

/* ── Password reset links ────────────────────────────────────────────────── */

/**
 * Netlify serves functions from the site root whatever Vite's base path is, so
 * this is deliberately not built with BASE_PATH.
 */
export const PASSWORD_RESET_LINK_ENDPOINT = "/.netlify/functions/admin-password-reset-link";

export interface PasswordResetLink {
  /** /reset-password?token_hash=...&type=recovery on this site. Single use. */
  link: string;
  /** The address the member signs in with, which the link resets. */
  email: string;
  display_name: string;
}

/**
 * Creates a single-use password reset link for a member, for an admin to pass
 * on by hand when the reset email isn't getting through.
 *
 * This is the one admin action that is not an RPC: creating the link needs the
 * service role key, so it runs in a Netlify function
 * (netlify/functions/admin-password-reset-link.ts). The function checks the
 * caller is an admin with the caller's own session, through
 * admin_password_reset_target(), and logs the link to the audit log before
 * returning it. Nothing about who may do this is decided here.
 *
 * The link is returned once and never stored. Making another one cancels this
 * one, because Supabase keeps a single recovery token per account.
 */
export async function createPasswordResetLink(memberId: string): Promise<PasswordResetLink> {
  const { data } = await getSupabase().auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw Object.assign(new Error("Your session expired"), { code: "PGRST301" });
  }

  const response = await fetch(PASSWORD_RESET_LINK_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ memberId }),
  });

  // Anything but JSON means the function isn't there at all: `npm run dev`
  // and a static host both answer with the app's index.html or a bare 404.
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) {
    throw new UserFacingError(
      "Password reset links aren't available here",
      "They need the site's Netlify function, which only runs on the deployed site.",
    );
  }

  const body = (await response.json()) as
    | PasswordResetLink
    | { code?: string; message?: string };

  if (!response.ok || !("link" in body)) {
    const failure = body as { code?: string; message?: string };
    // Permission and session failures carry the codes describeError already
    // knows. Everything else comes with a message written for the admin.
    if (failure.code === "42501" || failure.code === "PGRST301") {
      throw Object.assign(new Error(failure.message ?? ""), { code: failure.code });
    }
    throw new UserFacingError(failure.message || "We couldn't create a reset link");
  }

  return body;
}

/* ── Point adjustments ───────────────────────────────────────────────────── */

export async function adjustPoints(input: {
  memberId: string;
  amount: number;
  reason: string;
  termId?: string | null;
}): Promise<{ previous_total: number; new_total: number }> {
  const { data, error } = await getSupabase().rpc("admin_adjust_points", {
    p_member_id: input.memberId,
    p_amount: input.amount,
    p_reason: input.reason,
    p_term_id: input.termId ?? null,
  });
  if (error) throw error;
  return data as { previous_total: number; new_total: number };
}

/* ── Analytics ───────────────────────────────────────────────────────────── */

export async function fetchAnalytics(termId: string | null): Promise<AdminAnalytics> {
  const { data, error } = await getSupabase().rpc("admin_analytics", { p_term_id: termId });
  if (error) throw error;
  return data as AdminAnalytics;
}

/* ── Audit log ───────────────────────────────────────────────────────────── */

export interface AuditEntry extends AuditLogRow {
  actor: { id: string; first_name: string; last_name: string; email: string } | null;
}

export async function fetchAuditLog(filters: {
  action?: string | null;
  limit?: number;
}): Promise<AuditEntry[]> {
  let query = getSupabase()
    .from("admin_audit_log")
    .select("*, actor:profiles(id, first_name, last_name, email)")
    .order("created_at", { ascending: false });

  if (filters.action) query = query.eq("action", filters.action);

  const { data, error } = await query.limit(filters.limit ?? 200);
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}

/* ── Recent attendance across all events (admin overview) ────────────────── */

export interface RecentAttendanceRow {
  id: string;
  checked_in_at: string;
  check_in_method: string;
  member: { id: string; first_name: string; last_name: string; email: string } | null;
  event: { id: string; title: string; points_value: number } | null;
}

/**
 * Same ambiguity as EVENT_ATTENDANCE_SELECT: event_attendance has two foreign
 * keys to profiles, so the embed has to name one or PostgREST rejects the whole
 * request with PGRST201. The points ledger further down already disambiguated
 * for exactly this reason -- it had been hit once and fixed in one place.
 */
export const RECENT_ATTENDANCE_SELECT =
  "id, checked_in_at, check_in_method, " +
  "member:profiles!event_attendance_member_id_fkey(id, first_name, last_name, email), " +
  "event:events(id, title, points_value)";

export async function fetchRecentAttendance(limit = 50): Promise<RecentAttendanceRow[]> {
  const { data, error } = await getSupabase()
    .from("event_attendance")
    .select(RECENT_ATTENDANCE_SELECT)
    .order("checked_in_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as RecentAttendanceRow[];
}

/**
 * Human-readable audit actions. Falls back to the raw key so a newly added
 * action still renders something rather than a blank cell.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "event.created": "Event created",
  "event.status_changed": "Event status changed",
  "event.points_changed": "Event points changed",
  "event.points_reawarded": "Attendees' points moved to the new value",
  "event.deleted": "Event deleted",
  "event.code_generated": "Check-in code generated",
  "event.code_rotated": "Check-in code rotated",
  "event.attendance_link_created": "Attendance form link created",
  "event.attendance_link_rotated": "Attendance form link replaced",
  "attendance.added": "Attendance added manually",
  "attendance.removed": "Attendance removed",
  "attendance.claimed": "Form attendance matched to an account",
  "attendance.submission_added": "Attendee added by name and email",
  "attendance.submission_linked": "Form response linked to a member",
  "attendance.submission_deleted": "Form response deleted",
  "attendance.submissions_deleted": "Form responses from a replaced link deleted",
  "points.adjusted": "Points adjusted",
  "role.granted": "Role granted",
  "role.revoked": "Role revoked",
  "membership.status_changed": "Membership status changed",
  "membership.national_status_changed": "National membership updated",
  "membership.join_code_redeemed": "Joined with the chapter code",
  "member.deleted": "Member deleted",
  "member.password_reset_link_created": "Password reset link created",
  "settings.changed": "Chapter setting changed",
  "join_code.set": "Join code changed",
  "join_code.enabled": "Join code turned on",
  "join_code.disabled": "Join code turned off",
  "join_code.auto_disabled": "Join code turned off automatically",
  "leaderboard.enabled": "Leaderboard turned on",
  "leaderboard.disabled": "Leaderboard turned off",
  "leaderboard.refreshed": "Leaderboard refreshed",
  "card.created": "Business card created",
  "card.bulk_created": "Business cards created in bulk",
  "card.chips_written": "NFC chips marked written",
  "card.hidden": "Business card hidden",
  "card.unhidden": "Business card unhidden",
  "card.published": "Business card published by an officer",
  "card.unpublished": "Business card unpublished by an officer",
  "card.handle_reset": "Card handle reset",
  "card.handle_released": "Card handle released",
  "card.position_set": "Chapter position set",
  "card.position_cleared": "Chapter position cleared",
  "cards.enabled": "Business cards turned on",
  "cards.disabled": "Business cards turned off",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/* ── Chapter-wide points (officer view) ──────────────────────────────────── */

export interface MemberPointsRow {
  member_id: string;
  total_points: number;
  transaction_count: number;
  first_name: string;
  last_name: string;
  email: string;
  graduation_year: number | null;
  membership_status: string;
}

/**
 * Totals per member for a period.
 *
 * Reads the member_point_totals view, which is declared `security_invoker`, so
 * an officer sees every member and a member would see only themselves — the
 * same query is safe for both. The profile join is done here rather than as a
 * PostgREST embed because relationship inference through a view is not
 * something to depend on.
 */
export async function fetchMemberPointTotals(
  termId: string | null,
): Promise<MemberPointsRow[]> {
  const supabase = getSupabase();

  let totalsQuery = supabase
    .from("member_point_totals")
    .select("member_id, total_points, transaction_count");
  totalsQuery = termId
    ? totalsQuery.eq("academic_term_id", termId)
    : totalsQuery;

  const { data: totals, error } = await totalsQuery;
  if (error) throw error;

  const rows = (totals ?? []) as {
    member_id: string;
    total_points: number;
    transaction_count: number;
  }[];

  // Sum across terms when no term filter is applied: the view is grouped by
  // (member, term), so "all time" needs one more fold.
  const merged = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const current = merged.get(row.member_id) ?? { total: 0, count: 0 };
    current.total += row.total_points ?? 0;
    current.count += row.transaction_count ?? 0;
    merged.set(row.member_id, current);
  }

  if (merged.size === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, graduation_year, membership_status")
    .in("id", Array.from(merged.keys()));
  if (profileError) throw profileError;

  return ((profiles ?? []) as {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    graduation_year: number | null;
    membership_status: string;
  }[])
    .map((profile) => {
      const totalsForMember = merged.get(profile.id) ?? { total: 0, count: 0 };
      return {
        member_id: profile.id,
        total_points: totalsForMember.total,
        transaction_count: totalsForMember.count,
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        graduation_year: profile.graduation_year,
        membership_status: profile.membership_status,
      };
    })
    .sort((a, b) => b.total_points - a.total_points);
}

export interface LedgerExportRow {
  id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  created_at: string;
  member: { first_name: string; last_name: string; email: string } | null;
  event: { title: string } | null;
  created_by_profile: { first_name: string; last_name: string } | null;
}

/** Full point ledger for a period, for CSV export and spot checks. */
export async function fetchLedger(termId: string | null): Promise<LedgerExportRow[]> {
  let query = getSupabase()
    .from("point_transactions")
    .select(
      "id, amount, transaction_type, description, created_at, " +
        "member:profiles!point_transactions_member_id_fkey(first_name, last_name, email), " +
        "event:events(title), " +
        "created_by_profile:profiles!point_transactions_created_by_fkey(first_name, last_name)",
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (termId) query = query.eq("academic_term_id", termId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as LedgerExportRow[];
}

/**
 * Deletes check-in attempt rows older than `days`.
 *
 * The migration that added retention also tries to schedule this via pg_cron,
 * but that extension is not enabled on a default Supabase project — verified
 * against production, where `select count(*) from pg_extension where
 * extname='pg_cron'` returns 0. The guarded `do $$ ... end $$` block therefore
 * produced a silent no-op on exactly the configuration the chapter runs, which
 * left an attacker-influenced table growing without bound on a 500 MB database.
 *
 * Exposing it to officers makes the fallback real rather than nominal.
 */
export async function pruneCheckinAttempts(days = 90): Promise<number> {
  const { data, error } = await getSupabase().rpc("admin_prune_checkin_attempts", {
    p_days: days,
  });
  if (error) throw error;
  return (data as { rows_deleted?: number } | null)?.rows_deleted ?? 0;
}

/** Rows currently in the check-in attempt log, so officers can see it draining. */
export async function fetchCheckinAttemptCount(): Promise<number> {
  const { count, error } = await getSupabase()
    .from("checkin_attempts")
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

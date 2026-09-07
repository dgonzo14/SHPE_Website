import { getSupabase } from "@/lib/supabase";
import type {
  CheckInResult,
  MemberDashboard,
  PointsSummary,
  PointTransactionType,
} from "@/types/database";

/**
 * How a points/history view is scoped. "Academic year" spans several terms, so
 * it is resolved server-side (public.term_ids_for_scope) rather than by the
 * client guessing which terms belong to which year.
 */
export type PointsScope =
  | { kind: "term"; termId: string }
  | { kind: "academicYear"; academicYear: string }
  | { kind: "allTime" };

export function scopeKey(scope: PointsScope): string {
  if (scope.kind === "term") return `term:${scope.termId}`;
  if (scope.kind === "academicYear") return `year:${scope.academicYear}`;
  return "all";
}

function scopeArgs(scope: PointsScope) {
  return {
    p_term_id: scope.kind === "term" ? scope.termId : null,
    p_academic_year: scope.kind === "academicYear" ? scope.academicYear : null,
  };
}

/* ── Check-in ────────────────────────────────────────────────────────────── */

/**
 * Code-only check-in: the member types the code shown at the event and the
 * database works out which event it belongs to. Attendance and the point award
 * happen inside this one call, so they succeed or fail together.
 */
export async function checkInWithCode(code: string): Promise<CheckInResult> {
  const { data, error } = await getSupabase().rpc("check_in_with_code", { p_code: code });
  if (error) throw error;
  return data as CheckInResult;
}

/** Check-in from an event's own page, where the event is already known. */
export async function checkInToEvent(eventId: string, code: string): Promise<CheckInResult> {
  const { data, error } = await getSupabase().rpc("check_in_to_event", {
    p_event_id: eventId,
    p_code: code,
  });
  if (error) throw error;
  return data as CheckInResult;
}

/* ── Reads ───────────────────────────────────────────────────────────────── */

export async function fetchDashboard(termId: string | null): Promise<MemberDashboard> {
  const { data, error } = await getSupabase().rpc("get_member_dashboard", {
    p_term_id: termId,
  });
  if (error) throw error;
  return data as MemberDashboard;
}

export async function fetchPointsSummary(
  memberId: string | null,
  scope: PointsScope,
): Promise<PointsSummary> {
  const { data, error } = await getSupabase().rpc("get_member_points_summary", {
    p_member_id: memberId,
    ...scopeArgs(scope),
  });
  if (error) throw error;
  return data as PointsSummary;
}

export interface PointTransactionEntry {
  id: string;
  amount: number;
  transaction_type: PointTransactionType;
  description: string | null;
  created_at: string;
  academic_term_id: string | null;
  event: {
    id: string;
    title: string;
    start_at: string;
    category: { name: string } | null;
  } | null;
}

export async function fetchPointTransactions(
  memberId: string,
  scope: PointsScope,
): Promise<PointTransactionEntry[]> {
  let query = getSupabase()
    .from("point_transactions")
    .select(
      "id, amount, transaction_type, description, created_at, academic_term_id, " +
        "event:events(id, title, start_at, category:event_categories(name))",
    )
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (scope.kind === "term") {
    query = query.eq("academic_term_id", scope.termId);
  } else if (scope.kind === "academicYear") {
    const termIds = await fetchTermIdsForAcademicYear(scope.academicYear);
    // An empty list must mean "nothing", not "everything" — .in([]) would
    // return no rows, which is the correct reading.
    query = query.in("academic_term_id", termIds);
  }

  const { data, error } = await query.limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as PointTransactionEntry[];
}

export interface AttendanceHistoryEntry {
  id: string;
  checked_in_at: string;
  check_in_method: string;
  event: {
    id: string;
    title: string;
    slug: string;
    start_at: string;
    location: string | null;
    points_value: number;
    academic_term_id: string | null;
    category: { name: string } | null;
  } | null;
}

export async function fetchAttendanceHistory(
  memberId: string,
  scope: PointsScope,
): Promise<AttendanceHistoryEntry[]> {
  const { data, error } = await getSupabase()
    .from("event_attendance")
    .select(
      "id, checked_in_at, check_in_method, " +
        "event:events(id, title, slug, start_at, location, points_value, academic_term_id, " +
        "category:event_categories(name))",
    )
    .eq("member_id", memberId)
    .order("checked_in_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = (data ?? []) as unknown as AttendanceHistoryEntry[];

  // The term lives on the joined event, so filtering happens here rather than
  // as a nested filter that PostgREST would apply to the embed instead of the
  // parent row.
  if (scope.kind === "term") {
    return rows.filter((r) => r.event?.academic_term_id === scope.termId);
  }
  if (scope.kind === "academicYear") {
    const termIds = new Set(await fetchTermIdsForAcademicYear(scope.academicYear));
    return rows.filter((r) => r.event && termIds.has(r.event.academic_term_id ?? ""));
  }
  return rows;
}

async function fetchTermIdsForAcademicYear(academicYear: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("academic_terms")
    .select("id")
    .eq("academic_year", academicYear)
    .neq("term_type", "academic_year");
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((t) => t.id);
}

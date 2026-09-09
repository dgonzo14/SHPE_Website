import { getSupabase } from "@/lib/supabase";
import type {
  AppRole,
  MembershipStatus,
  NationalMemberStatus,
  ProfileRow,
  ProfileSelfUpdate,
} from "@/types/database";

/* ── Own profile ─────────────────────────────────────────────────────────── */

export async function fetchProfile(memberId: string): Promise<ProfileRow | null> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

/**
 * Members edit only the fields in ProfileSelfUpdate. Even if this call were
 * tampered with, public.profiles_guard_protected_columns() restores
 * membership_status, email, member_since and verified National status before
 * the row is written — the type here documents the rule, the trigger enforces it.
 */
export async function updateOwnProfile(
  memberId: string,
  payload: ProfileSelfUpdate,
): Promise<ProfileRow> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .update(payload)
    .eq("id", memberId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ProfileRow;
}

export async function fetchRoles(memberId: string): Promise<AppRole[]> {
  const { data, error } = await getSupabase()
    .from("member_roles")
    .select("role")
    .eq("member_id", memberId);
  if (error) throw error;
  return ((data ?? []) as { role: AppRole }[]).map((r) => r.role);
}

/* ── Officer roster ──────────────────────────────────────────────────────── */

export interface MemberListFilters {
  search?: string;
  status?: MembershipStatus | "all";
  graduationYear?: number | null;
  role?: AppRole | "all";
}

export interface MemberListRow extends ProfileRow {
  roles: AppRole[];
}

/**
 * Makes a value safe to embed in a PostgREST filter expression.
 *
 * Exported so it is covered by tests: the failure it prevents is silent. An
 * unsanitised comma does not error, it just quietly widens the result set,
 * which is exactly the kind of bug that survives review.
 */
export function sanitiseFilterValue(value: string): string {
  return value.trim().replace(/["\\]/g, "");
}

/**
 * Roles are fetched in one extra query and stitched in, rather than one query
 * per member. With a few hundred members that is two round trips instead of
 * a few hundred.
 */
export async function fetchMembers(filters: MemberListFilters = {}): Promise<MemberListRow[]> {
  const { search, status = "all", graduationYear = null, role = "all" } = filters;

  let query = getSupabase().from("profiles").select("*").order("last_name", { ascending: true });

  if (status !== "all") query = query.eq("membership_status", status);
  if (graduationYear) query = query.eq("graduation_year", graduationYear);
  if (search && search.trim()) {
    /*
     * .or() takes a raw PostgREST filter expression, not a bound parameter, so
     * a comma in the search term starts a new condition rather than being
     * matched literally. Searching `zzz,first_name.not.is.null` returned every
     * member instead of none.
     *
     * Double quotes make the value literal; stripping quotes and backslashes
     * closes the way back out of that quoting. Row level security still bounds
     * what can come back either way -- this is about the query meaning what the
     * caller typed, and about not carrying the pattern to a table whose
     * policies are laxer.
     */
    const term = `"%${sanitiseFilterValue(search)}%"`;
    query = query.or(
      `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},major.ilike.${term}`,
    );
  }

  const { data, error } = await query.limit(1000);
  if (error) throw error;

  const profiles = (data ?? []) as ProfileRow[];
  if (profiles.length === 0) return [];

  const { data: roleRows, error: roleError } = await getSupabase()
    .from("member_roles")
    .select("member_id, role")
    .in(
      "member_id",
      profiles.map((p) => p.id),
    );
  if (roleError) throw roleError;

  const byMember = new Map<string, AppRole[]>();
  for (const row of (roleRows ?? []) as { member_id: string; role: AppRole }[]) {
    const list = byMember.get(row.member_id) ?? [];
    list.push(row.role);
    byMember.set(row.member_id, list);
  }

  const withRoles = profiles.map((p) => ({ ...p, roles: byMember.get(p.id) ?? [] }));
  return role === "all" ? withRoles : withRoles.filter((m) => m.roles.includes(role));
}

/* ── Officer/admin mutations (all audited server-side) ───────────────────── */

export async function setMemberRole(
  memberId: string,
  role: AppRole,
  granted: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_role", {
    p_member_id: memberId,
    p_role: role,
    p_granted: granted,
  });
  if (error) throw error;
}

export async function setMembershipStatus(
  memberId: string,
  status: MembershipStatus,
  reason?: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_membership_status", {
    p_member_id: memberId,
    p_status: status,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function setNationalStatus(
  memberId: string,
  status: NationalMemberStatus,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_national_status", {
    p_member_id: memberId,
    p_status: status,
  });
  if (error) throw error;
}

export interface DeleteMemberResult {
  ok: boolean;
  member_id: string;
  email: string;
  /** Counted before the delete; the rows themselves no longer exist. */
  attendance_removed: number;
  point_transactions_removed: number;
  net_points_removed: number;
}

/**
 * Permanently removes a member and everything that cascades from their profile.
 *
 * There is no undo and no soft-delete fallback: use setMembershipStatus for
 * someone who has left the chapter, where their attendance and points should
 * outlive their membership. This is for duplicates, typos and junk signups.
 *
 * Admin only, and not because of this function -- admin_delete_member() calls
 * require_admin() before it does anything, refuses to delete the caller, and
 * refuses to remove the last administrator. An officer who calls this directly
 * gets 42501.
 */
export async function deleteMember(
  memberId: string,
  reason?: string,
): Promise<DeleteMemberResult> {
  const { data, error } = await getSupabase().rpc("admin_delete_member", {
    p_member_id: memberId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as DeleteMemberResult;
}

export function memberName(profile: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return name || profile.email || "Unnamed member";
}

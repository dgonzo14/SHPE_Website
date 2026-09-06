import { getSupabase } from "@/lib/supabase";
import type {
  EventCategoryRow,
  EventRow,
  EventStatus,
  ProfileRow,
} from "@/types/database";

/** An event joined with its category name — what every list and card renders. */
export interface EventWithCategory extends EventRow {
  category: Pick<EventCategoryRow, "id" | "name" | "slug" | "color"> | null;
}

const EVENT_SELECT =
  "*, category:event_categories(id, name, slug, color)";

export interface EventListFilters {
  /** "upcoming" uses end_at so an event in progress still counts as upcoming. */
  timeframe?: "upcoming" | "past" | "all";
  categoryId?: string | null;
  termId?: string | null;
  statuses?: EventStatus[];
  search?: string | null;
  limit?: number;
}

export async function fetchEvents(filters: EventListFilters = {}): Promise<EventWithCategory[]> {
  const {
    timeframe = "upcoming",
    categoryId = null,
    termId = null,
    statuses,
    search = null,
    limit = 200,
  } = filters;

  let query = getSupabase().from("events").select(EVENT_SELECT);

  // Drafts are invisible to members at the database level too; this keeps the
  // officer-facing lists explicit about what they are asking for.
  if (statuses && statuses.length > 0) {
    query = query.in("status", statuses);
  }

  const nowIso = new Date().toISOString();
  if (timeframe === "upcoming") {
    query = query.gte("end_at", nowIso).order("start_at", { ascending: true });
  } else if (timeframe === "past") {
    query = query.lt("end_at", nowIso).order("start_at", { ascending: false });
  } else {
    query = query.order("start_at", { ascending: false });
  }

  if (categoryId) query = query.eq("category_id", categoryId);
  if (termId) query = query.eq("academic_term_id", termId);
  if (search) query = query.ilike("title", `%${search}%`);

  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return (data ?? []) as EventWithCategory[];
}

export async function fetchEvent(eventId: string): Promise<EventWithCategory | null> {
  const { data, error } = await getSupabase()
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as EventWithCategory | null) ?? null;
}

export async function fetchEventCategories(): Promise<EventCategoryRow[]> {
  const { data, error } = await getSupabase()
    .from("event_categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventCategoryRow[];
}

/**
 * The signed-in member's own attendance across a set of events, used to badge
 * "Attended" on cards. RLS already limits this to their own rows.
 */
export async function fetchMyAttendedEventIds(eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const { data, error } = await getSupabase()
    .from("event_attendance")
    .select("event_id")
    .in("event_id", eventIds);
  if (error) throw error;
  return new Set(((data ?? []) as { event_id: string }[]).map((r) => r.event_id));
}

/* ── Officer writes ──────────────────────────────────────────────────────── */

export type EventWritePayload = {
  title: string;
  description: string | null;
  category_id: string;
  start_at: string;
  end_at: string;
  check_in_opens_at: string | null;
  check_in_closes_at: string | null;
  location: string | null;
  points_value: number;
  capacity: number | null;
  status: EventStatus;
  organizer_name: string | null;
  organizer_email: string | null;
  image_url: string | null;
};

export async function createEvent(
  payload: EventWritePayload,
  createdBy: string,
): Promise<EventRow> {
  const { data, error } = await getSupabase()
    .from("events")
    .insert({ ...payload, created_by: createdBy })
    .select("*")
    .single();
  if (error) throw error;
  return data as EventRow;
}

export async function updateEvent(
  eventId: string,
  payload: Partial<EventWritePayload>,
): Promise<EventRow> {
  const { data, error } = await getSupabase()
    .from("events")
    .update(payload)
    .eq("id", eventId)
    .select("*")
    .single();
  if (error) throw error;
  return data as EventRow;
}

/**
 * Status changes are ordinary updates, but they are the ones officers reach for
 * most, so they get named helpers rather than magic strings at call sites.
 */
export async function setEventStatus(eventId: string, status: EventStatus): Promise<EventRow> {
  return updateEvent(eventId, { status });
}

/**
 * Only draft events can be deleted, and only by an admin — the RLS policy and
 * the ON DELETE RESTRICT foreign keys both enforce that. Anything a member
 * could have attended is cancelled instead.
 */
export async function deleteDraftEvent(eventId: string): Promise<void> {
  const { error } = await getSupabase().from("events").delete().eq("id", eventId);
  if (error) throw error;
}

/* ── Attendance for one event (officer view) ─────────────────────────────── */

export interface EventAttendee {
  id: string;
  member_id: string;
  checked_in_at: string;
  check_in_method: string;
  verified_by: string | null;
  member: Pick<
    ProfileRow,
    "id" | "first_name" | "last_name" | "email" | "graduation_year" | "major"
  > | null;
}

export async function fetchEventAttendance(eventId: string): Promise<EventAttendee[]> {
  const { data, error } = await getSupabase()
    .from("event_attendance")
    .select(
      "id, member_id, checked_in_at, check_in_method, verified_by, " +
        "member:profiles(id, first_name, last_name, email, graduation_year, major)",
    )
    .eq("event_id", eventId)
    .order("checked_in_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as EventAttendee[];
}

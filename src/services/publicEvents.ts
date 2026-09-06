import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { EventStatus } from "@/types/database";

/**
 * The chapter calendar as anyone can see it — no sign-in required.
 *
 * The column list below is not a convenience: `anon` holds a column-level GRANT
 * covering exactly these fields, so `select("*")` would be rejected outright.
 * Naming them keeps the client honest about what the public surface is, and
 * means adding a sensitive column to `events` cannot silently publish it.
 */
const PUBLIC_EVENT_COLUMNS =
  "id, title, slug, description, start_at, end_at, location, points_value, status, image_url, " +
  "category:event_categories(name, slug, color)";

export interface PublicEvent {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  start_at: string;
  end_at: string;
  location: string | null;
  points_value: number;
  status: EventStatus;
  image_url: string | null;
  category: { name: string; slug: string; color: string | null } | null;
}

/**
 * Events overlapping a window. Returns an empty list rather than throwing when
 * the deployment has no Supabase credentials — the public site has to keep
 * working in that case, and an empty calendar is a better failure than a
 * blank page.
 */
export async function fetchPublicEvents(range: {
  from: string;
  to: string;
}): Promise<PublicEvent[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await getSupabase()
    .from("events")
    .select(PUBLIC_EVENT_COLUMNS)
    // Overlap, not containment: a multi-day event that starts before the window
    // still belongs on the calendar.
    .lte("start_at", range.to)
    .gte("end_at", range.from)
    .neq("status", "draft")
    .order("start_at", { ascending: true })
    .limit(300);

  if (error) throw error;
  return (data ?? []) as unknown as PublicEvent[];
}

/** The next few events, for a compact "what's coming up" list. */
export async function fetchUpcomingPublicEvents(limit = 5): Promise<PublicEvent[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await getSupabase()
    .from("events")
    .select(PUBLIC_EVENT_COLUMNS)
    .gte("end_at", new Date().toISOString())
    .eq("status", "published")
    .order("start_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as PublicEvent[];
}

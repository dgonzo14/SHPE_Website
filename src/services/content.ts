import { getSupabase } from "@/lib/supabase";
import type {
  AcademicTermRow,
  AnnouncementPriority,
  AnnouncementRow,
  AppConfig,
  ResourceRow,
  ResourceVisibility,
} from "@/types/database";

/* ── Academic terms ──────────────────────────────────────────────────────── */

export async function fetchTerms(): Promise<AcademicTermRow[]> {
  const { data, error } = await getSupabase()
    .from("academic_terms")
    .select("*")
    .neq("term_type", "academic_year")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AcademicTermRow[];
}

export function activeTerm(terms: AcademicTermRow[]): AcademicTermRow | null {
  return terms.find((t) => t.is_active) ?? terms[0] ?? null;
}

/** Distinct academic years, newest first — powers the "Academic year" scope. */
export function academicYears(terms: AcademicTermRow[]): string[] {
  return Array.from(new Set(terms.map((t) => t.academic_year)));
}

/* ── Chapter configuration ───────────────────────────────────────────────── */

export async function fetchAppConfig(): Promise<AppConfig> {
  const { data, error } = await getSupabase().rpc("get_app_config");
  if (error) throw error;
  return (data ?? {}) as AppConfig;
}

/* ── Announcements ───────────────────────────────────────────────────────── */

/**
 * Members see live announcements only. Expiry is also enforced by the RLS
 * policy, so an expired announcement is unreachable even if this filter were
 * dropped — the query and the policy agree rather than one covering for the
 * other.
 */
export async function fetchActiveAnnouncements(): Promise<AnnouncementRow[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("announcements")
    .select("*")
    .eq("is_archived", false)
    .not("published_at", "is", null)
    .lte("published_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("published_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AnnouncementRow[];
}

/** Officer view: drafts, scheduled, expired and archived included. */
export async function fetchAllAnnouncements(): Promise<AnnouncementRow[]> {
  const { data, error } = await getSupabase()
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as AnnouncementRow[];
}

export interface AnnouncementWritePayload {
  title: string;
  body: string;
  priority: AnnouncementPriority;
  published_at: string | null;
  expires_at: string | null;
  external_url: string | null;
}

export async function createAnnouncement(
  payload: AnnouncementWritePayload,
  createdBy: string,
): Promise<AnnouncementRow> {
  const { data, error } = await getSupabase()
    .from("announcements")
    .insert({ ...payload, created_by: createdBy })
    .select("*")
    .single();
  if (error) throw error;
  return data as AnnouncementRow;
}

export async function updateAnnouncement(
  id: string,
  payload: Partial<AnnouncementWritePayload> & { is_archived?: boolean },
): Promise<AnnouncementRow> {
  const { data, error } = await getSupabase()
    .from("announcements")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as AnnouncementRow;
}

/* ── Resources ───────────────────────────────────────────────────────────── */

/**
 * Returns what the caller is allowed to see. The visibility filter lives in RLS,
 * so an officer-only resource is not merely hidden from the list — it is not
 * returned at all.
 */
export async function fetchVisibleResources(): Promise<ResourceRow[]> {
  const { data, error } = await getSupabase()
    .from("resources")
    .select("*")
    .eq("is_archived", false)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ResourceRow[];
}

export async function fetchAllResources(): Promise<ResourceRow[]> {
  const { data, error } = await getSupabase()
    .from("resources")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ResourceRow[];
}

export interface ResourceWritePayload {
  title: string;
  description: string | null;
  category: string;
  url: string | null;
  visibility: ResourceVisibility;
  sort_order: number;
}

export async function createResource(
  payload: ResourceWritePayload,
  createdBy: string,
): Promise<ResourceRow> {
  const { data, error } = await getSupabase()
    .from("resources")
    .insert({ ...payload, created_by: createdBy })
    .select("*")
    .single();
  if (error) throw error;
  return data as ResourceRow;
}

export async function updateResource(
  id: string,
  payload: Partial<ResourceWritePayload> & { is_archived?: boolean },
): Promise<ResourceRow> {
  const { data, error } = await getSupabase()
    .from("resources")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as ResourceRow;
}

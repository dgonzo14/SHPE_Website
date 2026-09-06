/**
 * Hand-maintained shape of the `public` schema, mirroring
 * supabase/migrations/*.sql. Keeping it typed means a renamed column breaks the
 * build instead of quietly returning undefined at 7pm during a GBM check-in.
 *
 * If you change a migration, change this file in the same commit.
 */

export type MembershipStatus =
  | "pending"
  | "active"
  | "inactive"
  | "alumni"
  | "suspended";

export type DegreeLevel = "undergraduate" | "masters" | "phd" | "other";

export type NationalMemberStatus = "not_provided" | "self_reported" | "verified";

export type AppRole = "member" | "officer" | "admin";

export type EventStatus = "draft" | "published" | "cancelled" | "completed";

export type TermType = "fall" | "spring" | "summer" | "academic_year";

export type CheckinMethod = "code" | "qr" | "manual" | "import";

export type PointTransactionType =
  | "event_attendance"
  | "bonus"
  | "manual_adjustment"
  | "correction"
  | "migration";

export type AnnouncementPriority = "normal" | "important" | "urgent";

export type ResourceVisibility = "public" | "member" | "officer";

export interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  major: string | null;
  secondary_major: string | null;
  graduation_year: number | null;
  degree_level: DegreeLevel | null;
  shpe_national_member: NationalMemberStatus;
  shpe_national_member_id: string | null;
  linkedin_url: string | null;
  profile_image_url: string | null;
  membership_status: MembershipStatus;
  member_since: string;
  created_at: string;
  updated_at: string;
}

/** Columns a member is allowed to change about themselves. */
export type ProfileSelfUpdate = Partial<
  Pick<
    ProfileRow,
    | "first_name"
    | "last_name"
    | "major"
    | "secondary_major"
    | "graduation_year"
    | "degree_level"
    | "linkedin_url"
    | "shpe_national_member"
    | "shpe_national_member_id"
  >
>;

export interface MemberRoleRow {
  id: string;
  member_id: string;
  role: AppRole;
  granted_by: string | null;
  granted_at: string;
}

export interface AcademicTermRow {
  id: string;
  name: string;
  term_type: TermType;
  start_date: string;
  end_date: string;
  academic_year: string;
  is_active: boolean;
  created_at: string;
}

export interface EventCategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface EventRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  category_id: string | null;
  academic_term_id: string | null;
  start_at: string;
  end_at: string;
  location: string | null;
  points_value: number;
  check_in_opens_at: string | null;
  check_in_closes_at: string | null;
  status: EventStatus;
  /** Whether the event shows on the public website calendar. */
  is_public: boolean;
  capacity: number | null;
  organizer_name: string | null;
  organizer_email: string | null;
  image_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EventInsert = Omit<
  EventRow,
  "id" | "slug" | "created_at" | "updated_at" | "academic_term_id"
> & { slug?: string };

export type EventUpdate = Partial<Omit<EventRow, "id" | "slug" | "created_at" | "updated_at">>;

export interface EventAttendanceRow {
  id: string;
  event_id: string;
  member_id: string;
  check_in_method: CheckinMethod;
  checked_in_at: string;
  verified_by: string | null;
  created_at: string;
}

export interface PointTransactionRow {
  id: string;
  member_id: string;
  event_id: string | null;
  academic_term_id: string | null;
  amount: number;
  transaction_type: PointTransactionType;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  published_at: string | null;
  expires_at: string | null;
  is_archived: boolean;
  external_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  url: string | null;
  file_url: string | null;
  visibility: ResourceVisibility;
  is_archived: boolean;
  published_at: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/* ── RPC payloads ────────────────────────────────────────────────────────── */

/**
 * Every failure mode the check-in RPCs can report. The database returns the
 * code; `lib/errors.ts` turns it into something a member can act on.
 */
export type CheckInErrorCode =
  | "INVALID_CODE"
  | "CHECKIN_NOT_OPEN"
  | "CHECKIN_CLOSED"
  | "EVENT_NOT_FOUND"
  | "EVENT_NOT_PUBLISHED"
  | "EVENT_CANCELLED"
  | "ALREADY_CHECKED_IN"
  | "MEMBER_NOT_ACTIVE"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export interface CheckInSuccess {
  ok: true;
  event_id: string;
  event_title: string;
  event_slug: string;
  attendance_id: string;
  checked_in_at: string;
  points_awarded: number;
  term_id: string | null;
  term_points: number;
}

export interface CheckInFailure {
  ok: false;
  code: CheckInErrorCode;
  event_title?: string;
  opens_at?: string;
  closed_at?: string;
  membership_status?: MembershipStatus;
}

export type CheckInResult = CheckInSuccess | CheckInFailure;

export interface PointsByCategory {
  category: string;
  points: number;
  events: number;
}

export interface PointsSummary {
  member_id: string;
  term_id: string | null;
  academic_year: string | null;
  total_points: number;
  events_attended: number;
  /** null when the ranked cohort is too small for the number to mean anything. */
  top_percent: number | null;
  ranked_member_count: number;
  by_category: PointsByCategory[];
}

export interface MembershipRequirementItem {
  id: string;
  label: string;
  current: number;
  target: number;
  complete: boolean;
}

export interface MembershipProgress {
  enabled: true;
  completed: number;
  total: number;
  items: MembershipRequirementItem[];
}

export interface DashboardNextEvent {
  id: string;
  title: string;
  slug: string;
  start_at: string;
  end_at: string;
  location: string | null;
  points_value: number;
  status: EventStatus;
  check_in_opens_at: string | null;
  check_in_closes_at: string | null;
  category: string | null;
  attended: boolean;
}

export interface DashboardRecentPoint {
  id: string;
  amount: number;
  transaction_type: PointTransactionType;
  title: string;
  category: string | null;
  created_at: string;
}

export interface DashboardAnnouncement {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  published_at: string;
  external_url: string | null;
}

export interface MemberDashboard {
  profile: Pick<
    ProfileRow,
    "id" | "first_name" | "last_name" | "email" | "membership_status" | "member_since"
  >;
  roles: AppRole[];
  term: { id: string; name: string; start_date: string; end_date: string } | null;
  points: PointsSummary;
  next_event: DashboardNextEvent | null;
  recent_points: DashboardRecentPoint[];
  announcements: DashboardAnnouncement[];
  membership: MembershipProgress | null;
}

export interface AnalyticsEventCount {
  id: string;
  title: string;
  start_at: string;
  category: string | null;
  attendee_count: number;
}

export interface AdminAnalytics {
  term_id: string | null;
  total_members: number;
  active_members: number;
  events_total: number;
  events_upcoming: number;
  attendance_total: number;
  points_awarded: number;
  avg_attendance: number;
  most_attended: AnalyticsEventCount[];
  least_attended: AnalyticsEventCount[];
  attendance_by_category: {
    category: string;
    attendee_count: number;
    event_count: number;
  }[];
  engagement_buckets: { label: string; sort: number; member_count: number }[];
}

export interface AppConfig {
  allowed_email_domains?: string[];
  membership_requirements_enabled?: boolean;
  membership_requirements?: unknown[];
  points_display_label?: string;
}

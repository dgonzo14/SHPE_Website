/**
 * Hand-maintained shape of the `public` schema, mirroring
 * supabase/migrations/*.sql. Keeping it typed means a renamed column breaks the
 * build instead of quietly returning undefined at 7pm during a GBM check-in.
 *
 * If you change a migration, change this file in the same commit.
 */

import type { CardLinkKind, CardSectionId, CardTheme } from "@/features/cards/model";

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
  /** Whether members can see the points leaderboard. Officers always can. */
  leaderboard_enabled?: boolean;
  /** Whether business cards are live at /card/<handle>. Officers can always edit theirs. */
  cards_enabled?: boolean;
}

/**
 * The three boards the leaderboard offers. "term" and "academic_year" are
 * whichever term was active when the snapshot was built, not a term the
 * client picks: the snapshot only holds the current period.
 */
export type LeaderboardScope = "term" | "academic_year" | "all_time";

export interface LeaderboardEntry {
  rank: number;
  display_name: string;
  total_points: number;
  events_attended: number;
  is_me: boolean;
}

/** What a member gets while the board is hidden: the switch, and nothing else. */
export interface LeaderboardHidden {
  enabled: false;
  scope?: undefined;
}

export interface LeaderboardBoard {
  /** false only when an officer is previewing a board members cannot see. */
  enabled: boolean;
  scope: LeaderboardScope;
  /** When the daily snapshot was built. Points earned since then are not in it. */
  refreshed_at: string;
  term_name: string | null;
  academic_year: string | null;
  top_n: number;
  ranked_member_count: number;
  /** Everyone ranked top_n or better, so a tie at the cut-off can make this longer. */
  entries: LeaderboardEntry[];
  /** The caller's own row, even when it is below the cut-off. null when unranked. */
  me: LeaderboardEntry | null;
}

export type LeaderboardResponse = LeaderboardHidden | LeaderboardBoard;

/* ── Business cards (20260914000001_member_business_cards.sql) ──────────── */

/*
 * The vocabulary (link kinds, theme, sections) lives in features/cards/model.ts
 * because the Zod schemas and the renderer need it as runtime values, not just
 * types. Re-exported here so this file still describes the whole schema.
 */
export type {
  CardLinkKind,
  CardSectionId,
  CardSource,
  CardEvent,
  CardTheme,
} from "@/features/cards/model";

/** A link as the owner sees it in the editor, hidden ones included. */
export interface CardLink {
  id: string;
  kind: CardLinkKind;
  /** Overrides the kind's default label ("LinkedIn"). */
  label: string | null;
  /** An https URL, an email address, or a phone number, depending on kind. */
  value: string;
  sort_order: number;
  is_featured: boolean;
  is_visible: boolean;
}

/**
 * A link as save_my_card() accepts it. Order in the array is display order.
 * `id` is set for links that already exist, so their click history survives
 * the save; omit it for new ones. Existing links left out are deleted.
 */
export interface CardLinkInput {
  id?: string | null;
  kind: CardLinkKind;
  label: string | null;
  value: string;
  is_featured: boolean;
  is_visible: boolean;
}

/** One member's card, as its owner sees it. */
export interface MemberCard {
  member_id: string;
  handle: string;
  is_published: boolean;
  /** Opt-in. Cards are noindex unless this is on. */
  allow_indexing: boolean;

  /** Set when an officer has hidden the card; it then resolves as not found. */
  hidden_at: string | null;
  hidden_reason: string | null;

  /** True when an officer created the card rather than the member. */
  created_by_officer: boolean;
  /** The member's first save. null means officer-made and not yet opened. */
  member_opened_at: string | null;
  /** The handle written to the member's NFC chip, if an officer recorded one. */
  chip_handle: string | null;
  /**
   * Whether that chip still lands on this card: true while chip_handle is one of
   * the member's handles (an old one redirects), false once an officer's handle
   * reset deleted it and the chip needs rewriting. null when no chip is recorded.
   */
  chip_handle_active: boolean | null;
  chip_written_at: string | null;

  display_name: string;
  pronouns: string | null;
  headline: string | null;
  organization: string | null;
  status_line: string | null;
  bio: string | null;
  location: string | null;
  skills: string[];
  languages: string[];

  /** Storage object paths in the card-media bucket, never URLs. */
  avatar_path: string | null;
  banner_path: string | null;
  background_path: string | null;

  show_major: boolean;
  show_graduation_year: boolean;
  show_member_since: boolean;
  /** Only ever shows anything when an officer has verified the membership. */
  show_national_member: boolean;
  show_chapter_position: boolean;

  theme: CardTheme;
  /** Ordered list of the content blocks shown. Unlisted blocks are hidden. */
  sections: CardSectionId[];

  created_at: string;
  updated_at: string;
}

/** The fields save_my_card() writes. Everything else is set by the database. */
export type MemberCardInput = Pick<
  MemberCard,
  | "handle"
  | "display_name"
  | "pronouns"
  | "headline"
  | "organization"
  | "status_line"
  | "bio"
  | "location"
  | "skills"
  | "languages"
  | "avatar_path"
  | "banner_path"
  | "background_path"
  | "show_major"
  | "show_graduation_year"
  | "show_member_since"
  | "show_national_member"
  | "show_chapter_position"
  | "theme"
  | "sections"
  | "allow_indexing"
>;

/** Profile facts a card can show, read live from profiles at request time. */
export interface CardProfileFields {
  first_name: string;
  last_name: string;
  major: string | null;
  secondary_major: string | null;
  graduation_year: number | null;
  degree_level: DegreeLevel | null;
  member_since: string;
  /** True only for officer-verified National membership. */
  national_member_verified: boolean;
  membership_status: MembershipStatus;
}

/** get_my_card() while cards are switched off, for anyone but an officer. */
export interface MyCardDisabled {
  enabled: false;
  card?: undefined;
}

/** get_my_card(), save_my_card() and set_my_card_published(). */
export interface MyCardState {
  /** The feature switch. false only when an officer is working on a card before launch. */
  enabled: boolean;
  /** null until the member (or an officer) creates one. */
  card: MemberCard | null;
  links: CardLink[];
  /** The officer-assigned chapter position, if any. */
  position: string | null;
  profile: CardProfileFields;
}

export type MyCardResponse = MyCardDisabled | MyCardState;

/**
 * check_card_handle(). "removed" means an officer reset or released this handle
 * from the caller's card: it stays claimable by everyone else, never by them.
 */
export type HandleAvailability =
  | "available"
  | "yours"
  | "taken"
  | "reserved"
  | "removed"
  | "invalid";

/** A visible link on a public card. Hidden links never leave the database. */
export interface PublicCardLink {
  id: string;
  kind: CardLinkKind;
  label: string | null;
  value: string;
  is_featured: boolean;
}

/**
 * Everything the card renderer needs. get_public_card() returns it for a live
 * card, and the editor builds the same shape for its preview (see
 * features/cards/viewModel.ts), which is what keeps the preview honest.
 */
export interface PublicCardData {
  handle: string;
  display_name: string;
  pronouns: string | null;
  headline: string | null;
  organization: string | null;
  status_line: string | null;
  bio: string | null;
  location: string | null;
  skills: string[];
  languages: string[];
  avatar_path: string | null;
  banner_path: string | null;
  background_path: string | null;
  theme: CardTheme;
  sections: CardSectionId[];
  allow_indexing: boolean;
  /**
   * Officer-made and not yet opened by the member. The database returns only
   * name, school, education and position for these, whatever the row holds.
   */
  is_starter: boolean;
  /** null when the member shows none of these. */
  education: {
    major: string | null;
    secondary_major: string | null;
    graduation_year: number | null;
    degree_level: DegreeLevel | null;
  } | null;
  shpe: {
    /** Verified, officer-assigned. The only source of the ✔ position line. */
    position: string | null;
    member_since: string | null;
    national_member_verified: boolean;
    is_alumni: boolean;
  };
  links: PublicCardLink[];
}

/**
 * get_public_card(). Unpublished, hidden, pending, suspended, switched-off and
 * nonexistent cards are all the same `not_found`, so none can be probed.
 */
export type PublicCardResponse =
  | { status: "not_found" }
  | { status: "redirect"; handle: string }
  | { status: "ok"; card: PublicCardData };

/** get_my_card_insights(). */
export interface CardInsights {
  days: number;
  totals: {
    views: number;
    saves: number;
    shares: number;
    nfc: number;
    qr: number;
    link: number;
  };
  /** One row per day in the window, oldest first, zero-filled. */
  daily: { day: string; views: number; saves: number; shares: number }[];
  /** Every current link, zero clicks included, in display order. */
  links: { link_id: string; kind: CardLinkKind; label: string | null; clicks: number }[];
}

/* ── Business cards: officer views ───────────────────────────────────────── */

export type CardAdminStatus = "none" | "hidden" | "published" | "officer_unopened" | "member";

export interface AdminCardRow {
  member_id: string;
  first_name: string;
  last_name: string;
  email: string;
  membership_status: MembershipStatus;
  /** null when the member has no card. */
  handle: string | null;
  /**
   * One label, in precedence order: no card, hidden, published, officer-made
   * and unopened, member-made draft. created_by_officer and member_opened_at
   * carry the rest (a published starter card is "published" and unopened).
   */
  status: CardAdminStatus;
  is_published: boolean;
  hidden_at: string | null;
  hidden_reason: string | null;
  created_by_officer: boolean;
  member_opened_at: string | null;
  chip_handle: string | null;
  /** See MemberCard.chip_handle_active: false means the chip is dead and needs rewriting. */
  chip_handle_active: boolean | null;
  chip_written_at: string | null;
  /**
   * The member's other handles, oldest first. Each still redirects to the card
   * and stays theirs until an officer releases it (admin_release_card_handle).
   */
  old_handles: string[];
  position: string | null;
  views_30d: number;
  updated_at: string | null;
}

/** admin_list_cards(): every non-pending member, with or without a card. */
export interface AdminCardsResponse {
  enabled: boolean;
  rows: AdminCardRow[];
}

/** admin_create_card(). */
export interface AdminCreateCardResult {
  ok: true;
  member_id: string;
  handle: string;
  is_published: boolean;
}

/**
 * admin_mark_chips_written(). `skipped` lists members whose card was missing or
 * who no longer hold the handle the officer said was written.
 */
export interface MarkChipsWrittenResult {
  ok: true;
  count: number;
  skipped: string[];
}

/** admin_release_card_handle(). */
export interface ReleaseCardHandleResult {
  ok: true;
  handle: string;
  /** True when the released handle was the card's current one... */
  was_current: boolean;
  /** ...in which case the card moved to this new handle. null otherwise. */
  new_handle: string | null;
}

/** admin_create_missing_cards(). With dry_run nothing is written. */
export interface BulkCreateCardsResult {
  dry_run: boolean;
  published: boolean;
  created: { member_id: string; name: string; handle: string }[];
  skipped: { member_id: string; name: string; email: string; reason: "no_name" }[];
}

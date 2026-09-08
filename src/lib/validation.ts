/**
 * Every form schema in one place.
 *
 * Centralising them means a rule like "graduation year has to be plausible"
 * exists once, is testable on its own, and matches the CHECK constraint in the
 * database rather than drifting away from it. Client validation is for a fast,
 * specific error message; the database still enforces the same rules.
 */

import { z } from "zod";
import { ALLOWED_EMAIL_DOMAINS } from "./config";

export const DEGREE_LEVELS = [
  { value: "undergraduate", label: "Undergraduate" },
  { value: "masters", label: "Master's" },
  { value: "phd", label: "PhD" },
  { value: "other", label: "Other" },
] as const;

export const MEMBERSHIP_STATUSES = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending approval" },
  { value: "inactive", label: "Inactive" },
  { value: "alumni", label: "Alumni" },
  { value: "suspended", label: "Suspended" },
] as const;

export const NATIONAL_MEMBER_STATUSES = [
  { value: "not_provided", label: "Not provided" },
  { value: "self_reported", label: "Self-reported" },
  { value: "verified", label: "Verified by an officer" },
] as const;

export const EVENT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "cancelled", label: "Cancelled" },
  { value: "completed", label: "Completed" },
] as const;

export const ANNOUNCEMENT_PRIORITIES = [
  { value: "normal", label: "Normal" },
  { value: "important", label: "Important" },
  { value: "urgent", label: "Urgent" },
] as const;

export const RESOURCE_VISIBILITIES = [
  { value: "public", label: "Public — anyone" },
  { value: "member", label: "Members — signed in" },
  { value: "officer", label: "Officers only" },
] as const;

export const RESOURCE_CATEGORIES = [
  "Career",
  "Academic",
  "Convention",
  "Resume",
  "Interview",
  "Scholarship",
  "Corporate",
  "SHPE National",
  "Chapter Documents",
  "Workshops",
] as const;

const CURRENT_YEAR = new Date().getFullYear();

/* ── Reusable field schemas ──────────────────────────────────────────────── */

const email = z.email("Enter a valid email address").trim().toLowerCase();

const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Passwords are limited to 72 characters");

/*
 * These stay input-shaped (no .transform to undefined) on purpose. A schema
 * whose output type differs from its input type makes react-hook-form's
 * resolver types disagree with the form's own values, and the fix — normalising
 * "" at the point of submission — is clearer anyway. See blankToNull below.
 */
const optionalText = (max = 120) =>
  z.string().trim().max(max, `Keep this under ${max} characters`).optional();

/*
 * The protocol restriction is the point of this schema, not decoration.
 *
 * z.url() alone accepts `javascript:`, `data:` and `vbscript:` -- they are
 * well-formed URLs, so the WHATWG parser is happy with them. The message here
 * has always promised "starting with https://" while accepting none of that,
 * and these values are rendered into href attributes (announcement links), so
 * a stored `javascript:` URI would be a script-execution sink.
 *
 * The deployed CSP already blocks javascript: navigations -- verified in a
 * browser against the real policy -- but a validator that lies about what it
 * accepts is one CSP edit away from being the whole vulnerability.
 */
const optionalUrl = z
  .union([
    z.literal(""),
    z.url({ protocol: /^https?$/, error: "Enter a full URL starting with https://" }),
  ])
  .optional();

/** Empty form field -> SQL NULL. Used when handing form values to a service. */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

const graduationYear = z
  .number({ error: "Enter your graduation year" })
  .int("Enter a four-digit year")
  .min(CURRENT_YEAR - 10, "That graduation year looks too far in the past")
  .max(CURRENT_YEAR + 10, "That graduation year looks too far in the future");

/**
 * WashU-domain check. Mirrors public.assert_email_domain_allowed; this copy only
 * exists so the form can say so before a round trip.
 */
export function emailDomainIssue(value: string): string | null {
  if (ALLOWED_EMAIL_DOMAINS.length === 0) return null;
  const domain = value.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  if (ALLOWED_EMAIL_DOMAINS.includes(domain)) return null;
  const list = ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" or ");
  return `Use your ${list} address. Ask a SHPE officer if you need an exception.`;
}

/* ── Auth ────────────────────────────────────────────────────────────────── */

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    first_name: z.string().trim().min(1, "Enter your first name").max(80),
    last_name: z.string().trim().min(1, "Enter your last name").max(80),
    email,
    password,
    confirm_password: z.string(),
    major: z.string().trim().min(1, "Enter your major").max(120),
    secondary_major: optionalText(120),
    graduation_year: graduationYear,
    degree_level: z.enum(["undergraduate", "masters", "phd", "other"], {
      error: "Choose your degree level",
    }),
    shpe_national_member: z.boolean(),
    shpe_national_member_id: optionalText(60),
    linkedin_url: optionalUrl,
  })
  .superRefine((values, ctx) => {
    if (values.password !== values.confirm_password) {
      ctx.addIssue({
        code: "custom",
        path: ["confirm_password"],
        message: "Passwords don't match",
      });
    }
    /*
     * The email domain is deliberately NOT enforced here.
     *
     * public.assert_email_domain_allowed() is the authority, and it consults
     * two settings: allowed_email_domains AND manual_email_allowlist, the
     * escape hatch officers use to onboard someone whose address does not fit
     * the standard domain -- an alum, or a student on a different affiliation.
     *
     * The browser cannot see that allowlist and must not: get_app_config()
     * exposes allowed_email_domains but withholds manual_email_allowlist,
     * because publishing a list of named individuals' addresses to anon would
     * be a privacy leak.
     *
     * So a blocking check here vetoed registrations the database would have
     * accepted, using information it did not have. The allowlist was
     * unreachable through the UI even though the schema fully supported it.
     * Guidance still reaches the user: Register.tsx renders a permanent hint
     * ("Use your @wustl.edu address.") under the field, and a genuinely
     * disallowed address is rejected by the server with a clear message.
     */
  });
export type RegisterValues = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password, confirm_password: z.string() })
  .superRefine((values, ctx) => {
    if (values.password !== values.confirm_password) {
      ctx.addIssue({
        code: "custom",
        path: ["confirm_password"],
        message: "Passwords don't match",
      });
    }
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/* ── Member ──────────────────────────────────────────────────────────────── */

export const profileSchema = z.object({
  first_name: z.string().trim().min(1, "Enter your first name").max(80),
  last_name: z.string().trim().min(1, "Enter your last name").max(80),
  major: optionalText(120),
  secondary_major: optionalText(120),
  graduation_year: graduationYear.optional(),
  degree_level: z.enum(["undergraduate", "masters", "phd", "other"]).optional(),
  linkedin_url: optionalUrl,
  shpe_national_member: z.boolean(),
  shpe_national_member_id: optionalText(60),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const checkInSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Event codes are at least 4 characters")
    .max(24, "That code is too long"),
});
export type CheckInValues = z.infer<typeof checkInSchema>;

/*
 * Join code.
 *
 * The server normalises with the same normalize_checkin_code() used for event
 * codes and rejects anything under 4 characters *after* normalising, so the
 * bounds here mirror that. They are a courtesy — the rule that counts is in
 * redeem_join_code() and admin_set_join_code(), which never see this file.
 */
export const joinCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Join codes are at least 4 characters")
    .max(24, "That code is too long"),
});
export type JoinCodeValues = z.infer<typeof joinCodeSchema>;

export const setJoinCodeSchema = z.object({
  code: z
    .string()
    .trim()
    // Longer floor than redeeming: a 4-character code is guessable at leisure
    // by anyone with an account, and this is the one place we can stop a weak
    // one being chosen in the first place.
    .min(6, "Use at least 6 characters")
    .max(24, "Keep it under 24 characters")
    .refine((v) => /[a-z0-9]/i.test(v), "Use letters and numbers"),
});
export type SetJoinCodeValues = z.infer<typeof setJoinCodeSchema>;

/* ── Admin ───────────────────────────────────────────────────────────────── */

export const eventSchema = z
  .object({
    title: z.string().trim().min(1, "Give the event a title").max(160),
    description: z.string().trim().max(4000).optional(),
    category_id: z.string().uuid("Choose a category"),
    location: optionalText(160),
    start_at: z.string().min(1, "Choose a start date and time"),
    end_at: z.string().min(1, "Choose an end date and time"),
    check_in_opens_at: z.string().optional(),
    check_in_closes_at: z.string().optional(),
    points_value: z
      .number({ error: "Enter a point value" })
      .int("Points must be a whole number")
      .min(0, "Points can't be negative")
      .max(1000, "That looks too high — check the value"),
    capacity: z
      .number()
      .int("Capacity must be a whole number")
      .positive("Capacity must be at least 1")
      .optional(),
    status: z.enum(["draft", "published", "cancelled", "completed"]),
    is_public: z.boolean(),
    organizer_name: optionalText(120),
    organizer_email: z
      .union([z.literal(""), z.email("Enter a valid email address")])
      .optional(),
    image_url: optionalUrl,
  })
  .superRefine((values, ctx) => {
    if (values.end_at && values.start_at && values.end_at <= values.start_at) {
      ctx.addIssue({
        code: "custom",
        path: ["end_at"],
        message: "The event has to end after it starts",
      });
    }
    if (
      values.check_in_opens_at &&
      values.check_in_closes_at &&
      values.check_in_closes_at < values.check_in_opens_at
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["check_in_closes_at"],
        message: "Check-in can't close before it opens",
      });
    }
  });
export type EventValues = z.infer<typeof eventSchema>;

export const announcementSchema = z
  .object({
    title: z.string().trim().min(1, "Give the announcement a title").max(160),
    body: z.string().trim().min(1, "Write the announcement"),
    priority: z.enum(["normal", "important", "urgent"]),
    published_at: z.string().optional(),
    expires_at: z.string().optional(),
    external_url: optionalUrl,
  })
  .superRefine((values, ctx) => {
    if (
      values.published_at &&
      values.expires_at &&
      values.expires_at <= values.published_at
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expires_at"],
        message: "Expiry has to be after the publish time",
      });
    }
  });
export type AnnouncementValues = z.infer<typeof announcementSchema>;

export const resourceSchema = z
  .object({
    title: z.string().trim().min(1, "Give the resource a title").max(160),
    description: z.string().trim().max(1000).optional(),
    category: z.string().trim().min(1, "Choose a category"),
    url: z.string().trim().optional(),
    visibility: z.enum(["public", "member", "officer"]),
    sort_order: z.number().int().min(0).max(9999),
  })
  .superRefine((values, ctx) => {
    if (!values.url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Add a link — either a full URL or a path like /handbook.pdf",
      });
    }
  });
export type ResourceValues = z.infer<typeof resourceSchema>;

export const pointAdjustmentSchema = z.object({
  amount: z
    .number({ error: "Enter an adjustment" })
    .int("Use a whole number")
    .refine((n) => n !== 0, "Enter a non-zero adjustment")
    .refine((n) => Math.abs(n) <= 500, "That adjustment looks too large"),
  reason: z
    .string()
    .trim()
    .min(3, "Say why — this is recorded in the audit log")
    .max(300),
});
export type PointAdjustmentValues = z.infer<typeof pointAdjustmentSchema>;

export const removeAttendanceSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Say why — this is recorded in the audit log")
    .max(300),
});
export type RemoveAttendanceValues = z.infer<typeof removeAttendanceSchema>;

export const changePasswordSchema = z
  .object({ password, confirm_password: z.string() })
  .superRefine((values, ctx) => {
    if (values.password !== values.confirm_password) {
      ctx.addIssue({
        code: "custom",
        path: ["confirm_password"],
        message: "Passwords don't match",
      });
    }
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

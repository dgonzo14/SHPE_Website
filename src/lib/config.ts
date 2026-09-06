/**
 * Environment-derived configuration, read once and validated here rather than
 * being sprinkled through components as raw `import.meta.env` lookups.
 */

const env = import.meta.env;

/** Chapter-local timezone. Events are stored in UTC and displayed in this zone. */
export const CHAPTER_TIMEZONE = "America/Chicago";

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? "").trim();
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/**
 * The member portal needs a backend; the public marketing site does not.
 * When this is false the portal renders an explicit "not configured" notice
 * instead of throwing, so a fresh clone of the repo still builds and serves
 * the public site.
 */
export const isSupabaseConfigured = SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";

/** Vite's base, normalised without the trailing slash ("" at a root domain). */
export const BASE_PATH = (env.BASE_URL ?? "/").replace(/\/$/, "");

/**
 * Absolute origin used to build Supabase auth redirect targets. Falls back to
 * the running origin so preview deploys and localhost work without extra config.
 */
export function siteUrl(): string {
  const configured = (env.VITE_SITE_URL ?? "").trim().replace(/\/$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** Absolute URL for an in-app route, base path included. */
export function absoluteAppUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${siteUrl()}${BASE_PATH}${suffix}`;
}

/**
 * Client-side copy of the registration email policy — for a fast, friendly
 * error message only. The authoritative check runs in the database
 * (`public.assert_email_domain_allowed`), so editing this list does not widen
 * who can actually register.
 */
export const ALLOWED_EMAIL_DOMAINS: readonly string[] = (
  env.VITE_ALLOWED_EMAIL_DOMAINS ?? "wustl.edu"
)
  .split(",")
  .map((d: string) => d.trim().toLowerCase())
  .filter(Boolean);

export function isAllowedEmailDomain(email: string): boolean {
  if (ALLOWED_EMAIL_DOMAINS.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

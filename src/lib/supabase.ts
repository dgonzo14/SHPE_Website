import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

/**
 * The one Supabase client for the whole app.
 *
 * Session storage, refresh, and token rotation are the official client's job —
 * there is no hand-rolled token handling here, and tokens never appear in a URL
 * or a log line.
 *
 * The anon key is public by design. Authorisation comes from Auth + Row Level
 * Security in the database, never from keeping this string secret.
 */

let client: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Distinct key so two SHPE deployments on the same host (e.g. a Pages
      // build and a Netlify preview) do not fight over one stored session.
      storageKey: "washu-shpe-auth",
      flowType: "pkce",
    },
    global: {
      headers: { "x-application-name": "washu-shpe-portal" },
    },
  });
}

/**
 * Throws a clear, actionable error rather than a null-dereference when the
 * portal is used in a build that has no Supabase credentials. Callers that can
 * degrade gracefully should check `isSupabaseConfigured` first.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    throw new Error(
      "The member portal is not configured for this deployment. " +
        "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.",
    );
  }
  return client;
}

export { isSupabaseConfigured };

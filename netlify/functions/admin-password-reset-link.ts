/**
 * Creates a single-use password reset link for a member, for an admin to hand
 * over by text, Slack or in person. Default path:
 * /.netlify/functions/admin-password-reset-link. Its only caller is
 * createPasswordResetLink() in src/services/admin.ts.
 *
 * Why it exists: the emailed reset link fails often enough to matter. WashU's
 * mail filtering quarantines it or opens it before the member does, and a PKCE
 * link only works in the browser that asked for it. An admin who can pass the
 * link on by hand gets a locked-out member back in the same day.
 *
 * Why a function and not an RPC like every other admin action: the only way
 * to get a reset link from Supabase Auth without it being emailed is its
 * admin API, and that needs the service role key, which bypasses RLS entirely
 * and must never reach a browser. This is the one place in the repository
 * that reads it, and it uses it for one request, to one Auth endpoint, after
 * the database has said yes.
 *
 * Who may do it is decided by the database, exactly as everywhere else. The
 * function never decodes the caller's JWT or looks up a role itself: it calls
 * admin_password_reset_target() with the caller's own token and the anon key,
 * so require_admin() runs as that person, refuses anyone who isn't an admin,
 * refuses an admin asking about themselves, and returns the address the
 * member signs in with (from auth.users). See
 * supabase/migrations/20260918000003_admin_password_reset_links.sql.
 *
 * The order is authorise, generate, audit, return:
 *
 *   1. admin_password_reset_target() (caller's token). Nothing is created for
 *      someone who isn't allowed to ask.
 *   2. POST /auth/v1/admin/generate_link (service key), type "recovery". No
 *      email is sent; Supabase just hands the token back.
 *   3. admin_log_password_reset_link() (caller's token) writes the audit row.
 *   4. Only then is the link returned. If the audit write fails the link is
 *      thrown away, so every link an admin has ever seen has an audit row. The
 *      token it held still exists in Supabase, but nobody has it, it expires
 *      on its own, and the next link replaces it.
 *
 * The link is ours, not Supabase's. generate_link also returns an action_link
 * (Supabase's /auth/v1/verify?token=...), and this function never uses or
 * returns it, for two reasons:
 *
 *   - Opening it redirects with the session in the URL hash (#access_token=),
 *     the implicit flow. The browser client is PKCE (flowType "pkce" in
 *     src/lib/supabase.ts) and rejects that, so the member would land signed
 *     out with a spent token.
 *   - It is spent by a GET. iMessage, Slack and mail scanners fetch a link to
 *     build a preview, which would use it up before the member ever tapped it.
 *
 * Instead the link is /reset-password?token_hash=<hashed_token>&type=recovery
 * on this site. Loading that page spends nothing: the page calls verifyOtp()
 * with the hash only when the person submits their new password, so a preview
 * bot sees an ordinary page. redirect_to isn't sent, because the action_link
 * it would shape is never used.
 *
 * Single use and short-lived, both enforced by Supabase: the token is deleted
 * when it is verified, and it expires after the project's Email OTP Expiration
 * (Authentication > Providers > Email; 3600 seconds, one hour, by default).
 * Supabase keeps one recovery token per account, so a newer link, or the
 * member asking for a reset email, cancels this one.
 *
 * Deliberately no rate limit beyond "admins only". Admins are a handful of
 * trusted people, every link is in the audit log with who made it, each new
 * link cancels the last, and generate_link sends no email that could be used
 * to flood an inbox. If that ever stops being enough, add Netlify's
 * `rateLimit` to an `export const config` here (enforced at the edge, plan
 * permitting), or have admin_password_reset_target() count the caller's recent
 * member.password_reset_link_created rows in admin_audit_log and refuse past a
 * limit, which holds across every function instance.
 *
 * No CORS headers, on purpose. The app calls this from its own origin, and a
 * page on any other site can't: its request carries an Authorization header,
 * so the browser sends a preflight first, and nothing here answers one. There
 * is no cookie for a forged form post to ride on either, because the session
 * travels only as that bearer header.
 *
 * Nothing secret is ever logged: not the token, the link, the caller's JWT or
 * either key. Log lines carry HTTP status codes and error codes only, under
 * Logs & metrics > Functions in the Netlify UI.
 *
 * Runs only where Netlify runs functions. Under `npm run dev` or on a static
 * host the request gets a bare 404 or an HTML page instead, never JSON, and
 * the client says links aren't available here. Locally, its behaviour is
 * covered by src/services/__tests__/adminPasswordResetLinkFunction.test.ts;
 * the whole flow is tried on the deployed site (see README, Netlify
 * functions).
 */

/** Generous for one round trip to a warm Supabase; each step gets its own. */
const TIMEOUT_MS = 10_000;

const LOG_PREFIX = "[admin-password-reset-link]";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client knows these two codes and words them itself. */
const SESSION_EXPIRED = { code: "PGRST301", message: "Your session expired. Sign in again." };
const NOT_ADMIN = { code: "42501", message: "Only chapter admins can create password reset links." };
const DATABASE_UNREACHABLE = {
  code: "UPSTREAM",
  message: "Couldn't reach the member database. Try again in a moment.",
};

/**
 * Same names the browser bundle is built from. They must be set in the
 * Netlify UI where functions can read them: values in netlify.toml are not
 * visible to functions at runtime. The unprefixed names are a fallback for a
 * site that keeps a separate copy for its functions.
 */
function readEnv(primary: string, fallback?: string): string {
  return (process.env[primary] || (fallback ? process.env[fallback] : "") || "").trim();
}

/**
 * An https URL without its query, hash or trailing slash. Plain http is
 * accepted only for localhost, for a local Supabase stack.
 * This matters twice over here: the service role key is sent to the Supabase
 * URL, and the reset link is built on the site URL.
 */
function baseUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function requestOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

interface Env {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  siteUrl: string;
}

/** The configuration, or what's wrong with it, by variable name only. */
function readConfig(request: Request): { env: Env } | { problems: string[] } {
  const problems: string[] = [];

  const rawSupabaseUrl = readEnv("VITE_SUPABASE_URL", "SUPABASE_URL");
  const supabaseUrl = baseUrl(rawSupabaseUrl);
  if (!rawSupabaseUrl) problems.push("VITE_SUPABASE_URL is missing");
  else if (!supabaseUrl) problems.push("VITE_SUPABASE_URL isn't an https URL");

  const anonKey = readEnv("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
  if (!anonKey) problems.push("VITE_SUPABASE_ANON_KEY is missing");

  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) problems.push("SUPABASE_SERVICE_ROLE_KEY is missing");

  // The production origin when it's set, so a link made from a deploy preview
  // still opens production, which outlives the preview. Otherwise the origin
  // the admin is using, which is right on a local stack.
  const rawSiteUrl = readEnv("VITE_SITE_URL", "SITE_URL");
  const siteUrl = baseUrl(rawSiteUrl || requestOrigin(request));
  if (!siteUrl) {
    problems.push(
      rawSiteUrl
        ? "VITE_SITE_URL isn't an https URL"
        : "VITE_SITE_URL is missing and this request didn't arrive over https",
    );
  }

  if (problems.length > 0 || !supabaseUrl || !siteUrl) return { problems };
  return { env: { supabaseUrl, anonKey, serviceKey, siteUrl } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every answer is JSON and never cached: a reset link must not sit in a cache. */
function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  return match ? match[1] : null;
}

async function readMemberId(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.memberId !== "string") return null;
    return UUID.test(body.memberId) ? body.memberId : null;
  } catch {
    return null;
  }
}

interface Upstream {
  ok: boolean;
  /** Null when no answer came back at all. */
  status: number | null;
  timedOut: boolean;
  /** The parsed JSON body, or null when there was none. */
  body: unknown;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
): Promise<Upstream> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // Read the body either way: PostgREST explains a refusal in it, and
    // reading it releases the connection.
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, timedOut: false, body };
  } catch {
    // The error itself isn't logged: a network error can quote the request.
    return { ok: false, status: null, timedOut: controller.signal.aborted, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "answered 503", "no answer within ...", "network error", plus the error's
 * code when it has one of the known shapes: a SQLSTATE or PGRST code from
 * PostgREST, or a snake_case error_code from Supabase Auth. Never a message
 * or a body, which could quote the request.
 */
function describeFailure(result: Upstream): string {
  const how =
    result.status !== null
      ? `answered ${result.status}`
      : result.timedOut
        ? `no answer within ${TIMEOUT_MS} ms`
        : "network error";
  const body = isRecord(result.body) ? result.body : {};
  const code = typeof body.code === "string" ? body.code : "";
  if (/^[A-Z0-9]{5}$|^PGRST\d+$/.test(code)) return `${how}, code ${code}`;
  const authCode = typeof body.error_code === "string" ? body.error_code : "";
  if (/^[a-z_]{1,64}$/.test(authCode)) return `${how}, ${authCode}`;
  return how;
}

/** Calls one of the two database functions as the admin, with their own token. */
function callRpc(env: Env, callerToken: string, name: string, memberId: string): Promise<Upstream> {
  return postJson(
    `${env.supabaseUrl}/rest/v1/rpc/${name}`,
    { apikey: env.anonKey, Authorization: `Bearer ${callerToken}` },
    { p_member_id: memberId },
  );
}

/**
 * Turns a refusal from admin_password_reset_target() into the answer the
 * client expects. 22023 and P0002 are raised by that function with a message
 * written for the admin ("Change your own password from Settings instead",
 * "Member not found"), so those pass through as is.
 */
function targetRefusal(result: Upstream): Response {
  const body = isRecord(result.body) ? result.body : {};
  const code = typeof body.code === "string" ? body.code : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (code === "42501") {
    console.warn(`${LOG_PREFIX} refused: admin_password_reset_target ${describeFailure(result)}.`);
    return reply(403, NOT_ADMIN);
  }
  if (code === "PGRST301" || code === "PGRST303" || result.status === 401) {
    // Usually just an expired session, but logged anyway: a wrong anon key in
    // the Functions scope gets the same 401 from Supabase's gateway, and
    // without this line every admin would be sent round a sign-in loop with
    // nothing in the logs to say why.
    console.warn(`${LOG_PREFIX} signed out: admin_password_reset_target ${describeFailure(result)}.`);
    return reply(401, SESSION_EXPIRED);
  }
  if (code === "22023") {
    return reply(400, { code, message: message || "Choose a member to create a link for." });
  }
  if (code === "P0002") {
    return reply(404, { code, message: message || "Member not found." });
  }

  console.error(`${LOG_PREFIX} admin_password_reset_target failed: ${describeFailure(result)}.`);
  return reply(502, DATABASE_UNREACHABLE);
}

interface Target {
  email: string;
  display_name: string;
}

function readTarget(body: unknown): Target | null {
  if (!isRecord(body) || typeof body.email !== "string" || body.email.trim() === "") return null;
  return {
    email: body.email,
    display_name: typeof body.display_name === "string" ? body.display_name : "",
  };
}

/**
 * GoTrue's own answer puts hashed_token at the top level, beside the user.
 * supabase-js reshapes the same answer into `properties`, so that's accepted
 * too, in case the endpoint ever starts answering in that shape.
 */
function readHashedToken(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const nested = isRecord(body.properties) ? body.properties.hashed_token : undefined;
  const hashed = typeof body.hashed_token === "string" ? body.hashed_token : nested;
  return typeof hashed === "string" && hashed.trim() !== "" ? hashed.trim() : null;
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return reply(
      405,
      { code: "METHOD_NOT_ALLOWED", message: "Send a POST request to create a reset link." },
      { Allow: "POST" },
    );
  }

  const callerToken = bearerToken(request);
  if (!callerToken) return reply(401, SESSION_EXPIRED);

  const memberId = await readMemberId(request);
  if (!memberId) {
    return reply(400, { code: "22023", message: "Choose a member to create a link for." });
  }

  const config = readConfig(request);
  if ("problems" in config) {
    // Name the variables, never their values.
    console.error(
      `${LOG_PREFIX} not configured: ${config.problems.join("; ")}. Set them in the Netlify UI ` +
        "where functions can read them (SUPABASE_SERVICE_ROLE_KEY marked secret, Production context " +
        "only, Functions scope only if the plan has scopes), then trigger a new deploy.",
    );
    return reply(500, {
      code: "NOT_CONFIGURED",
      message: "Password reset links aren't set up on this site yet.",
    });
  }
  const { env } = config;

  // 1. Is the caller an admin, and whose address is this? The database decides.
  const targetResult = await callRpc(env, callerToken, "admin_password_reset_target", memberId);
  if (!targetResult.ok) return targetRefusal(targetResult);
  const target = readTarget(targetResult.body);
  if (!target) {
    console.error(`${LOG_PREFIX} admin_password_reset_target answered without an email address.`);
    return reply(502, DATABASE_UNREACHABLE);
  }

  // 2. Ask Supabase Auth for a recovery token. apikey and Authorization both
  // carry the service key, the same pair supabase-js's auth client sends,
  // which Supabase accepts for a legacy service_role JWT and for an
  // sb_secret_ key alike. The caller's token is not sent here.
  const generated = await postJson(
    `${env.supabaseUrl}/auth/v1/admin/generate_link`,
    { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` },
    { type: "recovery", email: target.email },
  );
  const hashedToken = generated.ok ? readHashedToken(generated.body) : null;
  if (!hashedToken) {
    const why = generated.ok ? "answered without a hashed_token" : describeFailure(generated);
    console.error(`${LOG_PREFIX} generate_link failed: ${why}.`);
    return reply(502, {
      code: "UPSTREAM",
      message: "Supabase didn't create the link. Try again in a moment.",
    });
  }

  // 3. Record it, as the admin. No audit row, no link.
  const audited = await callRpc(env, callerToken, "admin_log_password_reset_link", memberId);
  if (!audited.ok) {
    console.error(
      `${LOG_PREFIX} admin_log_password_reset_link failed: ${describeFailure(audited)}. ` +
        "The link was not returned.",
    );
    return reply(500, {
      code: "AUDIT_FAILED",
      message: "The link couldn't be recorded in the audit log, so it wasn't shown. Try again.",
    });
  }

  // 4. Hand it over.
  console.log(`${LOG_PREFIX} ok: link created and recorded in the audit log.`);
  return reply(200, {
    link: `${env.siteUrl}/reset-password?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`,
    email: target.email,
    display_name: target.display_name,
  });
};

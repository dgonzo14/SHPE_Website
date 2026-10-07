import type { Config } from "@netlify/functions";

/**
 * Keeps the Supabase project from pausing.
 *
 * Supabase pauses a free-tier project after about a week without activity, and
 * un-pausing is a manual click in its dashboard. During term the weekly events
 * keep it awake on their own. Summer break is the problem, and it is exactly
 * when members tap their business cards at internships and career fairs: a
 * paused project means every card, and the whole portal, shows an error until
 * an officer notices. One cheap request a day is enough to count as activity.
 *
 * Why a Netlify Scheduled Function and not a GitHub Actions cron: GitHub
 * disables scheduled workflows in a public repository after 60 days without a
 * commit, which is about the length of a summer. The ping would switch itself
 * off at the moment it matters most. Netlify runs this on the published
 * production deploy for as long as the site exists.
 *
 * What it calls: get_app_config(), the anon-granted function every page load
 * already makes. It reads one small table, needs no signed-in user, and
 * returns nothing that isn't public, so the anon key (which is in the browser
 * bundle anyway) is all this needs. The service role key is never used here.
 *
 * What it can't do: wake a project that is already paused. Pinging only stops
 * the idle timer from running out. If the logs show this failing day after
 * day, open the Supabase dashboard and restore the project by hand.
 *
 * Runs on published deploys only (not deploy previews or branch deploys). Test
 * it with the function's "Run now" button in the Netlify UI (Logs & metrics >
 * Functions), which is also where its log lines appear.
 */

/** Long enough for a slow cold start, well inside the 30-second function limit. */
const TIMEOUT_MS = 10_000;

/** A second try covers a one-off network blip without hiding a real outage. */
const ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;

const LOG_PREFIX = "[keep-supabase-awake]";

/**
 * Reads the same variables the browser bundle is built from. They must be set
 * in the Netlify UI with the Functions scope: values in netlify.toml are not
 * visible to functions at runtime. The unprefixed names are a fallback for a
 * site that keeps a separate copy for its functions.
 */
function readEnv(primary: string, fallback: string): string {
  return (process.env[primary] || process.env[fallback] || "").trim();
}

type PingResult =
  | { ok: true; status: number; ms: number }
  | { ok: false; status: number | null; ms: number; detail: string };

async function ping(endpoint: string, anonKey: string): Promise<PingResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
    // Read the body either way so the connection is released, and so a
    // failure can say what PostgREST objected to.
    const text = await response.text();
    const ms = Date.now() - started;
    if (response.ok) return { ok: true, status: response.status, ms };
    return { ok: false, status: response.status, ms, detail: text.slice(0, 200) };
  } catch (error) {
    const ms = Date.now() - started;
    const detail = controller.signal.aborted
      ? `no answer within ${TIMEOUT_MS} ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return { ok: false, status: null, ms, detail };
  } finally {
    clearTimeout(timer);
  }
}

/** Netlify sends `{ next_run }`. Only used for the log line, so never fatal. */
async function readNextRun(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { next_run?: unknown };
    return typeof body.next_run === "string" ? body.next_run : null;
  } catch {
    return null;
  }
}

export default async (request: Request): Promise<Response> => {
  const nextRun = await readNextRun(request);
  const supabaseUrl = readEnv("VITE_SUPABASE_URL", "SUPABASE_URL").replace(/\/+$/, "");
  const anonKey = readEnv("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    // Name the variables, never their values.
    console.error(
      `${LOG_PREFIX} skipped: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in the ` +
        "Netlify UI with the Functions scope. The project will pause after a week idle.",
    );
    return new Response("Supabase is not configured for functions.", { status: 500 });
  }

  let host: string;
  try {
    host = new URL(supabaseUrl).host;
  } catch {
    console.error(`${LOG_PREFIX} skipped: VITE_SUPABASE_URL is not a valid URL.`);
    return new Response("VITE_SUPABASE_URL is not a valid URL.", { status: 500 });
  }

  const endpoint = `${supabaseUrl}/rest/v1/rpc/get_app_config`;
  let result: PingResult | null = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    result = await ping(endpoint, anonKey);
    if (result.ok) break;
    console.warn(
      `${LOG_PREFIX} attempt ${attempt} of ${ATTEMPTS} to ${host} failed ` +
        `(${result.status ?? "network"}, ${result.ms} ms): ${result.detail}`,
    );
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  const next = nextRun ? ` Next run ${nextRun}.` : "";
  if (result?.ok) {
    console.log(`${LOG_PREFIX} ok: ${host} answered ${result.status} in ${result.ms} ms.${next}`);
    return new Response("ok", { status: 200 });
  }

  console.error(
    `${LOG_PREFIX} FAILED: get_app_config on ${host} failed ${ATTEMPTS} times.${next} If this keeps ` +
      "happening the project may already be paused: restore it from the Supabase dashboard.",
  );
  return new Response("Supabase did not answer.", { status: 502 });
};

export const config: Config = {
  schedule: "@daily",
};

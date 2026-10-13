// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/*
 * The admin password reset link function
 * (netlify/functions/admin-password-reset-link.ts), run for real against a
 * stubbed Supabase.
 *
 * It's loaded through import.meta.glob rather than imported: it's a Node
 * function checked by tsconfig.netlify.json, and a static import would pull
 * it, and its use of `process`, into the app's TypeScript check, which has no
 * Node types. That's also why the environment is set with vi.stubEnv and never
 * through `process.env` here.
 *
 * What matters most is the order (admin check, then the link, then the audit
 * row, then the answer) and what never leaves: the service key never goes
 * anywhere but Supabase Auth, the caller's token never goes there, and a link
 * that wasn't audited is never returned.
 */

type Handler = (request: Request) => Promise<Response>;

const FUNCTION = "/netlify/functions/admin-password-reset-link.ts";
const functionModules = import.meta.glob<{ default: Handler }>("/netlify/functions/admin-password-reset-link.ts");

async function loadHandler(): Promise<Handler> {
  const load = functionModules[FUNCTION];
  if (!load) throw new Error(`${FUNCTION} not found`);
  return (await load()).default;
}

const SUPABASE_URL = "https://abc.supabase.co";
const ANON_KEY = "anon-key-public";
const SERVICE_KEY = "service-role-key-secret";
const CALLER_TOKEN = "caller-access-token";
const MEMBER = "11111111-1111-4111-8111-111111111111";
const HASHED = "8f4c1d2e3a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1";
const ACTION_LINK = `${SUPABASE_URL}/auth/v1/verify?token=${HASHED}&type=recovery&redirect_to=https://washushpe.org`;
const ENDPOINT = "https://washushpe.org/.netlify/functions/admin-password-reset-link";

const TARGET = `${SUPABASE_URL}/rest/v1/rpc/admin_password_reset_target`;
const GENERATE = `${SUPABASE_URL}/auth/v1/admin/generate_link`;
const AUDIT = `${SUPABASE_URL}/rest/v1/rpc/admin_log_password_reset_link`;

interface Call {
  url: string;
  headers: Headers;
  body: unknown;
}

type Route = (init?: RequestInit) => Response | Promise<Response>;
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let calls: Call[] = [];
let fetchMock: Mock<Fetch>;

/** GoTrue's own answer: the user, with the link fields beside it. */
function generatedLink(extra: Record<string, unknown> = {}): Response {
  return Response.json({
    id: MEMBER,
    email: "ana@wustl.edu",
    action_link: ACTION_LINK,
    email_otp: "123456",
    hashed_token: HASHED,
    redirect_to: "https://washushpe.org",
    verification_type: "recovery",
    ...extra,
  });
}

/** What PostgREST sends back when a function raises. */
function postgrestError(status: number, code: string, message: string): Response {
  return Response.json({ code, details: null, hint: null, message }, { status });
}

function stubSupabase(overrides: Partial<Record<string, Route>> = {}): void {
  const routes: Record<string, Route> = {
    [TARGET]: () =>
      Response.json({ member_id: MEMBER, email: "ana@wustl.edu", display_name: "Ana Torres" }),
    [GENERATE]: () => generatedLink(),
    [AUDIT]: () => Response.json({ ok: true }),
  };
  for (const [url, route] of Object.entries(overrides)) {
    if (route) routes[url] = route;
  }

  fetchMock = vi.fn<Fetch>(async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch to ${url}`);
    return route(init);
  });
  vi.stubGlobal("fetch", fetchMock);
}

const callsTo = (url: string) => calls.filter((call) => call.url === url);

function post(body: unknown = { memberId: MEMBER }, headers: Record<string, string> = {}): Promise<Response> {
  return loadHandler().then((handler) =>
    handler(
      new Request(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${CALLER_TOKEN}`, "Content-Type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    ),
  );
}

let logged: string[] = [];

beforeEach(() => {
  calls = [];
  logged = [];
  // Every variable the function reads, set or blanked, so a developer's own
  // .env.local can't change what these tests see.
  vi.stubEnv("VITE_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", ANON_KEY);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  vi.stubEnv("VITE_SITE_URL", "https://washushpe.org");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_ANON_KEY", "");
  vi.stubEnv("SITE_URL", "");
  stubSupabase();

  const capture = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("admin-password-reset-link: the request", () => {
  it("only accepts POST", async () => {
    const handler = await loadHandler();
    const response = await handler(
      new Request(ENDPOINT, { headers: { Authorization: `Bearer ${CALLER_TOKEN}` } }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, string>]>([
    ["no Authorization header", {}],
    ["an empty bearer", { Authorization: "Bearer " }],
    ["another scheme", { Authorization: `Basic ${CALLER_TOKEN}` }],
  ])("asks the admin to sign in again with %s", async (_name, headers) => {
    const handler = await loadHandler();
    const response = await handler(
      new Request(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ memberId: MEMBER }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "PGRST301",
      message: "Your session expired. Sign in again.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ["a member id that isn't a uuid", { memberId: "not-a-uuid" }],
    ["no member id", {}],
    ["a number", { memberId: 7 }],
    ["a body that isn't JSON", "memberId=1"],
  ])("refuses %s", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "22023",
      message: "Choose a member to create a link for.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("admin-password-reset-link: configuration", () => {
  it("says it isn't set up, and contacts nobody, without the service key", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "NOT_CONFIGURED",
      message: "Password reset links aren't set up on this site yet.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // The log names the variable, never any value.
    expect(logged.join("\n")).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(logged.join("\n")).not.toContain(ANON_KEY);
  });

  it("won't send the service key to a Supabase URL that isn't https", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://abc.supabase.co");
    const response = await post();
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("won't build a link on a plain-http site URL", async () => {
    vi.stubEnv("VITE_SITE_URL", "http://washushpe.org");
    const response = await post();
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the unprefixed fallbacks and tolerates a trailing slash", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_URL", `${SUPABASE_URL}/`);
    vi.stubEnv("SUPABASE_ANON_KEY", ANON_KEY);
    vi.stubEnv("VITE_SITE_URL", "https://washushpe.org/");
    const response = await post();
    expect(response.status).toBe(200);
    expect((await response.json()).link).toBe(
      `https://washushpe.org/reset-password?token_hash=${HASHED}&type=recovery`,
    );
    expect(callsTo(TARGET)).toHaveLength(1);
  });
});

describe("admin-password-reset-link: who may have one", () => {
  it("refuses a non-admin before any link exists", async () => {
    stubSupabase({ [TARGET]: () => postgrestError(403, "42501", "Administrator role required") });
    const response = await post();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "42501",
      message: "Only chapter admins can create password reset links.",
    });
    expect(callsTo(GENERATE)).toHaveLength(0);
    expect(callsTo(AUDIT)).toHaveLength(0);
  });

  it.each<[string, number]>([
    ["PGRST301", 401],
    ["PGRST303", 401],
    ["", 401],
  ])("asks the admin to sign in again when PostgREST says %s (%i)", async (code, status) => {
    stubSupabase({ [TARGET]: () => postgrestError(status, code, "JWT expired") });
    const response = await post();
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("PGRST301");
    expect(callsTo(GENERATE)).toHaveLength(0);
    // Logged, because a wrong anon key looks just like this from the function.
    expect(logged.join("\n")).toContain("answered 401");
  });

  it("passes the database's own words through for an admin asking about themselves", async () => {
    stubSupabase({
      [TARGET]: () => postgrestError(400, "22023", "Change your own password from Settings instead"),
    });
    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "22023",
      message: "Change your own password from Settings instead",
    });
    expect(callsTo(GENERATE)).toHaveLength(0);
  });

  it("passes the database's own words through for a member who doesn't exist", async () => {
    stubSupabase({ [TARGET]: () => postgrestError(404, "P0002", "Member not found") });
    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "P0002", message: "Member not found" });
    expect(callsTo(GENERATE)).toHaveLength(0);
  });

  it.each<[string, Route]>([
    ["an unexpected database error", () => postgrestError(500, "XX000", "internal error in some_table")],
    ["a body that isn't JSON", () => new Response("<html>Bad gateway</html>", { status: 502 })],
    ["a success with no address", () => Response.json({ member_id: MEMBER })],
    [
      "no answer at all",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("reports the database as unreachable for %s, without leaking it", async (_name, route) => {
    stubSupabase({ [TARGET]: route });
    const response = await post();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      code: "UPSTREAM",
      message: "Couldn't reach the member database. Try again in a moment.",
    });
    expect(JSON.stringify(body)).not.toContain("some_table");
    expect(callsTo(GENERATE)).toHaveLength(0);
  });
});

describe("admin-password-reset-link: creating the link", () => {
  it("checks, creates, records, then returns a link to this site's reset page", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    // Same-origin only: nothing invites another site to read the answer.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();

    const body = await response.json();
    expect(body).toEqual({
      link: `https://washushpe.org/reset-password?token_hash=${HASHED}&type=recovery`,
      email: "ana@wustl.edu",
      display_name: "Ana Torres",
    });
    // Supabase's own link is spent by a GET and lands with an implicit-flow
    // hash the PKCE client ignores, so it never leaves the function.
    expect(JSON.stringify(body)).not.toContain("/auth/v1/verify");

    expect(calls.map((call) => call.url)).toEqual([TARGET, GENERATE, AUDIT]);
  });

  it("asks the database as the admin, with the anon key and their own token", async () => {
    await post();
    for (const call of [...callsTo(TARGET), ...callsTo(AUDIT)]) {
      expect(call.headers.get("apikey")).toBe(ANON_KEY);
      expect(call.headers.get("authorization")).toBe(`Bearer ${CALLER_TOKEN}`);
      expect(call.body).toEqual({ p_member_id: MEMBER });
      expect([...call.headers.values()].join(" ")).not.toContain(SERVICE_KEY);
    }
    expect(callsTo(TARGET)).toHaveLength(1);
    expect(callsTo(AUDIT)).toHaveLength(1);
  });

  it("asks Supabase Auth with the service key alone, for the database's address", async () => {
    await post();
    const [generate] = callsTo(GENERATE);
    expect(generate.headers.get("apikey")).toBe(SERVICE_KEY);
    expect(generate.headers.get("authorization")).toBe(`Bearer ${SERVICE_KEY}`);
    expect([...generate.headers.values()].join(" ")).not.toContain(CALLER_TOKEN);
    // No redirect_to: the action link it would shape is never used.
    expect(generate.body).toEqual({ type: "recovery", email: "ana@wustl.edu" });
  });

  it("uses the request's own origin when VITE_SITE_URL isn't set", async () => {
    vi.stubEnv("VITE_SITE_URL", "");
    const handler = await loadHandler();
    const response = await handler(
      new Request("https://deploy-preview-12--washushpe.netlify.app/.netlify/functions/admin-password-reset-link", {
        method: "POST",
        headers: { Authorization: `Bearer ${CALLER_TOKEN}` },
        body: JSON.stringify({ memberId: MEMBER }),
      }),
    );
    expect((await response.json()).link).toBe(
      `https://deploy-preview-12--washushpe.netlify.app/reset-password?token_hash=${HASHED}&type=recovery`,
    );
  });

  it("allows plain http on localhost, for netlify dev", async () => {
    vi.stubEnv("VITE_SITE_URL", "");
    const handler = await loadHandler();
    const response = await handler(
      new Request("http://localhost:8888/.netlify/functions/admin-password-reset-link", {
        method: "POST",
        headers: { Authorization: `Bearer ${CALLER_TOKEN}` },
        body: JSON.stringify({ memberId: MEMBER }),
      }),
    );
    expect((await response.json()).link).toBe(
      `http://localhost:8888/reset-password?token_hash=${HASHED}&type=recovery`,
    );
  });

  it("also reads hashed_token from under properties", async () => {
    stubSupabase({
      [GENERATE]: () =>
        Response.json({
          user: { id: MEMBER },
          properties: { action_link: ACTION_LINK, hashed_token: HASHED, verification_type: "recovery" },
        }),
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect((await response.json()).link).toBe(
      `https://washushpe.org/reset-password?token_hash=${HASHED}&type=recovery`,
    );
  });

  it("encodes the token rather than trusting its shape", async () => {
    stubSupabase({ [GENERATE]: () => generatedLink({ hashed_token: "a+b/c=&d" }) });
    const response = await post();
    expect((await response.json()).link).toBe(
      "https://washushpe.org/reset-password?token_hash=a%2Bb%2Fc%3D%26d&type=recovery",
    );
  });

  it.each<[string, Route]>([
    [
      "refuses",
      () => Response.json({ code: 422, error_code: "user_not_found", msg: "User not found" }, { status: 422 }),
    ],
    ["answers without a token", () => generatedLink({ hashed_token: undefined })],
    [
      "can't be reached",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("reports it when Supabase Auth %s, and records nothing", async (_name, route) => {
    stubSupabase({ [GENERATE]: route });
    const response = await post();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "UPSTREAM",
      message: "Supabase didn't create the link. Try again in a moment.",
    });
    expect(callsTo(AUDIT)).toHaveLength(0);
  });

  it.each<[string, Route]>([
    ["refuses", () => postgrestError(403, "42501", "Administrator role required")],
    ["errors", () => postgrestError(500, "XX000", "disk full")],
    [
      "can't be reached",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("keeps the link back when the audit log %s", async (_name, route) => {
    stubSupabase({ [AUDIT]: route });
    const response = await post();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      code: "AUDIT_FAILED",
      message: "The link couldn't be recorded in the audit log, so it wasn't shown. Try again.",
    });
    expect(text).not.toContain(HASHED);
    expect(text).not.toContain("token_hash");
  });

  it("never logs the token, the link, the caller's token or either key", async () => {
    await post();
    stubSupabase({ [AUDIT]: () => postgrestError(500, "XX000", "disk full") });
    await post();
    stubSupabase({ [GENERATE]: () => Response.json({ msg: "nope" }, { status: 500 }) });
    await post();
    stubSupabase({ [TARGET]: () => postgrestError(403, "42501", "Administrator role required") });
    await post();
    stubSupabase({ [TARGET]: () => postgrestError(401, "PGRST301", "JWT expired") });
    await post();

    expect(logged.length).toBeGreaterThan(0);
    const all = logged.join("\n");
    for (const secret of [HASHED, CALLER_TOKEN, SERVICE_KEY, ANON_KEY, "token_hash", "ana@wustl.edu"]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("admin-password-reset-link: a Supabase that never answers", () => {
  /**
   * A request that stays open until the function aborts it, and a promise
   * that settles once it has gone out, by which point its timer is running.
   */
  function hanging(): { route: Route; sent: Promise<void> } {
    let markSent: () => void = () => {};
    const sent = new Promise<void>((resolve) => {
      markSent = resolve;
    });
    const route: Route = (init) => {
      markSent();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    };
    return { route, sent };
  }

  // Without the abort, the admin would watch a spinner until Netlify killed
  // the function and answered with a page the client can only call "not
  // available here".
  it.each<[string, string, number, string]>([
    ["the admin check", TARGET, 502, "UPSTREAM"],
    ["Supabase Auth", GENERATE, 502, "UPSTREAM"],
    ["the audit log", AUDIT, 500, "AUDIT_FAILED"],
  ])("gives up on %s after its timeout and still answers in JSON", async (_name, url, status, code) => {
    await loadHandler();
    const { route, sent } = hanging();
    stubSupabase({ [url]: route });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    let settled = false;
    const pending = post().finally(() => {
      settled = true;
    });
    await sent;
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("application/json");
    const text = await response.text();
    expect(JSON.parse(text).code).toBe(code);
    expect(text).not.toContain(HASHED);
    expect(logged.join("\n")).toContain("no answer within");
  });
});

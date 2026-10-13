import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/*
 * createPasswordResetLink(): the browser's half of the admin reset link. The
 * Netlify function behind it is tested on its own
 * (adminPasswordResetLinkFunction.test.ts); this is about what the admin is
 * told for each answer it can give, including no answer from a function at
 * all, which is what `npm run dev` and a static host produce.
 */

const getSession = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: { getSession } }),
}));

import { PASSWORD_RESET_LINK_ENDPOINT, createPasswordResetLink } from "../admin";
import { UserFacingError, describeError } from "@/lib/errors";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const LINK = "https://washushpe.org/reset-password?token_hash=abc123&type=recovery";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;

function answer(response: Response): void {
  fetchMock = vi.fn<Fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
}

/** The error createPasswordResetLink() rejects with. */
async function failure(): Promise<unknown> {
  try {
    await createPasswordResetLink(MEMBER);
  } catch (error) {
    return error;
  }
  throw new Error("createPasswordResetLink resolved");
}

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "admin-jwt" } }, error: null });
  answer(Response.json({ link: LINK, email: "ana@wustl.edu", display_name: "Ana Torres" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPasswordResetLink", () => {
  it("asks for a new sign-in, and calls nothing, without a session", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const error = await failure();
    expect(error).toMatchObject({ code: "PGRST301" });
    expect(describeError(error).title).toMatch(/session expired/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the member id to the function with the admin's own token", async () => {
    await createPasswordResetLink(MEMBER);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PASSWORD_RESET_LINK_ENDPOINT);
    expect(PASSWORD_RESET_LINK_ENDPOINT).toBe("/.netlify/functions/admin-password-reset-link");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer admin-jwt");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ memberId: MEMBER });
  });

  it("returns the link, the address and the name", async () => {
    await expect(createPasswordResetLink(MEMBER)).resolves.toEqual({
      link: LINK,
      email: "ana@wustl.edu",
      display_name: "Ana Torres",
    });
  });

  it.each([
    ["the app's own page", new Response("<!doctype html><title>WashU SHPE</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })],
    ["a bare 404", new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } })],
  ])("explains that links need the deployed site when the answer is %s", async (_name, response) => {
    answer(response);
    const error = await failure();
    expect(error).toBeInstanceOf(UserFacingError);
    const message = describeError(error);
    expect(message.title).toMatch(/aren't available here/i);
    expect(message.detail).toMatch(/deployed site/i);
  });

  it("words a refusal as a permissions problem, not the function's own message", async () => {
    answer(
      Response.json(
        { code: "42501", message: "Only chapter admins can create password reset links." },
        { status: 403 },
      ),
    );
    const error = await failure();
    expect(error).toMatchObject({ code: "42501" });
    expect(error).not.toBeInstanceOf(UserFacingError);
    expect(describeError(error).title).toMatch(/don't have access/i);
  });

  it("asks for a new sign-in when the function says the session expired", async () => {
    answer(Response.json({ code: "PGRST301", message: "Your session expired. Sign in again." }, { status: 401 }));
    const error = await failure();
    expect(error).toMatchObject({ code: "PGRST301" });
    expect(describeError(error).title).toMatch(/session expired/i);
  });

  it.each([
    [400, "22023", "Change your own password from Settings instead"],
    [404, "P0002", "Member not found"],
    [502, "UPSTREAM", "Supabase didn't create the link. Try again in a moment."],
    [500, "AUDIT_FAILED", "The link couldn't be recorded in the audit log, so it wasn't shown. Try again."],
    [500, "NOT_CONFIGURED", "Password reset links aren't set up on this site yet."],
  ])("shows any other answer's message as written (%i %s)", async (status, code, message) => {
    answer(Response.json({ code, message }, { status }));
    const error = await failure();
    expect(error).toBeInstanceOf(UserFacingError);
    expect(describeError(error)).toEqual({ title: message });
  });

  it("falls back to its own sentence for an answer with no message", async () => {
    answer(Response.json({}, { status: 500 }));
    const error = await failure();
    expect(error).toBeInstanceOf(UserFacingError);
    expect(describeError(error).title).toMatch(/couldn't create a reset link/i);
  });
});

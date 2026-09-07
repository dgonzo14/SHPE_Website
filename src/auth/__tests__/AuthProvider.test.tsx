import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../AuthProvider";
import { useAuth } from "../useAuth";

/*
 * These cover the failure that made a signed-in admin look like a stranger:
 * the profile read returned no row, the app took that as fact, and the
 * dashboard greeted them with no name while /admin said "You don't have
 * access" until the page was reloaded.
 *
 * The read returning nothing is silent — maybeSingle() gives
 * { data: null, error: null } — so nothing here throws. Only the retry, and
 * profileLoading staying true while it happens, keeps the UI honest.
 */

const SESSION = {
  user: { id: "user-1", email: "ana@wustl.edu" },
  access_token: "t",
} as unknown as import("@supabase/supabase-js").Session;

const PROFILE = { id: "user-1", first_name: "Ana", last_name: "Rivera" };

let profileResponses: { data: unknown; error: unknown }[] = [];
let roleResponses: { data: unknown; error: unknown }[] = [];

function nextOr<T extends { data: unknown; error: unknown }>(queue: T[], fallback: T): T {
  return queue.length > 1 ? (queue.shift() as T) : (queue[0] ?? fallback);
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: SESSION } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: (table: string) => {
      const rows = table === "profiles" ? profileResponses : roleResponses;
      const result = nextOr(rows, { data: null, error: null });
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  }),
}));

function Probe() {
  const { profile, roles, profileLoading, isAdmin } = useAuth();
  return (
    <div>
      <span data-testid="name">{profile?.first_name ?? "(none)"}</span>
      <span data-testid="loading">{String(profileLoading)}</span>
      <span data-testid="admin">{String(isAdmin)}</span>
      <span data-testid="roles">{roles.join(",") || "(no roles)"}</span>
    </div>
  );
}

function renderProvider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthProvider profile loading", () => {
  beforeEach(() => {
    profileResponses = [];
    roleResponses = [];
  });

  it("loads the profile and roles for a signed-in member", async () => {
    profileResponses = [{ data: PROFILE, error: null }];
    roleResponses = [{ data: [{ role: "admin" }, { role: "member" }], error: null }];

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Ana"));
    expect(screen.getByTestId("admin")).toHaveTextContent("true");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  /*
   * The regression. A first read that sees no row must not be treated as
   * "this member has no profile" — a signed-in member always has one, because
   * handle_new_user() creates it inside the signup transaction.
   */
  it("retries when the first read returns no row, instead of reporting no profile", async () => {
    profileResponses = [
      { data: null, error: null },
      { data: null, error: null },
      { data: PROFILE, error: null },
    ];
    roleResponses = [
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ role: "admin" }], error: null },
    ];

    renderProvider();

    // Nothing invented while the retries run.
    expect(screen.getByTestId("name")).toHaveTextContent("(none)");

    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Ana"), {
      timeout: 4000,
    });
    expect(screen.getByTestId("admin")).toHaveTextContent("true");
  });

  it("stays in the loading state while retrying, so route guards wait", async () => {
    profileResponses = [
      { data: null, error: null },
      { data: PROFILE, error: null },
    ];
    roleResponses = [
      { data: [], error: null },
      { data: [{ role: "officer" }], error: null },
    ];

    renderProvider();

    /*
     * If profileLoading went false between attempts, RequireRole would stop
     * waiting, see an empty roles array and render "You don't have access" to
     * an officer mid-retry.
     */
    expect(screen.getByTestId("loading")).toHaveTextContent("true");

    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("officer"), {
      timeout: 4000,
    });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });
});

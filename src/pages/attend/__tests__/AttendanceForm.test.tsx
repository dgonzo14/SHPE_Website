import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";

import { AttendanceForm } from "../AttendanceForm";
import { renderWithProviders, testProfile } from "@/test/renderWithProviders";
import { queryKeys } from "@/services/queryKeys";
import type { AuthContextValue } from "@/auth/authContext";
import type { AttendanceFormValues } from "@/lib/validation";
import type { AttendanceFormResponse, AttendanceSubmitResult } from "@/types/database";

/*
 * What a visitor holding an attendance link sees, and what the page sends.
 * The rules themselves (the window, matching an email to an account, claiming
 * later) live in the database and are covered by the SQL tests; here the
 * backend is the two service calls, and the real helpers (the token shape,
 * the refusal messages) are kept.
 */

const api = vi.hoisted(() => ({
  fetchAttendanceForm: vi.fn<(token: string) => Promise<AttendanceFormResponse>>(),
  submitAttendance:
    vi.fn<(token: string, values: AttendanceFormValues) => Promise<AttendanceSubmitResult>>(),
}));

vi.mock("@/services/attendanceForm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/attendanceForm")>()),
  ...api,
}));

// Tests run without Supabase settings, so the page would always say "not
// connected"; beforeEach switches the backend on. It starts off because the
// real service module above imports lib/supabase, which builds its client at
// import time and would be handed an empty URL if the backend looked "on" then.
const backend = vi.hoisted(() => ({ configured: false }));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    get isSupabaseConfigured() {
      return backend.configured;
    },
  };
});

/*
 * Who the real <App />'s AuthProvider reports, for the route test. The real
 * provider can't report a signed-in member without a Supabase client, and a
 * signed-in member is exactly who RedirectIfAuthenticated would turn away.
 * The other tests render through renderWithProviders, which doesn't use it.
 */
const appVisitor = vi.hoisted(() => ({ auth: null as AuthContextValue | null }));
vi.mock("@/auth/AuthProvider", async () => {
  const { createElement } = await import("react");
  const { AuthContext } = await import("@/auth/authContext");
  return {
    AuthProvider: ({ children }: { children: ReactNode }) =>
      createElement(AuthContext.Provider, { value: appVisitor.auth }, children),
  };
});

const TOKEN = "0123456789abcdef0123456789abcdef";

const EVENT = {
  title: "General Body Meeting #3",
  // 6:30 – 8:00 PM in St. Louis.
  start_at: "2026-09-18T23:30:00.000Z",
  end_at: "2026-09-19T01:00:00.000Z",
  location: "Lopata Hall 101",
};

function formIs(
  status: "open" | "not_open" | "closed" | "cancelled",
  overrides: { opens_at?: string } = {},
): AttendanceFormResponse {
  return {
    status,
    // 6:15 PM, a quarter of an hour before the start.
    opens_at: overrides.opens_at ?? "2026-09-18T23:15:00.000Z",
    closes_at: "2026-09-19T01:30:00.000Z",
    event: EVENT,
  };
}

const SIGNED_OUT: Partial<AuthContextValue> = {
  status: "signed-out",
  session: null,
  user: null,
  profile: null,
};

function renderPage(
  { path = `/attend/${TOKEN}`, auth = SIGNED_OUT }: { path?: string; auth?: Partial<AuthContextValue> } = {},
) {
  return renderWithProviders(
    <Routes>
      <Route path="/attend/:token" element={<AttendanceForm />} />
      <Route path="/register" element={<RouteProbe name="Registration" />} />
      <Route path="/login" element={<RouteProbe name="Sign-in page" />} />
      <Route path="/portal" element={<RouteProbe name="My SHPE" />} />
    </Routes>,
    { route: path, auth },
  );
}

/** Stands in for a page a link leads to, showing the router state it was given. */
function RouteProbe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <>
      <p>{name}</p>
      <pre data-testid="route-state">{JSON.stringify(location.state ?? null)}</pre>
    </>
  );
}

const routeState = () => JSON.parse(screen.getByTestId("route-state").textContent ?? "null");

const firstName = () => screen.getByLabelText(/first name/i);
const lastName = () => screen.getByLabelText(/last name/i);
const email = () => screen.getByLabelText(/^email/i);
const checkInButton = () => screen.getByRole("button", { name: /^check in$/i });

async function fillIn(
  user: ReturnType<typeof userEvent.setup>,
  values: { first: string; last: string; email: string },
) {
  await user.type(await screen.findByLabelText(/first name/i), values.first);
  await user.type(lastName(), values.last);
  await user.type(email(), values.email);
}

beforeEach(() => {
  backend.configured = true;
  api.fetchAttendanceForm.mockReset();
  api.submitAttendance.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── Which page shows ────────────────────────────────────────────────────── */

describe("AttendanceForm: the link", () => {
  it("treats a link that can't be a token as not found, without asking the database", async () => {
    renderPage({ path: "/attend/not-a-real-token" });

    expect(
      screen.getByRole("heading", { level: 1, name: "This attendance link doesn't work" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ask an officer for the current link or qr code/i)).toBeInTheDocument();
    expect(api.fetchAttendanceForm).not.toHaveBeenCalled();
  });

  it("accepts a token that arrives in capitals, and looks it up in lowercase", async () => {
    api.fetchAttendanceForm.mockResolvedValue(formIs("open"));
    renderPage({ path: `/attend/${TOKEN.toUpperCase()}` });

    expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
    expect(api.fetchAttendanceForm).toHaveBeenCalledWith(TOKEN);
  });

  it("gives an unknown or replaced link the same page as a malformed one", async () => {
    api.fetchAttendanceForm.mockResolvedValue({ status: "not_found" });
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "This attendance link doesn't work" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/replaced with a new one, or copied incompletely/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  it("explains itself, without a request, when the build has no backend", () => {
    backend.configured = false;
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Attendance isn't available here" }),
    ).toBeInTheDocument();
    expect(api.fetchAttendanceForm).not.toHaveBeenCalled();
  });

  it("offers a retry when the form can't be loaded", async () => {
    // describeError logs the raw error in development.
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.fetchAttendanceForm.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    api.fetchAttendanceForm.mockResolvedValue(formIs("open"));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load this attendance form",
    );
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
    expect(api.fetchAttendanceForm).toHaveBeenCalledTimes(2);
  });

  it("is kept out of search engines and keeps the token out of <head>", async () => {
    api.fetchAttendanceForm.mockResolvedValue(formIs("open"));
    renderPage();
    await screen.findByLabelText(/first name/i);

    expect(document.title).toBe("Event Attendance | WashU SHPE");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex, nofollow",
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.innerHTML).not.toContain(TOKEN);
  });
});

describe("AttendanceForm: the check-in window", () => {
  it("names the event, its time and its place above the form", async () => {
    api.fetchAttendanceForm.mockResolvedValue(formIs("open"));
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "General Body Meeting #3" }),
    ).toBeInTheDocument();
    expect(screen.getByText("September 18, 2026 · 6:30 PM – 8:00 PM CT")).toBeInTheDocument();
    expect(screen.getByText("Lopata Hall 101")).toBeInTheDocument();
    // Arriving on an open form is read like any page, not announced.
    expect(screen.queryByText("Attendance is open.")).not.toBeInTheDocument();
  });

  it("says when attendance opens, instead of offering a form that would be refused", async () => {
    api.fetchAttendanceForm.mockResolvedValue(formIs("not_open"));
    renderPage();

    expect(await screen.findByText("Attendance opens at 6:15 PM")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "General Body Meeting #3" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  it("gives the date too when the window opens on an earlier day", async () => {
    api.fetchAttendanceForm.mockResolvedValue(
      formIs("not_open", { opens_at: "2026-09-17T23:15:00.000Z" }),
    );
    renderPage();

    expect(
      await screen.findByText("Attendance opens Thursday, September 17 at 6:15 PM"),
    ).toBeInTheDocument();
  });

  it("opens the form by itself when the window opens", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.fetchAttendanceForm.mockResolvedValueOnce(formIs("not_open"));
    api.fetchAttendanceForm.mockResolvedValue(formIs("open"));
    renderPage();

    expect(await screen.findByText("Attendance opens at 6:15 PM")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(30_000));

    expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
    expect(api.fetchAttendanceForm).toHaveBeenCalledTimes(2);
    // Said aloud too: nothing else tells a screen reader the form arrived.
    expect(screen.getByText("Attendance is open.").closest("[aria-live]")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  /*
   * The app's client counts an answer as fresh for a minute (lib/queryClient)
   * and the test client doesn't, so this sets the same: without it any focus
   * would refetch, and the test would pass whatever the page asked for.
   */
  it("checks again as soon as the visitor comes back to the tab", async () => {
    api.fetchAttendanceForm.mockResolvedValueOnce(formIs("not_open"));
    api.fetchAttendanceForm.mockResolvedValue(formIs("open"));
    const { queryClient } = renderPage();
    queryClient.setQueryDefaults(queryKeys.attendanceForm(TOKEN), { staleTime: 60_000 });

    expect(await screen.findByText("Attendance opens at 6:15 PM")).toBeInTheDocument();
    // What a phone fires when it's unlocked or the tab is brought back.
    act(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });

    expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
    expect(api.fetchAttendanceForm).toHaveBeenCalledTimes(2);
  });

  it("says attendance has closed and who can still help", async () => {
    api.fetchAttendanceForm.mockResolvedValue(formIs("closed"));
    renderPage();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Attendance for General Body Meeting #3 has closed",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ask an officer to add you/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  it("says when the event was cancelled", async () => {
    api.fetchAttendanceForm.mockResolvedValue(formIs("cancelled"));
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "General Body Meeting #3 was cancelled" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });
});

/*
 * The route, through the real App, for both people the form is for. Behind
 * RequireAuth a guest would be sent to /login; inside RedirectIfAuthenticated
 * a signed-in member would be sent to /portal. Landing on this page's own
 * notice (the backend is off, so it can't get further) shows it is behind
 * neither.
 */
describe("AttendanceForm: the route", () => {
  function appAuth(status: "signed-in" | "signed-out"): AuthContextValue {
    const signedIn = status === "signed-in";
    return {
      status,
      session: null,
      user: signedIn ? ({ id: testProfile.id } as AuthContextValue["user"]) : null,
      profile: signedIn ? testProfile : null,
      profileLoading: false,
      roles: signedIn ? ["member"] : [],
      isOfficer: false,
      isAdmin: false,
      hasRole: () => false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      requestPasswordReset: vi.fn(),
      verifyRecoveryToken: vi.fn(),
      updatePassword: vi.fn(),
      refreshProfile: vi.fn(),
    };
  }

  it.each([
    ["a guest", "signed-out" as const],
    ["a signed-in member", "signed-in" as const],
  ])("is served at /attend/:token to %s, inside the auth layout", async (_who, status) => {
    backend.configured = false;
    appVisitor.auth = appAuth(status);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    window.history.pushState({}, "", `/attend/${TOKEN}`);
    const { default: App } = await import("@/App");
    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Attendance isn't available here" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/attend/${TOKEN}`);
    expect(screen.getByRole("link", { name: /back to the washu shpe website/i })).toBeInTheDocument();
    window.history.pushState({}, "", "/");
  });
});

/* ── Submitting ──────────────────────────────────────────────────────────── */

describe("AttendanceForm: submitting", () => {
  beforeEach(() => {
    api.fetchAttendanceForm.mockResolvedValue(formIs("open"));
  });

  it("checks the visitor in and sends the response normalised", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "  Ana ", last: "Rivera  ", email: "Ana.Rivera@WUSTL.edu" });
    await user.click(checkInButton());

    expect(
      await screen.findByRole("heading", { level: 1, name: "You're checked in" }),
    ).toBeInTheDocument();
    expect(api.submitAttendance).toHaveBeenCalledWith(TOKEN, {
      first_name: "Ana",
      last_name: "Rivera",
      email: "ana.rivera@wustl.edu",
    });
  });

  /*
   * The form answers a matched address and an unmatched one identically (see
   * the migration header), so the page has nothing to give away -- but its
   * copy still has to read true in both cases rather than promise points.
   */
  it("says what happens next without claiming the email has an account", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Thanks for coming to General Body Meeting #3.");
    expect(status).toHaveTextContent(
      "If ana.rivera@wustl.edu is on a SHPE account, this counts toward its points.",
    );
    expect(status).toHaveTextContent(
      "Create an account with this email and this event will already be on it.",
    );
    expect(status.textContent).not.toMatch(/\+\d+|points awarded|found your account|no account/i);
    // Focus follows the answer rather than being dropped with the button.
    expect(screen.getByRole("heading", { level: 1, name: "You're checked in" })).toHaveFocus();
  });

  it("offers a signed-out visitor an account", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    expect(await screen.findByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  /*
   * Registration only takes school addresses, so "create an account with this
   * email" would send someone who used a personal one to a form that refuses
   * it. What the page says may depend on the domain they typed -- they know
   * it already -- but never on whether the address has an account, so the
   * first sentence is the one every check-in gets.
   */
  it("tells someone who used a personal address what an account needs, instead of offering one", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "Ana@Gmail.com" });
    await user.click(checkInButton());

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "If ana@gmail.com is on a SHPE account, this counts toward its points.",
    );
    expect(status).toHaveTextContent(
      "SHPE accounts are made with an @wustl.edu address, so if you're a WashU student, check in again with your WashU email for this event to count toward your points.",
    );
    expect(status).not.toHaveTextContent(/create an account with this email/i);
  });

  it("still offers an account to a personal address, without carrying the address over", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana@gmail.com" });
    await user.click(checkInButton());
    await user.click(await screen.findByRole("link", { name: "Create an account" }));

    expect(await screen.findByText("Registration")).toBeInTheDocument();
    // Registration would refuse it, so only the names come along.
    expect(routeState()).toEqual({
      prefill: { first_name: "Ana", last_name: "Rivera", email: "" },
    });
  });

  it("brings the form back with the names kept when they check in again with a school address", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana@gmail.com" });
    await user.click(checkInButton());
    await user.click(
      await screen.findByRole("button", { name: "Check in with my @wustl.edu email" }),
    );

    // Same person, so only the address needs typing again, and that's where
    // they start.
    expect(await screen.findByLabelText(/^email/i)).toHaveValue("");
    await waitFor(() => expect(email()).toHaveFocus());
    expect(firstName()).toHaveValue("Ana");
    expect(lastName()).toHaveValue("Rivera");

    await user.type(email(), "ana.rivera@wustl.edu");
    await user.click(checkInButton());

    expect(await screen.findByRole("link", { name: "Create an account" })).toBeInTheDocument();
    expect(api.submitAttendance).toHaveBeenLastCalledWith(TOKEN, {
      first_name: "Ana",
      last_name: "Rivera",
      email: "ana.rivera@wustl.edu",
    });
  });

  it("fills in a signed-in member's details, and doesn't offer them an account", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage({ auth: {} });

    expect(await screen.findByLabelText(/first name/i)).toHaveValue(testProfile.first_name);
    expect(lastName()).toHaveValue(testProfile.last_name);
    expect(email()).toHaveValue(testProfile.email);

    await user.click(checkInButton());

    expect(
      await screen.findByRole("heading", { level: 1, name: "You're checked in" }),
    ).toBeInTheDocument();
    expect(api.submitAttendance).toHaveBeenCalledWith(TOKEN, {
      first_name: testProfile.first_name,
      last_name: testProfile.last_name,
      email: testProfile.email,
    });
    expect(screen.queryByRole("link", { name: "Create an account" })).not.toBeInTheDocument();
  });

  it("waits for a signed-in member's profile rather than showing them an empty form", async () => {
    const { queryClient } = renderPage({ auth: { profile: null, profileLoading: true } });

    // The form itself has loaded; only the profile is outstanding.
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.attendanceForm(TOKEN))).toEqual(formIs("open")),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading the attendance form");
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  /*
   * AuthProvider starts profileLoading true and only clears it when a user id
   * changes, so a visitor who never signed in keeps it true for good. A guest
   * is who this page is for; they must not be held on a spinner by it.
   */
  it("does not wait on profile loading for a visitor who isn't signed in", async () => {
    renderPage({ auth: { ...SIGNED_OUT, profileLoading: true } });

    expect(await screen.findByLabelText(/first name/i)).toHaveValue("");
  });

  // Everyone checks in on their own phone; there's no handing it on.
  it("doesn't offer to check in someone else", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    await screen.findByRole("heading", { level: 1, name: "You're checked in" });
    expect(screen.queryByRole("button", { name: /someone else/i })).not.toBeInTheDocument();
  });

  it("shows why a response was turned away, and reloads the form's state", async () => {
    api.submitAttendance.mockResolvedValue({
      ok: false,
      code: "FORM_CLOSED",
      event_title: "General Body Meeting #3",
      closed_at: "2026-09-19T01:30:00.000Z",
    });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Attendance for this event has closed");
    expect(alert).toHaveTextContent("If you were there, ask an officer to add you.");
    expect(alert.textContent).not.toMatch(/FORM_CLOSED/);
    await waitFor(() => expect(api.fetchAttendanceForm).toHaveBeenCalledTimes(2));
  });

  it("swaps the form for the closed notice once the reload confirms it", async () => {
    api.fetchAttendanceForm.mockReset();
    api.fetchAttendanceForm.mockResolvedValueOnce(formIs("open"));
    api.fetchAttendanceForm.mockResolvedValue(formIs("closed"));
    api.submitAttendance.mockResolvedValue({ ok: false, code: "FORM_CLOSED" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Attendance for General Body Meeting #3 has closed",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
    // The alert that explained the refusal went with the form, so the swap is
    // announced on its own.
    expect(
      screen.getByText("Attendance for General Body Meeting #3 has closed.").closest("[aria-live]"),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("leaves the form alone when it is full, since the form itself is current", async () => {
    api.submitAttendance.mockResolvedValue({ ok: false, code: "FORM_FULL" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This form isn't taking more responses");
    // An officer can still add anyone by name and email.
    expect(alert).toHaveTextContent("Ask an officer to check you in.");
    expect(api.fetchAttendanceForm).toHaveBeenCalledTimes(1);
    expect(firstName()).toBeInTheDocument();
  });

  it("explains an unexpected failure in plain words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.submitAttendance.mockRejectedValue(new Error("upstream connect error"));
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't record your attendance");
    expect(alert.textContent).not.toMatch(/upstream/i);
    // Still there to try again.
    expect(checkInButton()).toBeEnabled();
  });

  it("checks the fields before spending a request, and focuses the first problem", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText(/first name/i);
    await user.click(checkInButton());

    expect(await screen.findByText("Enter your first name")).toBeInTheDocument();
    expect(screen.getByText("Enter your last name")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(firstName()).toHaveFocus();
    expect(firstName()).toHaveAttribute("aria-invalid", "true");
    expect(api.submitAttendance).not.toHaveBeenCalled();
  });

  it("refuses names that are only spaces and an address that isn't one", async () => {
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "   ", last: "   ", email: "ana@wustl" });
    await user.click(checkInButton());

    expect(await screen.findByText("Enter your first name")).toBeInTheDocument();
    expect(screen.getByText("Enter your last name")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(api.submitAttendance).not.toHaveBeenCalled();
  });

  /*
   * Phones label Enter "Next" on the name fields, but on iOS it still sends
   * the form, which checked every field at once and flagged the ones nobody
   * had reached yet.
   */
  it("moves on to the next field on Enter in a name field, and sends on Enter in Email", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText(/first name/i), "Ana{Enter}");
    await waitFor(() => expect(lastName()).toHaveFocus());
    expect(screen.queryByText("Enter your last name")).not.toBeInTheDocument();
    expect(screen.queryByText("Enter a valid email address")).not.toBeInTheDocument();

    await user.keyboard("Rivera{Enter}");
    await waitFor(() => expect(email()).toHaveFocus());
    expect(screen.queryByText("Enter a valid email address")).not.toBeInTheDocument();
    expect(api.submitAttendance).not.toHaveBeenCalled();

    await user.keyboard("ana.rivera@wustl.edu{Enter}");

    expect(
      await screen.findByRole("heading", { level: 1, name: "You're checked in" }),
    ).toBeInTheDocument();
    expect(api.submitAttendance).toHaveBeenCalledWith(TOKEN, {
      first_name: "Ana",
      last_name: "Rivera",
      email: "ana.rivera@wustl.edu",
    });
  });

  it("keeps the hints that say what Enter does", async () => {
    renderPage();

    expect(await screen.findByLabelText(/first name/i)).toHaveAttribute("enterkeyhint", "next");
    expect(lastName()).toHaveAttribute("enterkeyhint", "next");
    expect(email()).toHaveAttribute("enterkeyhint", "go");
  });

  /*
   * Enter while an input method is composing picks the characters for a name
   * typed in another script; with a modifier it may be a keyboard's or a
   * screen reader's own command. Neither is "next field". fireEvent says
   * whether the page cancelled the key: true means it left it alone.
   *
   * react-hook-form's setFocus focuses on the next tick, so the test lets a
   * tick pass before saying focus didn't move.
   */
  it("leaves Enter alone while a name is being composed, or with a modifier held", async () => {
    renderPage();
    const first = await screen.findByLabelText(/first name/i);
    act(() => first.focus());

    expect(fireEvent.keyDown(first, { key: "Enter", isComposing: true })).toBe(true);
    // Safari ends a composition with isComposing already false, but keyCode 229.
    expect(fireEvent.keyDown(first, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(first, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(first, { key: "Enter", metaKey: true })).toBe(true);
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(first).toHaveFocus();

    expect(fireEvent.keyDown(first, { key: "Enter", keyCode: 13 })).toBe(false);
    await waitFor(() => expect(lastName()).toHaveFocus());
  });

  it("advises a school address without requiring one", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText(/first name/i);
    expect(email()).toHaveAccessibleDescription(/@wustl\.edu/);

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana@gmail.com" });
    await user.click(checkInButton());

    await waitFor(() => expect(api.submitAttendance).toHaveBeenCalledTimes(1));
    expect(api.submitAttendance.mock.calls[0][1].email).toBe("ana@gmail.com");
  });

  it("does not submit twice when the button is tapped repeatedly", async () => {
    let resolve!: (value: AttendanceSubmitResult) => void;
    api.submitAttendance.mockImplementation(
      () => new Promise<AttendanceSubmitResult>((r) => (resolve = r)),
    );
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    const button = checkInButton();

    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await user.click(button);
    await user.dblClick(button);

    expect(api.submitAttendance).toHaveBeenCalledTimes(1);

    resolve({ ok: true, event_title: "General Body Meeting #3" });
    expect(
      await screen.findByRole("heading", { level: 1, name: "You're checked in" }),
    ).toBeInTheDocument();
    expect(api.submitAttendance).toHaveBeenCalledTimes(1);
  });
});

/* ── Accounts ────────────────────────────────────────────────────────────── */

/*
 * Checking in never needs an account, but once someone has checked in the
 * page leads them to one: sign in if they have it, make one if they don't.
 * The form itself links nowhere, so nothing draws anyone away before they've
 * sent it. And the page only ever suggests a WashU address, the kind accounts
 * are made with.
 */
describe("AttendanceForm: accounts", () => {
  beforeEach(() => {
    api.fetchAttendanceForm.mockResolvedValue(formIs("open"));
  });

  it("asks only for a WashU address, and doesn't advertise skipping an account", async () => {
    renderPage();

    await screen.findByLabelText(/first name/i);
    expect(screen.getByText("Add your name to show you were here.")).toBeInTheDocument();
    expect(screen.queryByText(/don't need an account/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Use your @wustl.edu email so this counts toward your SHPE points."),
    ).toBeInTheDocument();
  });

  it("keeps the form itself free of sign-in and dashboard links", async () => {
    renderPage();

    await screen.findByLabelText(/first name/i);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My SHPE dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByText(/have a shpe account/i)).not.toBeInTheDocument();
  });

  it("keeps it free of them for a signed-in member too", async () => {
    renderPage({ auth: {} });

    await screen.findByLabelText(/first name/i);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My SHPE dashboard" })).not.toBeInTheDocument();
  });

  it("after checking in, offers sign-in to see points, landing on the dashboard", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Already have one? Sign in to see your My SHPE dashboard and SHPE points.",
    );
    await user.click(screen.getByRole("link", { name: "Sign in" }));

    // No `from` this time: Login's default is the dashboard, which is the point.
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(routeState()).toBeNull();
  });

  it("carries the name and address into account creation", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "Ana.Rivera@WUSTL.edu" });
    await user.click(checkInButton());
    await user.click(await screen.findByRole("link", { name: "Create an account" }));

    expect(await screen.findByText("Registration")).toBeInTheDocument();
    // As recorded, so the account is made with the address the check-in waits on.
    expect(routeState()).toEqual({
      prefill: { first_name: "Ana", last_name: "Rivera", email: "ana.rivera@wustl.edu" },
    });
  });

  it("sends a signed-in member to My SHPE after checking in", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage({ auth: {} });

    await screen.findByLabelText(/first name/i);
    await user.click(checkInButton());

    await screen.findByRole("heading", { level: 1, name: "You're checked in" });
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My SHPE dashboard" })).toHaveAttribute(
      "href",
      "/portal",
    );
  });

  /*
   * Side by side and the same size, so someone with an account doesn't take
   * the more prominent button and make a second one. The grid gives each half
   * the row (stacked on a phone) and `block` fills it.
   */
  it("gives a signed-out visitor Create an account and Sign in as equal buttons", async () => {
    api.submitAttendance.mockResolvedValue({ ok: true, event_title: "General Body Meeting #3" });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, { first: "Ana", last: "Rivera", email: "ana.rivera@wustl.edu" });
    await user.click(checkInButton());

    const create = await screen.findByRole("link", { name: "Create an account" });
    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(create.parentElement).toBe(signIn.parentElement);
    expect(create.parentElement).toHaveClass("grid", "sm:grid-cols-2");
    expect(create).toHaveClass("w-full");
    expect(signIn).toHaveClass("w-full");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";

import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { AdminEventAttendance } from "../AdminEventAttendance";
import { renderWithProviders, testProfile } from "@/test/renderWithProviders";
import type { WaitingSubmission } from "@/services/attendanceForm";
import type { EventAttendee, EventWithCategory } from "@/services/events";
import type { MemberListFilters, MemberListRow } from "@/services/members";
import { queryKeys } from "@/services/queryKeys";
import type { AttendanceFormValues } from "@/lib/validation";
import type {
  AddAttendanceSubmissionResult,
  AttendanceLinkStatus,
  CheckInResult,
} from "@/types/database";

/*
 * An event's roster with the attendance form beside it. The components have
 * their own tests; this is about the page putting them together: the form's
 * card is there, waiting responses are counted and exported with everyone
 * else, the form's check-ins read well, the officer's existing tools (adding
 * and removing attendance) behave as they did before, anyone can be added by
 * name and email, and the page keeps itself current while people check in.
 */

const SITE = "https://washushpe.org";
const TOKEN = "0123456789abcdef0123456789abcdef";

const api = vi.hoisted(() => ({
  fetchEvent: vi.fn<(id: string) => Promise<EventWithCategory | null>>(),
  fetchEventAttendance: vi.fn<(id: string) => Promise<EventAttendee[]>>(),
  fetchAttendanceLink: vi.fn<(id: string) => Promise<AttendanceLinkStatus>>(),
  fetchWaitingSubmissions: vi.fn<(id: string) => Promise<WaitingSubmission[]>>(),
  addAttendanceSubmission:
    vi.fn<
      (eventId: string, values: AttendanceFormValues) => Promise<AddAttendanceSubmissionResult>
    >(),
  fetchMembers: vi.fn<(filters: MemberListFilters) => Promise<MemberListRow[]>>(),
  addAttendance: vi.fn<(eventId: string, memberId: string) => Promise<CheckInResult>>(),
  removeAttendance:
    vi.fn<(attendanceId: string, reason: string) => Promise<{ reversed_points: number }>>(),
  downloadCsv: vi.fn<(filename: string, content: string) => void>(),
}));

vi.mock("@/services/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/events")>()),
  fetchEvent: (id: string) => api.fetchEvent(id),
  fetchEventAttendance: (id: string) => api.fetchEventAttendance(id),
}));

vi.mock("@/services/attendanceForm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/attendanceForm")>()),
  fetchAttendanceLink: (id: string) => api.fetchAttendanceLink(id),
  fetchWaitingSubmissions: (id: string) => api.fetchWaitingSubmissions(id),
  addAttendanceSubmission: (eventId: string, values: AttendanceFormValues) =>
    api.addAttendanceSubmission(eventId, values),
  attendanceFormUrl: (token: string) => `${SITE}/attend/${token}`,
}));

vi.mock("@/services/members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/members")>()),
  fetchMembers: (filters: MemberListFilters) => api.fetchMembers(filters),
}));

vi.mock("@/services/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/admin")>()),
  addAttendance: (eventId: string, memberId: string) => api.addAttendance(eventId, memberId),
  removeAttendance: (attendanceId: string, reason: string) =>
    api.removeAttendance(attendanceId, reason),
}));

// The file is built for real (toCsv); only the browser download is faked.
vi.mock("@/lib/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csv")>()),
  downloadCsv: (filename: string, content: string) => api.downloadCsv(filename, content),
}));

vi.mock("@/features/cards/share", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("@/features/cards/qr", () => ({
  qrSvg: vi.fn((text: string) => `<svg data-text="${text}"/>`),
  qrPngBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
  downloadBlob: vi.fn(),
}));

const EVENT: EventWithCategory = {
  id: "e0000000-0000-4000-8000-000000000001",
  title: "Boeing Night",
  slug: "boeing-night",
  description: null,
  category_id: "c1",
  academic_term_id: null,
  start_at: "2026-10-14T23:30:00.000Z",
  end_at: "2026-10-15T01:00:00.000Z",
  location: "Lopata Hall 101",
  points_value: 10,
  check_in_opens_at: "2026-10-14T23:00:00.000Z",
  check_in_closes_at: "2026-10-15T01:30:00.000Z",
  status: "published",
  is_public: true,
  capacity: null,
  organizer_name: null,
  organizer_email: null,
  image_url: null,
  created_by: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  category: { id: "c1", name: "Professional", slug: "professional", color: null },
};

const ANA_FORM: EventAttendee = {
  id: "a0000000-0000-4000-8000-000000000001",
  member_id: testProfile.id,
  checked_in_at: "2026-10-14T23:05:00.000Z",
  check_in_method: "form",
  verified_by: null,
  member: {
    id: testProfile.id,
    first_name: "Ana",
    last_name: "Rivera",
    email: "ana.rivera@wustl.edu",
    graduation_year: 2028,
    major: "Computer Science",
  },
};

const WAITING: WaitingSubmission[] = [
  {
    id: "s0000000-0000-4000-8000-000000000001",
    event_id: EVENT.id,
    first_name: "Luis",
    last_name: "Ortiz",
    email: "luis.ortiz@gmail.com",
    added_by: null,
    submitted_at: "2026-10-14T23:12:00.000Z",
  },
  {
    id: "s0000000-0000-4000-8000-000000000002",
    event_id: EVENT.id,
    first_name: "Sofia",
    last_name: "Diaz",
    email: "sofia@example.com",
    added_by: null,
    submitted_at: "2026-10-14T23:20:00.000Z",
  },
];

const MARCO: MemberListRow = {
  ...testProfile,
  id: "m0000000-0000-4000-8000-000000000003",
  first_name: "Marco",
  last_name: "Silva",
  email: "marco.silva@wustl.edu",
  roles: ["member"],
};

const OFFICER = {
  isOfficer: true,
  isAdmin: false,
  roles: ["member", "officer"] as ("member" | "officer" | "admin")[],
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/attendance/:eventId" element={<AdminEventAttendance />} />
    </Routes>,
    { route: `/admin/attendance/${EVENT.id}`, auth: OFFICER },
  );
}

/** A StatCard's number, found through its label. */
function statValue(label: string) {
  const labelEl = screen.getByText(label, { selector: "p" });
  return labelEl.parentElement?.querySelector("p")?.textContent;
}

/**
 * The refetchInterval each mounted observer of a query asked for. Read from
 * react-query itself rather than by waiting 30 seconds on fake timers: what
 * matters is what the page asked for, and react-query's own tests cover that
 * it honours it (including skipping hidden tabs).
 */
function pollIntervals(queryClient: QueryClient, queryKey: QueryKey) {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  return (query?.observers ?? []).map((observer) => observer.options.refetchInterval);
}

const MINUTE = 60_000;

beforeEach(() => {
  api.fetchEvent.mockResolvedValue(EVENT);
  api.fetchEventAttendance.mockResolvedValue([ANA_FORM]);
  api.fetchAttendanceLink.mockResolvedValue({
    has_link: true,
    token: TOKEN,
    updated_at: "2026-10-12T15:00:00.000Z",
  });
  api.fetchWaitingSubmissions.mockResolvedValue(WAITING);
  api.fetchMembers.mockResolvedValue([MARCO]);
});

describe("The attendance form on the roster", () => {
  it("shows the form's link, and counts the responses waiting for an account", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "Boeing Night", level: 1 });
    expect(await screen.findByLabelText("Attendance link")).toHaveValue(`${SITE}/attend/${TOKEN}`);

    await waitFor(() => expect(statValue("Waiting for an account")).toBe("2"));
    expect(statValue("Checked in")).toBe("1");

    const waiting = screen.getByRole("table", { name: /waiting for an account/i });
    expect(within(waiting).getByText("Luis Ortiz")).toBeInTheDocument();
    expect(within(waiting).getByText("Sofia Diaz")).toBeInTheDocument();
  });

  it("labels a form check-in on the roster", async () => {
    renderPage();

    const roster = await screen.findByRole("table", { name: "Members who checked into Boeing Night" });
    const row = within(roster).getByText("Ana Rivera").closest("tr") as HTMLElement;
    expect(within(row).getByText("Form")).toBeInTheDocument();
  });

  it("leaves the waiting section out until the form is in use", async () => {
    api.fetchAttendanceLink.mockResolvedValue({ has_link: false, token: null, updated_at: null });
    api.fetchWaitingSubmissions.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByRole("button", { name: "Create attendance link" })).toBeInTheDocument();
    await waitFor(() => expect(statValue("Waiting for an account")).toBe("0"));
    expect(screen.queryByRole("heading", { name: "Waiting for an account" })).not.toBeInTheDocument();
  });

  it("still shows waiting responses after the link is gone", async () => {
    api.fetchAttendanceLink.mockResolvedValue({ has_link: false, token: null, updated_at: null });
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Waiting for an account" }),
    ).toBeInTheDocument();
  });
});

describe("Exporting attendance", () => {
  it("includes the waiting responses so the file lists everyone who came", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table", { name: /waiting for an account/i });
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(api.downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, content] = api.downloadCsv.mock.calls[0];
    expect(filename).toBe("boeing-night-attendance-wed-oct-14.csv");

    const lines = content.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^Ana Rivera,ana\.rivera@wustl\.edu,Computer Science,2028,.*,form,10$/);
    expect(lines[2]).toMatch(
      /^Luis Ortiz,luis\.ortiz@gmail\.com,,,Boeing Night,Professional,.*,form \(waiting for an account\),0$/,
    );
    expect(lines[3]).toMatch(/^Sofia Diaz,sofia@example\.com,,,.*,form \(waiting for an account\),0$/);
  });

  it("can export when the only attendance so far is waiting", async () => {
    api.fetchEventAttendance.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table", { name: /waiting for an account/i });
    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    expect(exportButton).toBeEnabled();

    await user.click(exportButton);
    expect(api.downloadCsv.mock.calls[0][1]).toContain("Luis Ortiz");
  });

  it("waits for the roster, so the file is never only the waiting list", async () => {
    api.fetchEventAttendance.mockReturnValue(new Promise<EventAttendee[]>(() => {}));
    renderPage();

    // The waiting list has loaded and has rows; the roster hasn't.
    await screen.findByRole("table", { name: /waiting for an account/i });
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("exports the roster when the waiting list won't load, and says the file is short", async () => {
    api.fetchWaitingSubmissions.mockRejectedValue({ code: "42501", message: "permission denied" });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table", { name: "Members who checked into Boeing Night" });
    // The waiting section has given up and offers a retry.
    await screen.findByRole("button", { name: "Try again" });
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    const content = api.downloadCsv.mock.calls[0][1];
    expect(content).toContain("Ana Rivera");
    expect(content.split("\r\n")).toHaveLength(2);
    expect(await screen.findByText("Some responses aren't in the export")).toBeInTheDocument();
  });
});

describe("The officer's existing tools", () => {
  it("adds an attendee from active members, as before", async () => {
    api.addAttendance.mockResolvedValue({
      ok: true,
      event_id: EVENT.id,
      event_title: EVENT.title,
      event_slug: EVENT.slug,
      attendance_id: "a2",
      checked_in_at: "2026-10-14T23:40:00.000Z",
      points_awarded: 10,
      term_id: null,
      term_points: 10,
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table", { name: "Members who checked into Boeing Night" });
    await user.click(screen.getByRole("button", { name: "Add attendee" }));

    const dialog = screen.getByRole("dialog", { name: "Add an attendee" });
    await waitFor(() =>
      expect(api.fetchMembers).toHaveBeenCalledWith({ search: "", status: "active" }),
    );
    await within(dialog).findByRole("option", { name: /Marco Silva/ });
    await user.selectOptions(within(dialog).getByLabelText("Member"), MARCO.id);
    await user.click(within(dialog).getByRole("button", { name: "Add attendee" }));

    expect(api.addAttendance).toHaveBeenCalledWith(EVENT.id, MARCO.id);
    expect(await screen.findByText("Attendance added")).toBeInTheDocument();
  });

  it("removes attendance with a reason, as before", async () => {
    api.removeAttendance.mockResolvedValue({ reversed_points: -10 });
    const user = userEvent.setup();
    renderPage();

    const roster = await screen.findByRole("table", { name: "Members who checked into Boeing Night" });
    await user.click(within(roster).getByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog", { name: "Remove attendance" });
    await user.type(within(dialog).getByLabelText(/reason/i), "Checked in by mistake");
    await user.click(within(dialog).getByRole("button", { name: "Remove attendance" }));

    expect(api.removeAttendance).toHaveBeenCalledWith(ANA_FORM.id, "Checked in by mistake");
    expect(await screen.findByText("Attendance removed")).toBeInTheDocument();
  });
});

describe("Adding someone by name and email", () => {
  const ROSA = { first_name: "Rosa", last_name: "Mendez", email: "rosa.mendez@gmail.com" };

  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole("table", { name: "Members who checked into Boeing Night" });
    await user.click(screen.getByRole("button", { name: "Add by name and email" }));
    return screen.getByRole("dialog", { name: "Add someone by name and email" });
  }

  async function fillIn(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    email = ROSA.email,
  ) {
    await user.type(within(dialog).getByLabelText(/First name/), ROSA.first_name);
    await user.type(within(dialog).getByLabelText(/Last name/), ROSA.last_name);
    await user.type(within(dialog).getByLabelText(/Email/), email);
    await user.click(within(dialog).getByRole("button", { name: "Add them" }));
  }

  it("says who it's for, and checks the fields before asking the database", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDialog(user);
    expect(dialog).toHaveTextContent(/newcomers without an account, or anyone who couldn't use the form/);
    expect(dialog).toHaveTextContent(/Members with an account can still be added with Add attendee/);

    await user.click(within(dialog).getByRole("button", { name: "Add them" }));
    // Worded for the officer, about the person being added, not "your".
    expect(await within(dialog).findByText("Enter their first name")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter their last name")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a valid email address")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Email/), "not-an-email");
    await user.click(within(dialog).getByRole("button", { name: "Add them" }));
    expect(within(dialog).getByText("Enter a valid email address")).toBeInTheDocument();
    expect(api.addAttendanceSubmission).not.toHaveBeenCalled();
  });

  it("checks in someone whose email is already on an account, and refreshes everything it touched", async () => {
    api.addAttendanceSubmission.mockResolvedValue({
      ok: true,
      status: "checked_in",
      points_awarded: 10,
    });
    const user = userEvent.setup();
    const { queryClient } = renderPage();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const dialog = await openDialog(user);
    // Typed carelessly; sent the way the database stores and matches it.
    await fillIn(user, dialog, "  Rosa.Mendez@Gmail.com ");

    expect(api.addAttendanceSubmission).toHaveBeenCalledWith(EVENT.id, ROSA);
    expect(await screen.findByText("Rosa Mendez is checked in")).toBeInTheDocument();
    expect(
      screen.getByText(
        "An account already uses rosa.mendez@gmail.com, so they're on the roster with +10 points.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    for (const queryKey of [
      queryKeys.events.attendance(EVENT.id),
      queryKeys.events.waitingSubmissions(EVENT.id),
      ["member"],
      queryKeys.admin.attendanceFeed,
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it("puts someone without an account on the waiting list", async () => {
    api.addAttendanceSubmission.mockResolvedValue({
      ok: true,
      status: "waiting",
      points_awarded: 0,
    });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, await openDialog(user));

    expect(await screen.findByText("Rosa Mendez is on the waiting list")).toBeInTheDocument();
    expect(
      screen.getByText(
        "They'll be added to the roster, points included, when they create an account with rosa.mendez@gmail.com.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says when the email is already on the event's list", async () => {
    api.addAttendanceSubmission.mockResolvedValue({
      ok: true,
      status: "already_recorded",
      points_awarded: 0,
    });
    const user = userEvent.setup();
    renderPage();

    await fillIn(user, await openDialog(user));

    expect(
      await screen.findByText("rosa.mendez@gmail.com is already on this event's list"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is checked in|is on the waiting list/)).not.toBeInTheDocument();
  });

  it("keeps what was typed when the database refuses", async () => {
    api.addAttendanceSubmission.mockRejectedValue({ code: "P0002", message: "Event not found" });
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDialog(user);
    await fillIn(user, dialog);

    expect(await screen.findByText("We couldn't add them")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Email/)).toHaveValue(ROSA.email);
  });

  it("is offered from Add attendee, for the person who turns out to have no account", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("table", { name: "Members who checked into Boeing Night" });
    await user.click(screen.getByRole("button", { name: "Add attendee" }));
    const addAttendee = screen.getByRole("dialog", { name: "Add an attendee" });
    await user.click(within(addAttendee).getByRole("button", { name: "Add them by name and email" }));

    expect(screen.queryByRole("dialog", { name: "Add an attendee" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add someone by name and email" })).toBeInTheDocument();
  });
});

describe("Keeping the page current", () => {
  it("polls the roster and the waiting list while the check-in window is open", async () => {
    const now = Date.now();
    api.fetchEvent.mockResolvedValue({
      ...EVENT,
      start_at: new Date(now).toISOString(),
      end_at: new Date(now + 60 * MINUTE).toISOString(),
      check_in_opens_at: new Date(now - 10 * MINUTE).toISOString(),
      check_in_closes_at: new Date(now + 90 * MINUTE).toISOString(),
    });
    const { queryClient } = renderPage();

    await screen.findByRole("table", { name: /waiting for an account/i });

    await waitFor(() =>
      expect(pollIntervals(queryClient, queryKeys.events.attendance(EVENT.id))).toEqual([30_000]),
    );
    // One polling observer per query: the waiting section reads the same
    // cache without a timer of its own, so it's one request per interval.
    const waiting = pollIntervals(queryClient, queryKeys.events.waitingSubmissions(EVENT.id));
    expect(waiting.filter(Boolean)).toEqual([30_000]);
    const link = pollIntervals(queryClient, queryKeys.events.attendanceLink(EVENT.id));
    expect(link.filter(Boolean)).toEqual([60_000]);
  });

  it("stops polling the roster once the window has closed, but still watches the link", async () => {
    const yesterday = Date.now() - 24 * 60 * MINUTE;
    api.fetchEvent.mockResolvedValue({
      ...EVENT,
      start_at: new Date(yesterday).toISOString(),
      end_at: new Date(yesterday + 60 * MINUTE).toISOString(),
      check_in_opens_at: new Date(yesterday - 30 * MINUTE).toISOString(),
      check_in_closes_at: new Date(yesterday + 90 * MINUTE).toISOString(),
    });
    const { queryClient } = renderPage();

    await screen.findByRole("table", { name: /waiting for an account/i });
    expect(await screen.findByText(/^Closed .+ Add by name and email if they don't\.$/)).toBeInTheDocument();

    expect(
      pollIntervals(queryClient, queryKeys.events.attendance(EVENT.id)).filter(Boolean),
    ).toEqual([]);
    expect(
      pollIntervals(queryClient, queryKeys.events.waitingSubmissions(EVENT.id)).filter(Boolean),
    ).toEqual([]);
    expect(
      pollIntervals(queryClient, queryKeys.events.attendanceLink(EVENT.id)).filter(Boolean),
    ).toEqual([60_000]);
  });
});

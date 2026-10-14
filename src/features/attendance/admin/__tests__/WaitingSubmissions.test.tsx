import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders, testProfile } from "@/test/renderWithProviders";
import type { WaitingSubmission } from "@/services/attendanceForm";
import type { MemberListFilters, MemberListRow } from "@/services/members";
import { queryKeys } from "@/services/queryKeys";
import type { AttendanceLinkStatus, CheckInResult } from "@/types/database";
import { WaitingSubmissions } from "../WaitingSubmissions";

/*
 * Form responses waiting for an account. Whether a link or a delete is
 * allowed is the database's call; here it's that each action asks the right
 * question, calls the right RPC with the right ids, and reports the answer in
 * words an officer can act on.
 */

const api = vi.hoisted(() => ({
  fetchWaitingSubmissions: vi.fn<(eventId: string) => Promise<WaitingSubmission[]>>(),
  fetchAttendanceLink: vi.fn<(eventId: string) => Promise<AttendanceLinkStatus>>(),
  deleteAttendanceSubmission: vi.fn<(id: string) => Promise<void>>(),
  deleteWaitingSubmissionsBefore: vi.fn<(eventId: string, before: string) => Promise<number>>(),
  linkAttendanceSubmission: vi.fn<(id: string, memberId: string) => Promise<CheckInResult>>(),
  fetchMembers: vi.fn<(filters: MemberListFilters) => Promise<MemberListRow[]>>(),
}));

vi.mock("@/services/attendanceForm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/attendanceForm")>()),
  fetchWaitingSubmissions: (eventId: string) => api.fetchWaitingSubmissions(eventId),
  fetchAttendanceLink: (eventId: string) => api.fetchAttendanceLink(eventId),
  deleteAttendanceSubmission: (id: string) => api.deleteAttendanceSubmission(id),
  deleteWaitingSubmissionsBefore: (eventId: string, before: string) =>
    api.deleteWaitingSubmissionsBefore(eventId, before),
  linkAttendanceSubmission: (id: string, memberId: string) =>
    api.linkAttendanceSubmission(id, memberId),
}));

vi.mock("@/services/members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/members")>()),
  fetchMembers: (filters: MemberListFilters) => api.fetchMembers(filters),
}));

const EVENT = { id: "e0000000-0000-4000-8000-000000000001", title: "Boeing Night" };

const LUIS: WaitingSubmission = {
  id: "s0000000-0000-4000-8000-000000000001",
  event_id: EVENT.id,
  first_name: "Luis",
  last_name: "Ortiz",
  email: "luis.ortiz@gmail.com",
  added_by: null,
  submitted_at: "2026-10-14T23:12:00.000Z",
};

const SPAM: WaitingSubmission = {
  id: "s0000000-0000-4000-8000-000000000002",
  event_id: EVENT.id,
  first_name: "Free",
  last_name: "Crypto",
  email: "spam@example.com",
  added_by: null,
  submitted_at: "2026-10-14T23:20:00.000Z",
};

/** Typed in by an officer for a newcomer with no phone. */
const NEWCOMER: WaitingSubmission = {
  id: "s0000000-0000-4000-8000-000000000003",
  event_id: EVENT.id,
  first_name: "Rosa",
  last_name: "Mendez",
  email: "rosa.mendez@gmail.com",
  added_by: testProfile.id,
  submitted_at: "2026-10-14T23:08:00.000Z",
};

/** Made before anything arrived, and never replaced. */
const LINK: AttendanceLinkStatus = {
  has_link: true,
  token: "0123456789abcdef0123456789abcdef",
  updated_at: "2026-10-12T15:00:00.000Z",
};

/** Replaced at 6:15 PM, between Luis's response and the spam. */
const REPLACED_LINK: AttendanceLinkStatus = {
  ...LINK,
  token: "fedcba9876543210fedcba9876543210",
  updated_at: "2026-10-14T23:15:00.000Z",
};

/** Luis's real account, under his school address and still pending approval. */
const LUIS_ACCOUNT: MemberListRow = {
  ...testProfile,
  id: "m0000000-0000-4000-8000-000000000001",
  first_name: "Luis",
  last_name: "Ortiz",
  email: "l.ortiz@wustl.edu",
  membership_status: "pending",
  roles: ["member"],
};

const OTHER_ORTIZ: MemberListRow = {
  ...testProfile,
  id: "m0000000-0000-4000-8000-000000000002",
  first_name: "Maria",
  last_name: "Ortiz",
  email: "maria.ortiz@wustl.edu",
  membership_status: "active",
  roles: ["member"],
};

const OFFICER = {
  isOfficer: true,
  isAdmin: false,
  roles: ["member", "officer"] as ("member" | "officer" | "admin")[],
};

function renderSection(checkedInIds?: ReadonlySet<string>) {
  return renderWithProviders(<WaitingSubmissions event={EVENT} checkedInIds={checkedInIds} />, {
    auth: OFFICER,
    route: `/admin/attendance/${EVENT.id}`,
  });
}

/** The desktop table's row for a response. (jsdom renders the mobile list too.) */
async function tableRow(name: string) {
  const table = await screen.findByRole("table", { name: /waiting for an account/i });
  const cell = within(table).getByText(name);
  return cell.closest("tr") as HTMLElement;
}

beforeEach(() => {
  api.fetchWaitingSubmissions.mockResolvedValue([LUIS, SPAM]);
  api.fetchAttendanceLink.mockResolvedValue(LINK);
  api.deleteAttendanceSubmission.mockResolvedValue(undefined);
  api.fetchMembers.mockResolvedValue([LUIS_ACCOUNT, OTHER_ORTIZ]);
});

describe("The waiting list", () => {
  it("lists each response with its name, email and time, and explains what happens next", async () => {
    renderSection();

    const luis = await tableRow("Luis Ortiz");
    expect(within(luis).getByText("luis.ortiz@gmail.com")).toBeInTheDocument();
    expect(within(luis).getByText("6:12 PM")).toBeInTheDocument();
    expect(await tableRow("Free Crypto")).toBeInTheDocument();

    expect(api.fetchWaitingSubmissions).toHaveBeenCalledWith(EVENT.id);
    expect(screen.getByText(/added to the roster, points included, as soon as an account is created/)).toBeInTheDocument();
  });

  it("says nobody is waiting when every response matched an account", async () => {
    api.fetchWaitingSubmissions.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText("Nobody is waiting")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("marks the responses an officer typed in, and only those", async () => {
    api.fetchWaitingSubmissions.mockResolvedValue([NEWCOMER, LUIS]);
    renderSection();

    expect(within(await tableRow("Rosa Mendez")).getByText("Added by an officer")).toBeInTheDocument();
    expect(within(await tableRow("Luis Ortiz")).queryByText("Added by an officer")).not.toBeInTheDocument();
  });
});

describe("Clearing the responses from a replaced link", () => {
  const clearButton = /^Delete \d+ responses? from the replaced link$/;

  it("isn't offered while the link has never been replaced", async () => {
    renderSection();

    await tableRow("Free Crypto");
    expect(screen.queryByRole("button", { name: clearButton })).not.toBeInTheDocument();
  });

  it("isn't offered once the event has no link", async () => {
    api.fetchAttendanceLink.mockResolvedValue({ has_link: false, token: null, updated_at: null });
    renderSection();

    await tableRow("Free Crypto");
    expect(screen.queryByRole("button", { name: clearButton })).not.toBeInTheDocument();
  });

  it("counts only form responses from before the replacement, and asks before deleting them", async () => {
    // Luis came through the old link; the newcomer was typed in before the
    // replacement too, but by an officer; the spam came through the new link.
    api.fetchWaitingSubmissions.mockResolvedValue([NEWCOMER, LUIS, SPAM]);
    api.fetchAttendanceLink.mockResolvedValue(REPLACED_LINK);
    api.deleteWaitingSubmissionsBefore.mockResolvedValue(1);
    const user = userEvent.setup();
    renderSection();

    const button = await screen.findByRole("button", {
      name: "Delete 1 response from the replaced link",
    });
    await user.click(button);

    const dialog = screen.getByRole("dialog", { name: "Delete 1 response from the replaced link?" });
    expect(dialog).toHaveTextContent(/came through the old link before it was replaced/);
    expect(dialog).toHaveTextContent(/If the old link leaked, this clears whatever was scripted through it/);
    expect(dialog).toHaveTextContent(/Anyone real among them who has no account yet is removed too/);
    expect(dialog).toHaveTextContent(/fill in the form again with the new link, or you can add them by name/);
    expect(dialog).toHaveTextContent(/Responses officers typed in, and anyone already on the roster, are kept/);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.deleteWaitingSubmissionsBefore).not.toHaveBeenCalled();

    api.fetchWaitingSubmissions.mockResolvedValue([NEWCOMER, SPAM]);
    await user.click(screen.getByRole("button", { name: "Delete 1 response from the replaced link" }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Delete 1 response from the replaced link?" }),
      ).getByRole("button", { name: "Delete 1 response" }),
    );

    // The cut-off is the replacement time, so nothing from the new link goes.
    expect(api.deleteWaitingSubmissionsBefore).toHaveBeenCalledWith(
      EVENT.id,
      REPLACED_LINK.updated_at,
    );
    expect(await screen.findByText("Deleted 1 response from the replaced link")).toBeInTheDocument();
    // Refetched: Luis is gone, and with him the reason for the button.
    await waitFor(() => expect(screen.queryByText("luis.ortiz@gmail.com")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: clearButton })).not.toBeInTheDocument();
    expect(screen.getAllByText("Rosa Mendez").length).toBeGreaterThan(0);
  });

  it("deletes what the officer was asked about, even if the link is replaced again meanwhile", async () => {
    // A bot from before the first replacement at 6:15 PM, and the spam from
    // 6:20 PM, which came through the link that replaced it.
    const BOT: WaitingSubmission = {
      ...SPAM,
      id: "s0000000-0000-4000-8000-000000000101",
      email: "bot@example.com",
      submitted_at: "2026-10-14T23:05:00.000Z",
    };
    api.fetchWaitingSubmissions.mockResolvedValue([BOT, SPAM]);
    api.fetchAttendanceLink.mockResolvedValue(REPLACED_LINK);
    api.deleteWaitingSubmissionsBefore.mockResolvedValue(1);
    const user = userEvent.setup();
    const { queryClient } = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Delete 1 response from the replaced link" }),
    );
    screen.getByRole("dialog", { name: "Delete 1 response from the replaced link?" });

    // While the confirmation is open, the link's poll brings in a second
    // replacement, which puts the spam from 6:20 PM before the cut-off too.
    api.fetchAttendanceLink.mockResolvedValue({
      ...REPLACED_LINK,
      token: "00000000000000000000000000000000",
      updated_at: "2026-10-14T23:25:00.000Z",
    });
    await queryClient.refetchQueries({ queryKey: queryKeys.events.attendanceLink(EVENT.id) });
    await screen.findByText(/^2 of these came through the old link/);

    const dialog = screen.getByRole("dialog", { name: "Delete 1 response from the replaced link?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete 1 response" }));

    expect(api.deleteWaitingSubmissionsBefore).toHaveBeenCalledWith(
      EVENT.id,
      REPLACED_LINK.updated_at,
    );
  });

  it("counts several and says plainly when another officer got there first", async () => {
    const early = (n: number): WaitingSubmission => ({
      ...SPAM,
      id: `s0000000-0000-4000-8000-00000000010${n}`,
      first_name: `Bot${n}`,
      email: `bot${n}@example.com`,
      submitted_at: `2026-10-14T23:0${n}:00.000Z`,
    });
    api.fetchWaitingSubmissions.mockResolvedValue([early(1), early(2), early(3)]);
    api.fetchAttendanceLink.mockResolvedValue(REPLACED_LINK);
    api.deleteWaitingSubmissionsBefore.mockResolvedValue(0);
    const user = userEvent.setup();
    renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Delete 3 responses from the replaced link" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete 3 responses from the replaced link?" });
    expect(dialog).toHaveTextContent(/These 3 responses came through the old link/);
    await user.click(within(dialog).getByRole("button", { name: "Delete 3 responses" }));

    expect(await screen.findByText("Nothing left to delete")).toBeInTheDocument();
  });

  it("reports a clear-out the database refused", async () => {
    api.fetchWaitingSubmissions.mockResolvedValue([LUIS]);
    api.fetchAttendanceLink.mockResolvedValue(REPLACED_LINK);
    api.deleteWaitingSubmissionsBefore.mockRejectedValue({
      code: "42501",
      message: "Only officers can do that",
    });
    const user = userEvent.setup();
    renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Delete 1 response from the replaced link" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete 1 response" }));

    expect(await screen.findByText("We couldn't delete those responses")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Deleting a response", () => {
  it("asks first, naming the person and email, and then deletes it", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(within(await tableRow("Free Crypto")).getByRole("button", { name: /^Delete/ }));

    const dialog = screen.getByRole("dialog", { name: "Delete this response?" });
    expect(dialog).toHaveTextContent("Free Crypto");
    expect(dialog).toHaveTextContent("spam@example.com");
    expect(api.deleteAttendanceSubmission).not.toHaveBeenCalled();

    api.fetchWaitingSubmissions.mockResolvedValue([LUIS]);
    await user.click(within(dialog).getByRole("button", { name: "Delete response" }));

    expect(api.deleteAttendanceSubmission).toHaveBeenCalledWith(SPAM.id);
    expect(await screen.findByText("Response deleted")).toBeInTheDocument();
    // The list is fetched again, and the deleted row is gone.
    await waitFor(() => expect(screen.queryByText("spam@example.com")).not.toBeInTheDocument());
  });

  it("reports a delete the database refused", async () => {
    api.deleteAttendanceSubmission.mockRejectedValue({
      code: "P0002",
      message: "That response no longer exists",
    });
    const user = userEvent.setup();
    renderSection();

    await user.click(within(await tableRow("Free Crypto")).getByRole("button", { name: /^Delete/ }));
    await user.click(screen.getByRole("button", { name: "Delete response" }));

    expect(await screen.findByText("We couldn't delete that response")).toBeInTheDocument();
    expect(screen.getByText("That response no longer exists")).toBeInTheDocument();
  });
});

describe("Linking a response to a member", () => {
  async function openLinkDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      within(await tableRow("Luis Ortiz")).getByRole("button", { name: /^Link to member/ }),
    );
    return screen.getByRole("dialog", { name: "Link to a member" });
  }

  it("searches every account, pending ones included, and links the chosen member", async () => {
    api.linkAttendanceSubmission.mockResolvedValue({
      ok: true,
      event_id: EVENT.id,
      event_title: EVENT.title,
      event_slug: "boeing-night",
      attendance_id: "a1",
      checked_in_at: "2026-10-14T23:30:00.000Z",
      points_awarded: 10,
      term_id: null,
      term_points: 10,
    });
    const user = userEvent.setup();
    renderSection();

    const dialog = await openLinkDialog(user);
    expect(dialog).toHaveTextContent("luis.ortiz@gmail.com");
    // Starts from the name they gave, across all statuses.
    expect(within(dialog).getByLabelText("Search members")).toHaveValue("Ortiz");
    await waitFor(() =>
      expect(api.fetchMembers).toHaveBeenCalledWith({ search: "Ortiz", status: "all" }),
    );

    const select = within(dialog).getByLabelText("Member");
    const pendingOption = await within(dialog).findByRole("option", {
      name: "Luis Ortiz — l.ortiz@wustl.edu (pending approval)",
    });
    expect(pendingOption).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Link response" })).toBeDisabled();

    await user.selectOptions(select, LUIS_ACCOUNT.id);
    await user.click(within(dialog).getByRole("button", { name: "Link response" }));

    expect(api.linkAttendanceSubmission).toHaveBeenCalledWith(LUIS.id, LUIS_ACCOUNT.id);
    expect(await screen.findByText("Response linked to Luis Ortiz")).toBeInTheDocument();
    expect(screen.getByText("They're on the roster with +10 points.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("treats a member already on the roster as linked, without extra points", async () => {
    api.linkAttendanceSubmission.mockResolvedValue({
      ok: false,
      code: "ALREADY_CHECKED_IN",
      event_title: EVENT.title,
    });
    const user = userEvent.setup();
    renderSection(new Set([OTHER_ORTIZ.id]));

    const dialog = await openLinkDialog(user);
    await within(dialog).findByRole("option", {
      name: "Maria Ortiz — maria.ortiz@wustl.edu (already checked in)",
    });
    await user.selectOptions(within(dialog).getByLabelText("Member"), OTHER_ORTIZ.id);
    await user.click(within(dialog).getByRole("button", { name: "Link response" }));

    expect(api.linkAttendanceSubmission).toHaveBeenCalledWith(LUIS.id, OTHER_ORTIZ.id);
    expect(await screen.findByText("Response linked to Maria Ortiz")).toBeInTheDocument();
    expect(
      screen.getByText("Maria Ortiz was already on the roster, so no extra points were awarded."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and explains a link that failed", async () => {
    api.linkAttendanceSubmission.mockRejectedValue({
      code: "22023",
      message: "That response is already on a member's record",
    });
    const user = userEvent.setup();
    renderSection();

    const dialog = await openLinkDialog(user);
    await within(dialog).findByRole("option", { name: /Luis Ortiz — l\.ortiz@wustl\.edu/ });
    await user.selectOptions(within(dialog).getByLabelText("Member"), LUIS_ACCOUNT.id);
    await user.click(within(dialog).getByRole("button", { name: "Link response" }));

    expect(await screen.findByText("We couldn't link that response")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Link to a member" })).toBeInTheDocument();
  });
});

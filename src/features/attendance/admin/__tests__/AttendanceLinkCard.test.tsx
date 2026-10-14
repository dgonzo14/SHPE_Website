import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test/renderWithProviders";
import { queryKeys } from "@/services/queryKeys";
import type { AttendanceLinkStatus } from "@/types/database";
import { AttendanceLinkCard, type AttendanceLinkEvent } from "../AttendanceLinkCard";
import { LINK_REFRESH_MS } from "../useAttendanceForm";

/*
 * The officer's controls for an event's attendance form. Whether a link works
 * is the database's business (supabase/tests); here it's what the card offers
 * and that each control calls what it should with the absolute URL.
 */

const SITE = "https://washushpe.org";
const TOKEN = "0123456789abcdef0123456789abcdef";
const NEW_TOKEN = "fedcba9876543210fedcba9876543210";
const URL_FOR = (token: string) => `${SITE}/attend/${token}`;

const api = vi.hoisted(() => ({
  fetchAttendanceLink: vi.fn<(eventId: string) => Promise<AttendanceLinkStatus>>(),
  createAttendanceLink: vi.fn<(eventId: string) => Promise<AttendanceLinkStatus>>(),
  rotateAttendanceLink: vi.fn<(eventId: string) => Promise<AttendanceLinkStatus>>(),
}));
vi.mock("@/services/attendanceForm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/attendanceForm")>()),
  fetchAttendanceLink: (eventId: string) => api.fetchAttendanceLink(eventId),
  createAttendanceLink: (eventId: string) => api.createAttendanceLink(eventId),
  rotateAttendanceLink: (eventId: string) => api.rotateAttendanceLink(eventId),
  attendanceFormUrl: (token: string) => URL_FOR(token),
}));

const share = vi.hoisted(() => ({
  copyText: vi.fn<(text: string) => Promise<boolean>>(async () => true),
}));
vi.mock("@/features/cards/share", () => share);

const qr = vi.hoisted(() => ({
  qrSvg: vi.fn((text: string) => `<svg data-text="${text}"/>`),
  qrPngBlob: vi.fn<(text: string, opts?: unknown) => Promise<Blob>>(
    async () => new Blob(["png"], { type: "image/png" }),
  ),
  downloadBlob: vi.fn<(blob: Blob, filename: string) => void>(),
}));
vi.mock("@/features/cards/qr", () => qr);

const OFFICER = {
  isOfficer: true,
  isAdmin: false,
  roles: ["member", "officer"] as ("member" | "officer" | "admin")[],
};

const MINUTE = 60_000;

/** An event whose check-in window is open right now, by the real clock. */
function openEvent(overrides: Partial<AttendanceLinkEvent> = {}): AttendanceLinkEvent {
  const now = Date.now();
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    title: "Boeing Night",
    slug: "boeing-night",
    status: "published",
    start_at: new Date(now).toISOString(),
    end_at: new Date(now + 60 * MINUTE).toISOString(),
    check_in_opens_at: new Date(now - 10 * MINUTE).toISOString(),
    check_in_closes_at: new Date(now + 90 * MINUTE).toISOString(),
    ...overrides,
  };
}

const LINK: AttendanceLinkStatus = {
  has_link: true,
  token: TOKEN,
  updated_at: "2026-10-12T15:00:00.000Z",
};

function renderCard(event: AttendanceLinkEvent = openEvent()) {
  return renderWithProviders(<AttendanceLinkCard event={event} />, {
    auth: OFFICER,
    route: `/admin/attendance/${event.id}`,
  });
}

beforeEach(() => {
  api.fetchAttendanceLink.mockResolvedValue(LINK);
  api.createAttendanceLink.mockResolvedValue({ ...LINK, created: true });
  api.rotateAttendanceLink.mockResolvedValue({ ...LINK, token: NEW_TOKEN, created: false });
  share.copyText.mockResolvedValue(true);
});

const NO_LINK: AttendanceLinkStatus = { has_link: false, token: null, updated_at: null };

describe("Creating the link", () => {
  it("explains the form and creates a link when the event has none", async () => {
    api.fetchAttendanceLink.mockResolvedValue(NO_LINK);
    const user = userEvent.setup();
    const event = openEvent();
    renderCard(event);

    const create = await screen.findByRole("button", { name: "Create attendance link" });
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Attendance link")).not.toBeInTheDocument();

    await user.click(create);

    // Create, never rotate: a stale Create must not replace a live link.
    expect(api.createAttendanceLink).toHaveBeenCalledWith(event.id);
    expect(api.rotateAttendanceLink).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("Attendance link")).toHaveValue(URL_FOR(TOKEN));
    expect(await screen.findByText("Attendance link created")).toBeInTheDocument();
    // The RPC's answer is the new state; nothing is fetched again.
    expect(api.fetchAttendanceLink).toHaveBeenCalledTimes(1);
  });

  it("shows another officer's link, untouched, when they made one first", async () => {
    // This page loaded before the other officer pressed Create.
    api.fetchAttendanceLink.mockResolvedValue(NO_LINK);
    api.createAttendanceLink.mockResolvedValue({ ...LINK, created: false });
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Create attendance link" }));

    expect(await screen.findByLabelText("Attendance link")).toHaveValue(URL_FOR(TOKEN));
    expect(await screen.findByText("Another officer already made the link")).toBeInTheDocument();
    expect(screen.getByText(/Nothing was replaced/)).toBeInTheDocument();
    expect(screen.queryByText("Attendance link created")).not.toBeInTheDocument();
    expect(api.rotateAttendanceLink).not.toHaveBeenCalled();
  });

  it("says so when the link can't be created", async () => {
    api.fetchAttendanceLink.mockResolvedValue(NO_LINK);
    api.createAttendanceLink.mockRejectedValue({ code: "42501", message: "permission denied" });
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Create attendance link" }));

    expect(await screen.findByText("We couldn't create the link")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create attendance link" })).toBeEnabled();
  });
});

describe("Keeping the link current", () => {
  it("re-reads the link every minute, so a projected code follows a replacement", async () => {
    const { queryClient } = renderCard();
    await screen.findByLabelText("Attendance link");

    const query = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.events.attendanceLink(openEvent().id), exact: true });
    expect(query?.observers.map((o) => o.options.refetchInterval)).toEqual([LINK_REFRESH_MS]);
    expect(LINK_REFRESH_MS).toBe(60_000);
  });
});

describe("Sharing the link", () => {
  it("shows the absolute URL and copies it", async () => {
    const user = userEvent.setup();
    renderCard();

    const input = await screen.findByLabelText("Attendance link");
    expect(input).toHaveValue(URL_FOR(TOKEN));
    expect(input).toHaveAttribute("readonly");

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(share.copyText).toHaveBeenCalledWith(URL_FOR(TOKEN));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("tells the officer to copy it by hand when the clipboard refuses", async () => {
    share.copyText.mockResolvedValue(false);
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument();
  });

  it("draws the QR code of the URL in black and white", async () => {
    renderCard();

    const image = await screen.findByAltText(`QR code that opens the attendance form at ${URL_FOR(TOKEN)}`);
    expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(qr.qrSvg).toHaveBeenCalledWith(
      URL_FOR(TOKEN),
      expect.objectContaining({ fg: "#000000", bg: "#ffffff" }),
    );
  });

  it("downloads the code as PNG and SVG, named after the event", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Download PNG" }));
    await waitFor(() =>
      expect(qr.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "boeing-night-attendance-qr.png"),
    );
    expect(qr.qrPngBlob).toHaveBeenCalledWith(
      URL_FOR(TOKEN),
      expect.objectContaining({ scale: 16, fg: "#000000", bg: "#ffffff" }),
    );

    await user.click(screen.getByRole("button", { name: "Download SVG" }));
    expect(qr.downloadBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      "boeing-night-attendance-qr.svg",
    );
  });

  it("explains a PNG that couldn't be drawn", async () => {
    qr.qrPngBlob.mockRejectedValueOnce(
      new Error("Your browser couldn't draw the QR code. Try the SVG download instead."),
    );
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Download PNG" }));

    expect(await screen.findByText("Couldn't make the PNG")).toBeInTheDocument();
    expect(qr.downloadBlob).not.toHaveBeenCalled();
  });
});

describe("Showing the code full screen", () => {
  it("opens over the page, closes with Escape and gives focus back", async () => {
    const user = userEvent.setup();
    renderCard();

    const opener = await screen.findByRole("button", { name: "Show QR full screen" });
    await user.click(opener);

    const presenter = screen.getByRole("dialog", { name: "Boeing Night" });
    expect(presenter).toHaveAttribute("aria-modal", "true");
    expect(within(presenter).getByText("Scan to check in")).toBeInTheDocument();
    expect(within(presenter).getByText(URL_FOR(TOKEN))).toBeInTheDocument();
    expect(
      within(presenter).getByAltText(`QR code that opens the attendance form at ${URL_FOR(TOKEN)}`),
    ).toBeInTheDocument();
    expect(within(presenter).getByRole("button", { name: "Close" })).toHaveFocus();

    // Tab stays on Close rather than wandering into the page underneath.
    await user.tab();
    expect(within(presenter).getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes with the Close button too", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Show QR full screen" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show QR full screen" })).toHaveFocus();
  });
});

describe("Replacing the link", () => {
  it("asks first, saying what stops working, and only then replaces it", async () => {
    const user = userEvent.setup();
    const event = openEvent();
    renderCard(event);

    await user.click(await screen.findByRole("button", { name: "Replace link" }));

    const dialog = screen.getByRole("dialog", { name: "Replace the attendance link?" });
    expect(dialog).toHaveTextContent(/every copy of its QR code stop working immediately/);
    expect(dialog).toHaveTextContent(/hasn't checked in yet will need the new one/);
    expect(api.rotateAttendanceLink).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.rotateAttendanceLink).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Replace link" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Replace the attendance link?" })).getByRole(
        "button",
        { name: "Replace link" },
      ),
    );

    expect(api.rotateAttendanceLink).toHaveBeenCalledWith(event.id);
    expect(api.createAttendanceLink).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText("Attendance link")).toHaveValue(URL_FOR(NEW_TOKEN)),
    );
    expect(await screen.findByText("Attendance link replaced")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the new link when a read of the old one, already on its way, lands afterwards", async () => {
    const user = userEvent.setup();
    const event = openEvent();
    const { queryClient } = renderCard(event);
    await screen.findByLabelText("Attendance link");

    // The minute's poll leaves before the replacement commits and is slow to
    // come back, so what it carries is the link as it was: the old one.
    let landPoll: (status: AttendanceLinkStatus) => void = () => {};
    api.fetchAttendanceLink.mockReturnValue(
      new Promise<AttendanceLinkStatus>((resolve) => {
        landPoll = resolve;
      }),
    );
    void queryClient.refetchQueries({ queryKey: queryKeys.events.attendanceLink(event.id) });
    await waitFor(() => expect(api.fetchAttendanceLink).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: "Replace link" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Replace the attendance link?" })).getByRole(
        "button",
        { name: "Replace link" },
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Attendance link")).toHaveValue(URL_FOR(NEW_TOKEN)),
    );

    landPoll(LINK);
    // Give the stale answer every chance to land before looking.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByLabelText("Attendance link")).toHaveValue(URL_FOR(NEW_TOKEN));
  });
});

describe("The window line", () => {
  it("says the form is taking responses during the window", async () => {
    const event = openEvent();
    renderCard(event);

    expect(await screen.findByText(/^Taking responses now, until /)).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change the window" })).toHaveAttribute(
      "href",
      `/admin/events/${event.id}`,
    );
  });

  it("says when it opens before the window", async () => {
    const later = Date.now() + 3 * 24 * 60 * MINUTE;
    renderCard(
      openEvent({
        start_at: new Date(later + 30 * MINUTE).toISOString(),
        end_at: new Date(later + 90 * MINUTE).toISOString(),
        check_in_opens_at: new Date(later).toISOString(),
        check_in_closes_at: new Date(later + 2 * 60 * MINUTE).toISOString(),
      }),
    );

    expect(await screen.findByText(/^Opens .+ at .+ and closes /)).toBeInTheDocument();
    expect(screen.getByText("Not open yet")).toBeInTheDocument();
  });

  it("asks for a draft to be published", async () => {
    const event = openEvent({ status: "draft" });
    renderCard(event);

    expect(
      await screen.findByText(/^Publish the event before the form can take responses/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Publish the event" })).toHaveAttribute(
      "href",
      `/admin/events/${event.id}`,
    );
  });
});

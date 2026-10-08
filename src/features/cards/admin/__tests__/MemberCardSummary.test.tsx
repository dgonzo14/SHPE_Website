import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemberCardSummary } from "../MemberCardSummary";
import { renderWithProviders } from "@/test/renderWithProviders";
import type {
  AdminCardRow,
  AdminCardsResponse,
  AdminCreateCardResult,
  AppConfig,
  ReleaseCardHandleResult,
} from "@/types/database";

/*
 * The business card section of a member's detail page. It reads the same admin
 * list as Admin → Business Cards, so these tests feed that list and check the
 * one member's row is the one described.
 */

const fetchAdminCards = vi.fn<() => Promise<AdminCardsResponse>>();
const adminSuggestCardHandle = vi.fn<(memberId: string) => Promise<string | null>>();
const adminCreateCard =
  vi.fn<
    (memberId: string, opts: { handle?: string | null; publish?: boolean }) => Promise<AdminCreateCardResult>
  >();
const fetchAppConfig = vi.fn<() => Promise<AppConfig>>();
const adminReleaseCardHandle =
  vi.fn<(memberId: string, handle: string, reason: string) => Promise<ReleaseCardHandleResult>>();

vi.mock("@/services/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cards")>()),
  fetchAdminCards: () => fetchAdminCards(),
  adminSuggestCardHandle: (id: string) => adminSuggestCardHandle(id),
  adminCreateCard: (id: string, opts: { handle?: string | null; publish?: boolean }) =>
    adminCreateCard(id, opts),
  adminReleaseCardHandle: (id: string, handle: string, reason: string) =>
    adminReleaseCardHandle(id, handle, reason),
  cardUrl: (handle: string, source?: string) =>
    `https://washushpe.org/card/${handle}${source && source !== "link" ? `?src=${source}` : ""}`,
}));

vi.mock("@/services/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/content")>()),
  fetchAppConfig: () => fetchAppConfig(),
}));

const MEMBER = {
  id: "b0000000-0000-4000-8000-000000000001",
  first_name: "Luis",
  last_name: "Mendez",
  email: "l.mendez@wustl.edu",
  membership_status: "active" as const,
};

function row(overrides: Partial<AdminCardRow> = {}): AdminCardRow {
  return {
    member_id: MEMBER.id,
    first_name: MEMBER.first_name,
    last_name: MEMBER.last_name,
    email: MEMBER.email,
    membership_status: "active",
    handle: null,
    status: "none",
    is_published: false,
    hidden_at: null,
    hidden_reason: null,
    created_by_officer: false,
    member_opened_at: null,
    chip_handle: null,
    chip_handle_active: null,
    old_handles: [],
    chip_written_at: null,
    position: null,
    views_30d: 0,
    updated_at: null,
    ...overrides,
  };
}

const OTHER = row({ member_id: "b0000000-0000-4000-8000-000000000002", first_name: "Other" });
const OFFICER = { isOfficer: true, roles: ["member", "officer"] as ("member" | "officer")[] };

beforeEach(() => {
  fetchAppConfig.mockResolvedValue({ cards_enabled: true });
});

describe("MemberCardSummary", () => {
  it("offers Create card to a member without one, with the suggested handle", async () => {
    fetchAdminCards.mockResolvedValue({ enabled: true, rows: [OTHER, row()] });
    adminSuggestCardHandle.mockResolvedValue("luis-mendez");
    adminCreateCard.mockResolvedValue({
      ok: true,
      member_id: MEMBER.id,
      handle: "luis-mendez",
      is_published: true,
    });
    const user = userEvent.setup();
    renderWithProviders(<MemberCardSummary member={MEMBER} />, {
      route: `/admin/members/${MEMBER.id}`,
      auth: OFFICER,
    });

    expect(await screen.findByText("No card")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create card" }));

    const dialog = await screen.findByRole("dialog", { name: "Create a card for Luis Mendez" });
    expect(await within(dialog).findByLabelText(/handle/i)).toHaveValue("luis-mendez");
    await user.click(within(dialog).getByRole("checkbox", { name: /starter card/i }));
    await user.click(within(dialog).getByRole("button", { name: "Create card" }));

    await waitFor(() =>
      expect(adminCreateCard).toHaveBeenCalledWith(MEMBER.id, {
        handle: "luis-mendez",
        publish: true,
      }),
    );
    expect(await screen.findByText(/published as a starter card/i)).toBeInTheDocument();
    // The list is asked for again, so the section updates to the new card.
    await waitFor(() => expect(fetchAdminCards).toHaveBeenCalledTimes(2));
  });

  it("summarises an existing card: status, live handle, chip and position", async () => {
    fetchAdminCards.mockResolvedValue({
      enabled: true,
      rows: [
        row({
          handle: "luis-mendez",
          status: "published",
          is_published: true,
          member_opened_at: "2026-09-01T00:00:00.000Z",
          chip_handle: "luis-mendez",
          chip_written_at: "2026-09-25T23:00:00.000Z",
          position: "Treasurer",
          views_30d: 7,
        }),
      ],
    });
    renderWithProviders(<MemberCardSummary member={MEMBER} />, {
      route: `/admin/members/${MEMBER.id}`,
      auth: OFFICER,
    });

    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /luis-mendez/ })).toHaveAttribute(
      "href",
      "/card/luis-mendez",
    );
    expect(screen.getByText(/written/i)).toHaveTextContent("Written September 25, 2026");
    expect(screen.getByText("Treasurer")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create card" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in business cards/i })).toHaveAttribute(
      "href",
      "/admin/cards?q=l.mendez%40wustl.edu",
    );
  });

  it("lists the member's old handles, each one releasable", async () => {
    fetchAdminCards.mockResolvedValue({
      enabled: true,
      rows: [
        row({
          handle: "luis-mendez",
          status: "member",
          member_opened_at: "2026-09-01T00:00:00.000Z",
          old_handles: ["ana-rivera"],
        }),
      ],
    });
    adminReleaseCardHandle.mockResolvedValue({
      ok: true,
      handle: "ana-rivera",
      was_current: false,
      new_handle: null,
    });
    const user = userEvent.setup();
    renderWithProviders(<MemberCardSummary member={MEMBER} />, {
      route: `/admin/members/${MEMBER.id}`,
      auth: OFFICER,
    });

    expect(await screen.findByText("ana-rivera")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Release ana-rivera from Luis Mendez's card" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Release ana-rivera from Luis Mendez's card?",
    });
    await user.type(within(dialog).getByLabelText(/reason/i), "Another member's name");
    await user.click(within(dialog).getByRole("button", { name: "Release handle" }));

    await waitFor(() =>
      expect(adminReleaseCardHandle).toHaveBeenCalledWith(
        MEMBER.id,
        "ana-rivera",
        "Another member's name",
      ),
    );
    expect(await screen.findByText("Released ana-rivera")).toBeInTheDocument();
  });

  it("explains that a pending member has to be approved first", async () => {
    fetchAdminCards.mockResolvedValue({ enabled: true, rows: [OTHER] });
    renderWithProviders(
      <MemberCardSummary member={{ ...MEMBER, membership_status: "pending" }} />,
      { route: `/admin/members/${MEMBER.id}`, auth: OFFICER },
    );

    expect(await screen.findByText(/approve their account first/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create card" })).not.toBeInTheDocument();
  });
});

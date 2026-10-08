import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemberPositionCard } from "../MemberPositionCard";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { AdminCardRow, AdminCardsResponse } from "@/types/database";

/*
 * The position picker on a member's detail page. Who may set a position, and
 * that it grants nothing, is asserted in supabase/tests/officers.test.sql; here
 * the question is that the picker shows the member's real position and sends
 * the title the officer chose.
 */

const fetchAdminCards = vi.fn<() => Promise<AdminCardsResponse>>();
const adminSetChapterPosition = vi.fn<(memberId: string, title: string | null) => Promise<void>>();

vi.mock("@/services/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cards")>()),
  fetchAdminCards: () => fetchAdminCards(),
  adminSetChapterPosition: (memberId: string, title: string | null) =>
    adminSetChapterPosition(memberId, title),
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

function respond(rows: AdminCardRow[]) {
  fetchAdminCards.mockResolvedValue({ enabled: false, rows });
}

beforeEach(() => {
  fetchAdminCards.mockReset();
  adminSetChapterPosition.mockReset().mockResolvedValue(undefined);
});

describe("MemberPositionCard", () => {
  it("offers the Leadership page's positions, in its order", async () => {
    respond([row()]);
    renderWithProviders(<MemberPositionCard member={MEMBER} />);

    const select = await screen.findByLabelText("Position");
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.text);
    expect(options[0]).toBe("No position");
    expect(options.slice(1, 3)).toEqual(["President", "Vice-President"]);
    expect(options).toContain("Treasurer");
    expect(select).toHaveValue("");
  });

  it("sets the chosen title, and clears it with No position", async () => {
    const user = userEvent.setup();
    // Behaves like the database: what was set is what the list returns next.
    let position: string | null = null;
    fetchAdminCards.mockImplementation(async () => ({ enabled: false, rows: [row({ position })] }));
    adminSetChapterPosition.mockImplementation(async (_id, title) => {
      position = title;
    });
    renderWithProviders(<MemberPositionCard member={MEMBER} />);

    await user.selectOptions(await screen.findByLabelText("Position"), "Treasurer");
    expect(adminSetChapterPosition).toHaveBeenCalledWith(MEMBER.id, "Treasurer");
    await waitFor(() => expect(screen.getByLabelText("Position")).toHaveValue("Treasurer"));

    await user.selectOptions(screen.getByLabelText("Position"), "No position");
    await waitFor(() => expect(adminSetChapterPosition).toHaveBeenLastCalledWith(MEMBER.id, null));
  });

  it("keeps a title set by hand in Business Cards rather than showing No position", async () => {
    respond([row({ position: "Webmaster" })]);
    renderWithProviders(<MemberPositionCard member={MEMBER} />);

    expect(await screen.findByLabelText("Position")).toHaveValue("Webmaster");
  });

  it("asks for approval first when the member is pending", async () => {
    respond([]);
    renderWithProviders(
      <MemberPositionCard member={{ ...MEMBER, membership_status: "pending" }} />,
    );

    expect(
      await screen.findByText(/approve this member's account before giving them a position/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Position")).not.toBeInTheDocument();
  });
});

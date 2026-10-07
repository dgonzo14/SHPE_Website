import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";

import { AdminMemberDetail } from "../AdminMemberDetail";
import { renderWithProviders, testProfile } from "@/test/renderWithProviders";
import type { DeleteMemberResult } from "@/services/members";
import type { AdminCardsResponse, AppConfig, ProfileRow } from "@/types/database";

/*
 * Deleting a member from their detail page. admin_delete_member() decides
 * whether the delete happens (supabase/tests); here the question is what the
 * page does around it -- in particular that the member's card photos, which
 * are storage files no cascade reaches, are removed once the account is gone,
 * and only then.
 */

const fetchProfile = vi.fn<(id: string) => Promise<ProfileRow | null>>();
const deleteMember =
  vi.fn<(id: string, opts: { force?: boolean }) => Promise<DeleteMemberResult>>();
const removeMemberCardMedia = vi.fn<(memberId: string) => Promise<void>>();
const fetchAdminCards = vi.fn<() => Promise<AdminCardsResponse>>();
const fetchAppConfig = vi.fn<() => Promise<AppConfig>>();

vi.mock("@/services/members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/members")>()),
  fetchProfile: (id: string) => fetchProfile(id),
  fetchRoles: async () => ["member"],
  deleteMember: (id: string, opts: { force?: boolean }) => deleteMember(id, opts),
}));

vi.mock("@/services/points", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/points")>()),
  fetchPointsSummary: async () => ({ total_points: 0, events_attended: 0 }),
  fetchAttendanceHistory: async () => [],
  fetchPointTransactions: async () => [],
}));

vi.mock("@/services/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/content")>()),
  fetchTerms: async () => [],
  fetchAppConfig: () => fetchAppConfig(),
}));

vi.mock("@/services/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cards")>()),
  fetchAdminCards: () => fetchAdminCards(),
  removeMemberCardMedia: (memberId: string) => removeMemberCardMedia(memberId),
}));

const MEMBER: ProfileRow = {
  ...testProfile,
  id: "d0000000-0000-4000-8000-000000000001",
  first_name: "Junk",
  last_name: "Signup",
  email: "junk.signup@wustl.edu",
};

const ADMIN = {
  isAdmin: true,
  isOfficer: true,
  roles: ["member", "officer", "admin"] as ("member" | "officer" | "admin")[],
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/members/:memberId" element={<AdminMemberDetail />} />
      <Route path="/admin/members" element={<p>All members list</p>} />
    </Routes>,
    { route: `/admin/members/${MEMBER.id}`, auth: ADMIN },
  );
}

async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "Junk Signup" });
  await user.click(screen.getByRole("tab", { name: "Administration" }));
  await user.click(await screen.findByRole("button", { name: /delete member/i }));
  const dialog = await screen.findByRole("dialog", { name: "Delete this member permanently?" });
  await user.type(within(dialog).getByLabelText(/type .* to confirm/i), MEMBER.email);
  return dialog;
}

const DELETED: DeleteMemberResult = {
  ok: true,
  code: "DELETED",
  member_id: MEMBER.id,
  email: MEMBER.email,
  attendance_removed: 0,
  point_transactions_removed: 0,
  net_points_removed: 0,
};

beforeEach(() => {
  fetchProfile.mockResolvedValue(MEMBER);
  fetchAdminCards.mockResolvedValue({ enabled: true, rows: [] });
  fetchAppConfig.mockResolvedValue({ cards_enabled: true });
  removeMemberCardMedia.mockResolvedValue(undefined);
});

describe("Deleting a member", () => {
  it("removes their card photos once the account is deleted", async () => {
    deleteMember.mockResolvedValue(DELETED);
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(removeMemberCardMedia).toHaveBeenCalledWith(MEMBER.id));
    expect(removeMemberCardMedia).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("All members list")).toBeInTheDocument();
  });

  it("leaves the photos alone when the database stops because of history, until it's forced", async () => {
    deleteMember.mockResolvedValueOnce({
      ok: false,
      code: "HAS_HISTORY",
      member_id: MEMBER.id,
      email: MEMBER.email,
      attendance: 3,
      point_transactions: 3,
      net_points: 30,
    });
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    const blocked = await screen.findByRole("dialog", { name: "This member has history" });
    expect(deleteMember).toHaveBeenCalledWith(MEMBER.id, { force: false });
    expect(removeMemberCardMedia).not.toHaveBeenCalled();

    deleteMember.mockResolvedValueOnce({ ...DELETED, attendance_removed: 3 });
    await user.click(within(blocked).getByRole("button", { name: "Delete anyway" }));
    await waitFor(() => expect(removeMemberCardMedia).toHaveBeenCalledWith(MEMBER.id));
    expect(deleteMember).toHaveBeenLastCalledWith(MEMBER.id, { force: true });
  });

  it("leaves the photos alone when the delete fails", async () => {
    deleteMember.mockRejectedValue({ code: "42501", message: "Only admins can delete members" });
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    expect(await screen.findByText("We couldn't delete this member")).toBeInTheDocument();
    expect(removeMemberCardMedia).not.toHaveBeenCalled();
  });
});

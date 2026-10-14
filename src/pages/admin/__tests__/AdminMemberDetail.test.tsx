import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes } from "react-router-dom";

import { AdminMemberDetail } from "../AdminMemberDetail";
import { renderWithProviders, testProfile } from "@/test/renderWithProviders";
import { UserFacingError } from "@/lib/errors";
import { queryKeys } from "@/services/queryKeys";
import type { PasswordResetLink } from "@/services/admin";
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

const createPasswordResetLink = vi.fn<(memberId: string) => Promise<PasswordResetLink>>();

vi.mock("@/services/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/admin")>()),
  createPasswordResetLink: (memberId: string) => createPasswordResetLink(memberId),
}));

const copyText = vi.fn<(text: string) => Promise<boolean>>();

vi.mock("@/features/cards/share", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/cards/share")>()),
  copyText: (text: string) => copyText(text),
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

const OFFICER = {
  isAdmin: false,
  isOfficer: true,
  roles: ["member", "officer"] as ("member" | "officer" | "admin")[],
};

function renderPage(auth: Partial<typeof ADMIN> = ADMIN, memberId: string = MEMBER.id) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/members/:memberId" element={<AdminMemberDetail />} />
      <Route path="/admin/members" element={<p>All members list</p>} />
    </Routes>,
    { route: `/admin/members/${memberId}`, auth },
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
  createPasswordResetLink.mockReset();
  copyText.mockReset();
  copyText.mockResolvedValue(true);
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

/*
 * The reset link card. Who may create a link is decided by the Netlify
 * function and admin_password_reset_target(); here the questions are that the
 * button is only offered where it can work, that the admin is told what the
 * link can do before it exists, and that the link lives only in the open
 * dialog.
 */

const RESET_LINK: PasswordResetLink = {
  link: "https://washushpe.org/reset-password?token_hash=0123456789abcdef&type=recovery",
  email: MEMBER.email,
  display_name: "Junk Signup",
};

async function openAdministrationTab(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "Junk Signup" });
  await user.click(screen.getByRole("tab", { name: "Administration" }));
}

async function createLink(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Create reset link" }));
  const confirm = await screen.findByRole("dialog", {
    name: "Create a reset link for Junk Signup?",
  });
  await user.click(within(confirm).getByRole("button", { name: "Create link" }));
}

describe("Creating a password reset link", () => {
  it("is offered to an admin on another member's Administration tab", async () => {
    const user = userEvent.setup();
    renderPage();
    await openAdministrationTab(user);

    expect(screen.getByRole("heading", { name: "Password reset link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create reset link" })).toBeInTheDocument();
  });

  it("isn't offered to an officer who isn't an admin", async () => {
    const user = userEvent.setup();
    renderPage(OFFICER);
    await openAdministrationTab(user);

    // The tab has rendered: the Roles card says only admins can change roles.
    expect(screen.getByText(/only chapter admins can change roles/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create reset link" })).not.toBeInTheDocument();
  });

  it("isn't offered to an admin on their own page", async () => {
    fetchProfile.mockResolvedValue({ ...testProfile, first_name: "Junk", last_name: "Signup" });
    const user = userEvent.setup();
    renderPage(ADMIN, testProfile.id);
    await openAdministrationTab(user);

    expect(screen.getByText(/can't remove your own admin role/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create reset link" })).not.toBeInTheDocument();
  });

  it("says what the link can do, then creates it and shows it to copy", async () => {
    createPasswordResetLink.mockResolvedValue(RESET_LINK);
    const user = userEvent.setup();
    renderPage();
    await openAdministrationTab(user);

    await user.click(screen.getByRole("button", { name: "Create reset link" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Create a reset link for Junk Signup?",
    });
    expect(confirm).toHaveTextContent(/choose a new password for junk\.signup@wustl\.edu/i);
    expect(confirm).toHaveTextContent(/works once, expires in about an hour/i);
    expect(confirm).toHaveTextContent(/cancels any earlier reset link/i);
    expect(confirm).toHaveTextContent(/recorded in the audit log/i);
    expect(createPasswordResetLink).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Create link" }));

    const result = await screen.findByRole("dialog", { name: "Reset link for Junk Signup" });
    expect(createPasswordResetLink).toHaveBeenCalledWith(MEMBER.id);
    expect(createPasswordResetLink).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: "Create a reset link for Junk Signup?" }),
    ).not.toBeInTheDocument();
    expect(within(result).getByLabelText("Password reset link for Junk Signup")).toHaveValue(
      RESET_LINK.link,
    );
    expect(result).toHaveTextContent(`Resets the password for ${MEMBER.email}`);
    expect(result).toHaveTextContent(/only time it's shown/i);

    await user.click(within(result).getByRole("button", { name: "Copy link" }));
    expect(copyText).toHaveBeenCalledWith(RESET_LINK.link);
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("says so when the link can't be copied", async () => {
    createPasswordResetLink.mockResolvedValue(RESET_LINK);
    copyText.mockResolvedValue(false);
    const user = userEvent.setup();
    renderPage();
    await openAdministrationTab(user);

    await createLink(user);
    const result = await screen.findByRole("dialog", { name: "Reset link for Junk Signup" });
    await user.click(within(result).getByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument();
  });

  it("forgets the link once the dialog is closed", async () => {
    createPasswordResetLink.mockResolvedValue(RESET_LINK);
    const user = userEvent.setup();
    const { queryClient } = renderPage();
    await openAdministrationTab(user);

    await createLink(user);
    const result = await screen.findByRole("dialog", { name: "Reset link for Junk Signup" });
    await user.click(within(result).getByRole("button", { name: "Done" }));

    expect(
      screen.queryByRole("dialog", { name: "Reset link for Junk Signup" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(RESET_LINK.link)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("token_hash");
    // Nor does react-query keep a copy of the mutation's result.
    await waitFor(() =>
      expect(
        JSON.stringify(queryClient.getMutationCache().getAll().map((m) => m.state.data)),
      ).not.toContain("token_hash"),
    );

    // Another one means asking again and making a new link, not reshowing the old.
    createPasswordResetLink.mockResolvedValue({
      ...RESET_LINK,
      link: RESET_LINK.link.replace("0123456789abcdef", "fedcba9876543210"),
    });
    await createLink(user);
    expect(await screen.findByDisplayValue(/token_hash=fedcba9876543210/)).toBeInTheDocument();
    expect(createPasswordResetLink).toHaveBeenCalledTimes(2);
  });

  it("never shows one member's link under another member's name", async () => {
    /*
     * The page isn't remounted when only the id in the address changes, so
     * back or forward to a member whose profile is already cached would keep
     * the card, and its open dialog, alive under the new name.
     */
    const OTHER: ProfileRow = {
      ...MEMBER,
      id: "d0000000-0000-4000-8000-000000000002",
      first_name: "Rosa",
      last_name: "Rios",
      email: "rosa.rios@wustl.edu",
    };
    fetchProfile.mockImplementation(async (id) => (id === OTHER.id ? OTHER : MEMBER));
    createPasswordResetLink.mockResolvedValue(RESET_LINK);
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(
      <>
        <Routes>
          <Route path="/admin/members/:memberId" element={<AdminMemberDetail />} />
        </Routes>
        <Link to={`/admin/members/${OTHER.id}`}>Go to Rosa</Link>
      </>,
      { route: `/admin/members/${MEMBER.id}`, auth: ADMIN },
    );
    // Rosa's profile is already cached, as it would be after visiting her page.
    queryClient.setQueryDefaults(queryKeys.member.profile(OTHER.id), { gcTime: Infinity });
    queryClient.setQueryData(queryKeys.member.profile(OTHER.id), OTHER);
    await openAdministrationTab(user);

    await createLink(user);
    expect(
      await screen.findByRole("dialog", { name: "Reset link for Junk Signup" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Go to Rosa" }));

    expect(await screen.findByRole("heading", { name: "Rosa Rios" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(RESET_LINK.link)).not.toBeInTheDocument();
    // Rosa's own card, fresh.
    expect(screen.getByRole("button", { name: "Create reset link" })).toBeInTheDocument();
  });

  it("explains a failure in a toast and shows no link", async () => {
    createPasswordResetLink.mockRejectedValue(
      new UserFacingError(
        "Password reset links aren't available here",
        "They need the site's Netlify function, which only runs on the deployed site.",
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await openAdministrationTab(user);

    await createLink(user);

    expect(await screen.findByText("We couldn't create a reset link")).toBeInTheDocument();
    expect(screen.getByText(/aren't available here/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains a refusal from the server in words", async () => {
    createPasswordResetLink.mockRejectedValue(
      Object.assign(new Error("Only admins can do this"), { code: "42501" }),
    );
    const user = userEvent.setup();
    renderPage();
    await openAdministrationTab(user);

    await createLink(user);

    expect(await screen.findByText("We couldn't create a reset link")).toBeInTheDocument();
    expect(screen.getByText(/you don't have access to that/i)).toBeInTheDocument();
  });
});

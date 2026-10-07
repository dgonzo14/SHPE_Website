import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReleaseHandleDialog } from "../ReleaseHandleDialog";
import type { RowWithCard } from "../adminCardRows";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { ReleaseCardHandleResult } from "@/types/database";

/*
 * Releasing a handle. Who may, what it deletes and blocks, and what it audits
 * are asserted against the database in cards.test.sql. Here: the officer is
 * told what will happen before they confirm, including the harder case of the
 * card's current handle, and the toast reports what the database did.
 */

const adminReleaseCardHandle =
  vi.fn<(memberId: string, handle: string, reason: string) => Promise<ReleaseCardHandleResult>>();

vi.mock("@/services/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cards")>()),
  adminReleaseCardHandle: (id: string, handle: string, reason: string) =>
    adminReleaseCardHandle(id, handle, reason),
}));

const OFFICER = { isOfficer: true, roles: ["member", "officer"] as ("member" | "officer")[] };

const BETO: RowWithCard = {
  member_id: "a0000000-0000-4000-8000-000000000007",
  first_name: "Beto",
  last_name: "Bravo",
  email: "b.bravo@wustl.edu",
  membership_status: "active",
  handle: "rosa-rios",
  status: "published",
  is_published: true,
  hidden_at: null,
  hidden_reason: null,
  created_by_officer: false,
  member_opened_at: "2026-09-20T00:00:00.000Z",
  chip_handle: "rosa-rios",
  chip_handle_active: true,
  chip_written_at: "2026-09-25T23:00:00.000Z",
  old_handles: ["beto-bravo"],
  position: null,
  views_30d: 3,
  updated_at: "2026-09-25T23:00:00.000Z",
};

beforeEach(() => {
  adminReleaseCardHandle.mockReset();
});

describe("ReleaseHandleDialog", () => {
  it("explains that releasing the current handle moves the card and breaks the chip", async () => {
    adminReleaseCardHandle.mockResolvedValue({
      ok: true,
      handle: "rosa-rios",
      was_current: true,
      new_handle: "beto-bravo-2",
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ReleaseHandleDialog target={{ row: BETO, handle: "rosa-rios" }} onClose={onClose} />,
      { route: "/admin/cards", auth: OFFICER },
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Release rosa-rios from Beto Bravo's card?",
    });
    expect(dialog).toHaveTextContent("rosa-rios is their current handle");
    expect(dialog).toHaveTextContent(/their card moves to a new handle/i);
    expect(dialog).toHaveTextContent(/they can never take it back/i);
    expect(dialog).toHaveTextContent(/their nfc chip carries this handle/i);
    expect(dialog).toHaveTextContent(/rewrite it with their new address/i);

    await user.type(within(dialog).getByLabelText(/reason/i), "Impersonates Rosa Ríos");
    await user.click(within(dialog).getByRole("button", { name: "Release handle" }));

    await waitFor(() =>
      expect(adminReleaseCardHandle).toHaveBeenCalledWith(
        BETO.member_id,
        "rosa-rios",
        "Impersonates Rosa Ríos",
      ),
    );
    expect(await screen.findByText("Beto Bravo's handle is now beto-bravo-2")).toBeInTheDocument();
    expect(
      screen.getByText(
        "rosa-rios is released and no longer leads to their card. Rewrite their chip with their current address, then mark it written.",
      ),
    ).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("trusts the database over the list: an old handle that had become current says so", async () => {
    // The list on screen still had rosa-rios as an old handle, but he switched
    // back to it before the officer confirmed.
    adminReleaseCardHandle.mockResolvedValue({
      ok: true,
      handle: "beto-bravo",
      was_current: true,
      new_handle: "beto-bravo-2",
    });
    const user = userEvent.setup();
    renderWithProviders(
      <ReleaseHandleDialog target={{ row: BETO, handle: "beto-bravo" }} onClose={() => {}} />,
      { route: "/admin/cards", auth: OFFICER },
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("/card/beto-bravo will stop redirecting to Beto Bravo");
    expect(dialog).not.toHaveTextContent(/their nfc chip carries this handle/i);

    await user.type(within(dialog).getByLabelText(/reason/i), "Old handle he shouldn't keep");
    await user.click(within(dialog).getByRole("button", { name: "Release handle" }));
    expect(await screen.findByText("Beto Bravo's handle is now beto-bravo-2")).toBeInTheDocument();
  });

  it("shows the database's refusal and stays open", async () => {
    adminReleaseCardHandle.mockRejectedValue({
      code: "22023",
      message: "That handle isn't one of this member's handles",
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ReleaseHandleDialog target={{ row: BETO, handle: "beto-bravo" }} onClose={onClose} />,
      { route: "/admin/cards", auth: OFFICER },
    );

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/reason/i), "Squatting");
    await user.click(within(dialog).getByRole("button", { name: "Release handle" }));

    expect(await screen.findByText("We couldn't release that handle")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

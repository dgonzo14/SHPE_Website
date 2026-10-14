import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminAuditLog } from "../AdminAuditLog";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { AuditEntry } from "@/services/admin";

/*
 * The audit log has to be readable by an officer answering "why did my card
 * disappear?": every action named in words and filterable, the member named,
 * and no raw ids.
 */

const fetchAuditLog =
  vi.fn<(filters: { action?: string | null; limit?: number }) => Promise<AuditEntry[]>>();

vi.mock("@/services/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/admin")>()),
  fetchAuditLog: (filters: { action?: string | null; limit?: number }) => fetchAuditLog(filters),
}));

const OLGA = {
  id: "c0000000-0000-4000-8000-000000000001",
  first_name: "Olga",
  last_name: "Oficial",
  email: "o.oficial@wustl.edu",
};

const MEMBER_ID = "a0000000-0000-4000-8000-000000000004";
const OTHER_ID = "a0000000-0000-4000-8000-000000000006";

let nextId = 0;
function entry(action: string, metadata: Record<string, unknown>): AuditEntry {
  nextId += 1;
  return {
    id: `e0000000-0000-4000-8000-00000000000${nextId}`,
    actor_id: OLGA.id,
    actor: OLGA,
    action,
    entity_type: "member",
    entity_id: MEMBER_ID,
    metadata,
    created_at: "2026-10-05T18:30:00.000Z",
  };
}

/** The desktop table's details cell for the row with this action label. */
function detailsFor(label: string): string {
  const table = screen.getByRole("table");
  const cell = within(table).getByText(label);
  const cells = within(cell.closest("tr") as HTMLElement).getAllByRole("cell");
  return cells[cells.length - 1].textContent ?? "";
}

beforeEach(() => {
  nextId = 0;
  fetchAuditLog.mockResolvedValue([
    entry("card.position_set", {
      title: "President",
      handle: "diego-gonzalez",
      display_name: "Diego Gonzalez",
    }),
    entry("card.hidden", {
      reason: "Impersonating an officer",
      handle: "elena-ruiz",
      display_name: "Elena Ruiz",
    }),
    entry("card.chips_written", {
      count: 2,
      member_ids: [MEMBER_ID, OTHER_ID],
      skipped_count: 0,
    }),
    entry("card.handle_released", {
      handle: "rosa-rios",
      reason: "Squatting Rosa's name",
      new_handle: null,
      was_current: false,
      display_name: "Beto Bravo",
      current_handle: "beto-bravo",
    }),
    entry("card.handle_reset", {
      handle: "carla-gomez-2",
      reason: "Impersonation report",
      new_handle: "carla-gomez-2",
      old_handle: "carla-gomez",
      display_name: "Carla Gómez",
    }),
    entry("event.created", { title: "General Meeting" }),
  ]);
});

describe("AdminAuditLog", () => {
  it("names card actions in words, says whose card, and labels a position as a position", async () => {
    renderWithProviders(<AdminAuditLog />, { route: "/admin/audit-log" });
    await screen.findByRole("table");

    // Keys are in jsonb's order (by length), as the database returns them; the
    // member's name still comes first.
    expect(detailsFor("Chapter position set")).toBe(
      "Member: Diego Gonzalez · Position: President · Handle: diego-gonzalez",
    );
    expect(screen.queryByText(/Event: President/)).not.toBeInTheDocument();
    // Other actions keep "Event" for an event's title.
    expect(detailsFor("Event created")).toBe("Event: General Meeting");

    expect(detailsFor("Business card hidden")).toBe(
      "Member: Elena Ruiz · Reason: Impersonating an officer · Handle: elena-ruiz",
    );
    expect(detailsFor("Card handle released")).toBe(
      "Member: Beto Bravo · Released handle: rosa-rios · Reason: Squatting Rosa's name · Was their current handle: No · Current handle: beto-bravo",
    );
    // After a reset the current handle is the new one; it isn't listed twice.
    expect(detailsFor("Card handle reset")).toBe(
      "Member: Carla Gómez · Reason: Impersonation report · New handle: carla-gomez-2 · Old handle: carla-gomez",
    );
  });

  it("never prints a list of member ids", async () => {
    renderWithProviders(<AdminAuditLog />, { route: "/admin/audit-log" });
    await screen.findByRole("table");

    expect(detailsFor("NFC chips marked written")).toBe("Chips: 2 · Skipped: 0");
    expect(document.body).not.toHaveTextContent(MEMBER_ID);
    expect(document.body).not.toHaveTextContent(OTHER_ID);
  });

  it("can filter to a business card action", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAuditLog />, { route: "/admin/audit-log" });
    await screen.findByRole("table");

    const select = screen.getByLabelText("Action");
    for (const label of [
      "Business card created",
      "Business cards created in bulk",
      "NFC chips marked written",
      "Business card hidden",
      "Business card unhidden",
      "Card handle reset",
      "Card handle released",
      "Chapter position set",
      "Chapter position cleared",
      "Business cards turned on",
      "Business cards turned off",
    ]) {
      expect(within(select).getByRole("option", { name: label })).toBeInTheDocument();
    }

    await user.selectOptions(select, "Business card hidden");
    await waitFor(() =>
      expect(fetchAuditLog).toHaveBeenLastCalledWith({ action: "card.hidden", limit: 200 }),
    );
  });

  /*
   * A reset link is a key to someone's account, so its row has to say whose
   * and which address at a glance. The link itself is never recorded.
   */
  it("says whose password reset link was created, and for which address", async () => {
    // Keys in jsonb's order, as the database returns them.
    fetchAuditLog.mockResolvedValue([
      entry("member.password_reset_link_created", {
        email: "junk.signup@wustl.edu",
        display_name: "Junk Signup",
      }),
      entry("attendance.submission_deleted", {
        email: "rosa@gmail.com",
        event_title: "General Meeting",
        display_name: "Rosa Rios",
      }),
      entry("attendance.submission_linked", {
        email: "rosa@gmail.com",
        member_id: MEMBER_ID,
        event_title: "General Meeting",
        display_name: "Rosa Ríos",
        points_awarded: 10,
      }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<AdminAuditLog />, { route: "/admin/audit-log" });
    await screen.findByRole("table");

    expect(detailsFor("Password reset link created")).toBe(
      "Member: Junk Signup · Email: junk.signup@wustl.edu",
    );
    expect(detailsFor("Form response deleted")).toBe(
      "Name: Rosa Rios · Email: rosa@gmail.com · Event: General Meeting",
    );
    expect(detailsFor("Form response linked to a member")).toBe(
      "Member: Rosa Ríos · Email on the form: rosa@gmail.com · Event: General Meeting · Points awarded: 10",
    );
    expect(document.body).not.toHaveTextContent(MEMBER_ID);

    const select = screen.getByLabelText("Action");
    expect(
      within(select).getByRole("option", { name: "Password reset link created" }),
    ).toBeInTheDocument();
    await user.selectOptions(select, "Password reset link created");
    await waitFor(() =>
      expect(fetchAuditLog).toHaveBeenLastCalledWith({
        action: "member.password_reset_link_created",
        limit: 200,
      }),
    );
  });

  /*
   * Someone an officer typed in is a name and an address, not necessarily a
   * member, so the row says "Name" rather than "Member". A bulk delete says
   * how many went. A match made when an account appeared is the system's.
   */
  it("describes the attendance form's officer and system actions", async () => {
    // Keys in jsonb's order, as the database returns them.
    fetchAuditLog.mockResolvedValue([
      entry("attendance.submission_added", {
        email: "rosa@gmail.com",
        event_title: "General Meeting",
        display_name: "Rosa Rios",
        points_awarded: 0,
      }),
      entry("attendance.submissions_deleted", {
        count: 12,
        event_title: "General Meeting",
      }),
      {
        ...entry("attendance.claimed", {
          member_id: MEMBER_ID,
          event_title: "General Meeting",
          display_name: "Rosa Ríos",
          points_awarded: 10,
        }),
        actor_id: null,
        actor: null,
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<AdminAuditLog />, { route: "/admin/audit-log" });
    await screen.findByRole("table");

    expect(detailsFor("Attendee added by name and email")).toBe(
      "Name: Rosa Rios · Email: rosa@gmail.com · Event: General Meeting · Points awarded: 0",
    );
    expect(detailsFor("Form responses from a replaced link deleted")).toBe(
      "Responses: 12 · Event: General Meeting",
    );
    expect(detailsFor("Form attendance matched to an account")).toBe(
      "Member: Rosa Ríos · Event: General Meeting · Points awarded: 10",
    );
    const claimedRow = within(screen.getByRole("table"))
      .getByText("Form attendance matched to an account")
      .closest("tr") as HTMLElement;
    expect(within(claimedRow).getAllByRole("cell")[2]).toHaveTextContent(/^System$/);
    expect(document.body).not.toHaveTextContent(MEMBER_ID);

    const select = screen.getByLabelText("Action");
    for (const label of [
      "Attendee added by name and email",
      "Form responses from a replaced link deleted",
      "Form attendance matched to an account",
      "Form response linked to a member",
      "Form response deleted",
    ]) {
      expect(within(select).getByRole("option", { name: label })).toBeInTheDocument();
    }

    await user.selectOptions(select, "Attendee added by name and email");
    await waitFor(() =>
      expect(fetchAuditLog).toHaveBeenLastCalledWith({
        action: "attendance.submission_added",
        limit: 200,
      }),
    );
    await user.selectOptions(select, "Form responses from a replaced link deleted");
    await waitFor(() =>
      expect(fetchAuditLog).toHaveBeenLastCalledWith({
        action: "attendance.submissions_deleted",
        limit: 200,
      }),
    );
  });
});

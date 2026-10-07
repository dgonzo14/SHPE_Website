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
});

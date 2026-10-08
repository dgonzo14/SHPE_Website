import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminCards } from "../AdminCards";
import { renderWithProviders } from "@/test/renderWithProviders";
import { queryKeys } from "@/services/queryKeys";
import type {
  AdminCardRow,
  AdminCardsResponse,
  AdminCreateCardResult,
  AppConfig,
  BulkCreateCardsResult,
  MarkChipsWrittenResult,
  ReleaseCardHandleResult,
} from "@/types/database";

/*
 * Who may call these functions, what they write and what they audit is
 * asserted against the database in supabase/tests/cards.test.sql. Here the
 * questions are what the officer sees, and that the page asks for the right
 * thing: a dry run before a bulk write, the exact chip address in the sheet,
 * and a warning before chips get a development address.
 */

const fetchAdminCards = vi.fn<() => Promise<AdminCardsResponse>>();
const adminSuggestCardHandle = vi.fn<(memberId: string) => Promise<string | null>>();
const adminCreateCard =
  vi.fn<
    (memberId: string, opts: { handle?: string | null; publish?: boolean }) => Promise<AdminCreateCardResult>
  >();
const adminCreateMissingCards =
  vi.fn<(opts: { publish?: boolean; dryRun?: boolean }) => Promise<BulkCreateCardsResult>>();
const adminMarkChipsWritten =
  vi.fn<(ids: string[], handles?: string[]) => Promise<MarkChipsWrittenResult>>();
const adminReleaseCardHandle =
  vi.fn<(memberId: string, handle: string, reason: string) => Promise<ReleaseCardHandleResult>>();
const adminSetCardHidden =
  vi.fn<(memberId: string, hidden: boolean, reason?: string | null) => Promise<void>>();
const adminResetCardHandle =
  vi.fn<(memberId: string, reason: string) => Promise<{ old_handle: string; handle: string }>>();
const adminSetChapterPosition = vi.fn<(memberId: string, title: string | null) => Promise<void>>();
const adminSetCardsEnabled = vi.fn<(enabled: boolean) => Promise<void>>();
const fetchAppConfig = vi.fn<() => Promise<AppConfig>>();
const downloadCsv = vi.fn<(filename: string, content: string) => void>();

/** What VITE_SITE_URL (or the tab) would give cardUrl(). Changed per test. */
let siteOrigin = "https://washushpe.org";

vi.mock("@/services/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cards")>()),
  fetchAdminCards: () => fetchAdminCards(),
  adminSuggestCardHandle: (id: string) => adminSuggestCardHandle(id),
  adminCreateCard: (id: string, opts: { handle?: string | null; publish?: boolean }) =>
    adminCreateCard(id, opts),
  adminCreateMissingCards: (opts: { publish?: boolean; dryRun?: boolean }) =>
    adminCreateMissingCards(opts),
  adminMarkChipsWritten: (ids: string[], handles?: string[]) => adminMarkChipsWritten(ids, handles),
  adminReleaseCardHandle: (id: string, handle: string, reason: string) =>
    adminReleaseCardHandle(id, handle, reason),
  adminSetCardHidden: (id: string, hidden: boolean, reason?: string | null) =>
    adminSetCardHidden(id, hidden, reason),
  adminResetCardHandle: (id: string, reason: string) => adminResetCardHandle(id, reason),
  adminSetChapterPosition: (id: string, title: string | null) => adminSetChapterPosition(id, title),
  adminSetCardsEnabled: (enabled: boolean) => adminSetCardsEnabled(enabled),
  cardUrl: (handle: string, source?: string) =>
    `${siteOrigin}/card/${handle}${source && source !== "link" ? `?src=${source}` : ""}`,
}));

vi.mock("@/services/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/content")>()),
  fetchAppConfig: () => fetchAppConfig(),
}));

vi.mock("@/lib/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csv")>()),
  downloadCsv: (filename: string, content: string) => downloadCsv(filename, content),
}));

const OFFICER = { isOfficer: true, roles: ["member", "officer"] as ("member" | "officer")[] };

function row(overrides: Partial<AdminCardRow> & Pick<AdminCardRow, "member_id">): AdminCardRow {
  return {
    first_name: "Test",
    last_name: "Member",
    email: "test@wustl.edu",
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

const ANA = row({
  member_id: "a0000000-0000-4000-8000-000000000001",
  first_name: "Ana",
  last_name: "Rivera",
  email: "ana.rivera@wustl.edu",
});
const BRUNO = row({
  member_id: "a0000000-0000-4000-8000-000000000002",
  first_name: "Bruno",
  last_name: "Díaz",
  email: "b.diaz@wustl.edu",
  handle: "bruno-diaz",
  status: "officer_unopened",
  created_by_officer: true,
  updated_at: "2026-10-01T00:00:00.000Z",
});
const CARLA = row({
  member_id: "a0000000-0000-4000-8000-000000000003",
  first_name: "Carla",
  last_name: "Gómez",
  email: "c.gomez@wustl.edu",
  handle: "carla-gomez",
  status: "published",
  is_published: true,
  created_by_officer: true,
  chip_handle: "carla-gomez",
  chip_written_at: "2026-10-01T23:00:00.000Z",
  views_30d: 12,
});
const DIEGO = row({
  member_id: "a0000000-0000-4000-8000-000000000004",
  first_name: "Diego",
  last_name: "Gonzalez",
  email: "d.gonzalez@wustl.edu",
  handle: "diego-gonzalez",
  status: "published",
  is_published: true,
  member_opened_at: "2026-09-20T00:00:00.000Z",
  chip_handle: "diego",
  chip_written_at: "2026-09-25T23:00:00.000Z",
  position: "President",
  views_30d: 40,
});
const ELENA = row({
  member_id: "a0000000-0000-4000-8000-000000000005",
  first_name: "Elena",
  last_name: "Ruiz",
  email: "e.ruiz@wustl.edu",
  handle: "elena-ruiz",
  status: "hidden",
  is_published: true,
  member_opened_at: "2026-09-20T00:00:00.000Z",
  hidden_at: "2026-10-02T00:00:00.000Z",
  hidden_reason: "Headline impersonates an officer",
});
const FER = row({
  member_id: "a0000000-0000-4000-8000-000000000006",
  first_name: "Fer",
  last_name: "Soto",
  email: "f.soto@wustl.edu",
  handle: "fer-soto",
  status: "member",
  member_opened_at: "2026-09-21T00:00:00.000Z",
});

const ROWS = [ANA, BRUNO, CARLA, DIEGO, ELENA, FER];

function renderPage(route = "/admin/cards") {
  return renderWithProviders(<AdminCards />, { route, auth: OFFICER });
}

async function findTable() {
  return screen.findByRole("table", { name: /approved members with their business card/i });
}

function rowFor(table: HTMLElement, name: string): HTMLElement {
  const cell = within(table).getByRole("link", { name });
  return cell.closest("tr") as HTMLElement;
}

function shownNames(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((tr) => within(tr).getAllByRole("link")[0].textContent ?? "");
}

beforeEach(() => {
  siteOrigin = "https://washushpe.org";
  fetchAdminCards.mockResolvedValue({ enabled: true, rows: ROWS });
  fetchAppConfig.mockResolvedValue({ cards_enabled: true });
});

describe("AdminCards table", () => {
  it("shows every approved member with their card, chip, position and views", async () => {
    renderPage();
    const table = await findTable();

    expect(shownNames(table)).toEqual([
      "Ana Rivera",
      "Bruno Díaz",
      "Carla Gómez",
      "Diego Gonzalez",
      "Elena Ruiz",
      "Fer Soto",
    ]);

    expect(within(rowFor(table, "Ana Rivera")).getByText("No card")).toBeInTheDocument();
    expect(
      within(rowFor(table, "Bruno Díaz")).getByText("Set up by officer, not opened"),
    ).toBeInTheDocument();
    expect(within(rowFor(table, "Fer Soto")).getByText("Member set up")).toBeInTheDocument();

    // A published starter card nobody has opened says both things.
    const carla = rowFor(table, "Carla Gómez");
    expect(within(carla).getByText("Published")).toBeInTheDocument();
    expect(within(carla).getByText("Set up by officer, not opened")).toBeInTheDocument();
    expect(carla).toHaveTextContent("Written October 1, 2026");
    expect(within(carla).getByText("12")).toBeInTheDocument();

    const elena = rowFor(table, "Elena Ruiz");
    expect(within(elena).getByText("Hidden")).toBeInTheDocument();
    expect(within(elena).getByText("Headline impersonates an officer")).toBeInTheDocument();

    const diego = rowFor(table, "Diego Gonzalez");
    expect(within(diego).getByText("President")).toBeInTheDocument();
    // The chip predates a rename, and the database says its handle still
    // resolves: flagged as an old handle that redirects, not as broken.
    expect(within(diego).getByText(/chip carries/i)).toHaveTextContent(
      "Chip carries diego, an old handle. It still redirects here.",
    );
    expect(within(rowFor(table, "Bruno Díaz")).getByText("Not yet")).toBeInTheDocument();
  });

  it("links a handle to the card only when the card would actually open", async () => {
    renderPage();
    const table = await findTable();

    expect(
      within(rowFor(table, "Diego Gonzalez")).getByRole("link", { name: /diego-gonzalez/ }),
    ).toHaveAttribute("href", "/card/diego-gonzalez");
    // Unpublished and hidden cards show the handle as text.
    expect(within(rowFor(table, "Bruno Díaz")).getByText("bruno-diaz").closest("a")).toBeNull();
    expect(within(rowFor(table, "Elena Ruiz")).getByText("elena-ruiz").closest("a")).toBeNull();
  });

  it("doesn't link published cards while the feature is switched off", async () => {
    fetchAppConfig.mockResolvedValue({ cards_enabled: false });
    renderPage();
    const table = await findTable();

    await screen.findByRole("button", { name: /turn business cards on/i });
    expect(within(rowFor(table, "Diego Gonzalez")).getByText("diego-gonzalez").closest("a")).toBeNull();
  });

  it("filters by card state and searches names without accents, emails and handles", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();
    const show = screen.getByLabelText("Show");

    await user.selectOptions(show, "no_card");
    expect(shownNames(table)).toEqual(["Ana Rivera"]);

    await user.selectOptions(show, "no_chip");
    expect(shownNames(table)).toEqual(["Bruno Díaz", "Elena Ruiz", "Fer Soto"]);

    await user.selectOptions(show, "hidden");
    expect(shownNames(table)).toEqual(["Elena Ruiz"]);

    await user.selectOptions(show, "all");
    const search = screen.getByLabelText("Search");

    await user.type(search, "gomez");
    expect(shownNames(table)).toEqual(["Carla Gómez"]);

    await user.clear(search);
    await user.type(search, "f.soto@");
    expect(shownNames(table)).toEqual(["Fer Soto"]);

    // Matches the old handle on the chip as well as the current one.
    await user.clear(search);
    await user.type(search, "diego");
    expect(shownNames(table)).toEqual(["Diego Gonzalez"]);

    await user.clear(search);
    await user.type(search, "nobody-by-this-name");
    expect(await screen.findByText("Nobody matches")).toBeInTheDocument();
  });

  it("starts from the ?q= search the member page links with", async () => {
    renderPage("/admin/cards?q=e.ruiz%40wustl.edu");
    const table = await findTable();
    expect(shownNames(table)).toEqual(["Elena Ruiz"]);
    expect(screen.getByLabelText("Search")).toHaveValue("e.ruiz@wustl.edu");
  });
});

describe("Create cards for everyone missing one", () => {
  const PREVIEW: BulkCreateCardsResult = {
    dry_run: true,
    published: false,
    created: [
      { member_id: ANA.member_id, name: "Ana Rivera", handle: "ana-rivera" },
      { member_id: "a0000000-0000-4000-8000-000000000009", name: "Gabi Luna", handle: "gabi-luna" },
    ],
    skipped: [
      { member_id: "a0000000-0000-4000-8000-000000000010", name: " ", email: "x7@wustl.edu", reason: "no_name" },
    ],
  };

  it("previews with a dry run, re-previews when publishing changes, then confirms for real", async () => {
    adminCreateMissingCards.mockImplementation(async ({ publish = false, dryRun = true }) => ({
      ...PREVIEW,
      dry_run: dryRun,
      published: publish,
    }));
    const user = userEvent.setup();
    renderPage();
    await findTable();

    await user.click(screen.getByRole("button", { name: /create cards for everyone missing one/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /create cards for everyone missing one/i,
    });

    expect(await within(dialog).findByText("ana-rivera")).toBeInTheDocument();
    expect(within(dialog).getByText("gabi-luna")).toBeInTheDocument();
    expect(within(dialog).getByText("2 members get a card")).toBeInTheDocument();
    // Skipped members are listed with the reason, by email when they have no name.
    expect(within(dialog).getByText(/1 member was skipped/i)).toBeInTheDocument();
    expect(within(dialog).getByText("x7@wustl.edu")).toBeInTheDocument();
    expect(within(dialog).getByText(/no name on their profile/i)).toBeInTheDocument();
    expect(adminCreateMissingCards).toHaveBeenLastCalledWith({ publish: false, dryRun: true });

    const publish = within(dialog).getByRole("checkbox", { name: /publish them as starter cards/i });
    expect(publish).not.toBeChecked();
    await user.click(publish);
    await waitFor(() =>
      expect(adminCreateMissingCards).toHaveBeenLastCalledWith({ publish: true, dryRun: true }),
    );
    // Nothing real has happened yet.
    expect(adminCreateMissingCards).not.toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );

    await user.click(await within(dialog).findByRole("button", { name: "Create 2 cards" }));

    expect(adminCreateMissingCards).toHaveBeenLastCalledWith({ publish: true, dryRun: false });
    expect(
      await screen.findByRole("dialog", { name: "Created 2 cards" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/they're published as starter cards/i)).toBeInTheDocument();
  });

  it("says published starter cards won't be live while cards are switched off", async () => {
    fetchAppConfig.mockResolvedValue({ cards_enabled: false });
    adminCreateMissingCards.mockImplementation(async ({ publish = false, dryRun = true }) => ({
      ...PREVIEW,
      dry_run: dryRun,
      published: publish,
    }));
    const user = userEvent.setup();
    renderPage();
    await findTable();

    await user.click(screen.getByRole("button", { name: /create cards for everyone missing one/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /create cards for everyone missing one/i,
    });
    await within(dialog).findByText("ana-rivera");
    expect(within(dialog).queryByText(/switched off/i)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: /publish them as starter cards/i }));
    expect(
      await within(dialog).findByText(/business cards are switched off, so these won't be live/i),
    ).toBeInTheDocument();

    await user.click(await within(dialog).findByRole("button", { name: "Create 2 cards" }));
    expect(
      await screen.findByText(/published as starter cards, and go live when business cards are turned on/i),
    ).toBeInTheDocument();
  });

  it("gives a name a URL can't spell a member- handle, and says why", async () => {
    adminCreateMissingCards.mockResolvedValue({
      ...PREVIEW,
      created: [
        { member_id: "a0000000-0000-4000-8000-000000000011", name: "王 芳", handle: "member-3f9a1c" },
      ],
      skipped: [],
    });
    const user = userEvent.setup();
    renderPage();
    await findTable();

    await user.click(screen.getByRole("button", { name: /create cards for everyone missing one/i }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("member-3f9a1c")).toBeInTheDocument();
    expect(within(dialog).getByText(/one name has no letters a web address can use/i)).toBeInTheDocument();
    // Not reported as a member with no name.
    expect(within(dialog).queryByText(/skipped/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create 1 card" })).toBeEnabled();
  });

  it("says so when everyone already has a card, and offers nothing to confirm", async () => {
    adminCreateMissingCards.mockResolvedValue({ ...PREVIEW, created: [], skipped: [] });
    const user = userEvent.setup();
    renderPage();
    await findTable();

    await user.click(screen.getByRole("button", { name: /create cards for everyone missing one/i }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Every active member has a card")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create cards" })).toBeDisabled();
  });
});

describe("NFC programming sheet", () => {
  function csvLines(): string[] {
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    return downloadCsv.mock.calls[0][1].split("\r\n");
  }

  it("exports the selected members who have a card, with the exact chip URL", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("checkbox", { name: "Select Ana Rivera" }));
    await user.click(within(table).getByRole("checkbox", { name: "Select Carla Gómez" }));
    await user.click(within(table).getByRole("checkbox", { name: "Select Diego Gonzalez" }));
    await user.click(screen.getByRole("button", { name: /export nfc programming sheet \(2\)/i }));

    expect(downloadCsv.mock.calls[0][0]).toBe("shpe-nfc-programming-sheet.csv");
    expect(csvLines()).toEqual([
      "Name,Email,Handle,Chip URL,Card status,Chip written",
      "Carla Gómez,c.gomez@wustl.edu,carla-gomez,https://washushpe.org/card/carla-gomez?src=nfc,\"Published; Set up by officer, not opened\",\"October 1, 2026\"",
      "Diego Gonzalez,d.gonzalez@wustl.edu,diego-gonzalez,https://washushpe.org/card/diego-gonzalez?src=nfc,Published,\"September 25, 2026, as diego (redirects)\"",
    ]);
    // Ana has no card, so there's nothing to write to her chip yet.
    expect(await screen.findByText(/1 selected member has no card yet/i)).toBeInTheDocument();
  });

  it("exports everyone shown with a card when nothing is selected", async () => {
    const user = userEvent.setup();
    renderPage();
    await findTable();

    await user.selectOptions(screen.getByLabelText("Show"), "no_chip");
    await user.click(screen.getByRole("button", { name: /export nfc programming sheet \(3\)/i }));

    expect(csvLines().slice(1).map((line) => line.split(",")[2])).toEqual([
      "bruno-diaz",
      "elena-ruiz",
      "fer-soto",
    ]);
  });

  it("shows the address chips will carry, and nothing alarming when it's production", async () => {
    renderPage();
    await findTable();

    expect(
      screen.getByText("https://washushpe.org/card/first-last?src=nfc"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/don't write chips with this address/i)).not.toBeInTheDocument();
  });

  it("warns loudly about a localhost address and won't export without a second yes", async () => {
    siteOrigin = "http://localhost:5173";
    const user = userEvent.setup();
    renderPage();
    await findTable();

    const warning = screen.getByRole("alert", { name: "" });
    expect(warning).toHaveTextContent(/don't write chips with this address/i);
    expect(warning).toHaveTextContent(/localhost/i);
    expect(warning).toHaveTextContent(/http:, not https:/i);
    expect(warning).toHaveTextContent(/VITE_SITE_URL/);

    await user.click(screen.getByRole("button", { name: /export nfc programming sheet/i }));
    const confirm = await screen.findByRole("dialog", {
      name: /this sheet has the wrong address for chips/i,
    });
    expect(confirm).toHaveTextContent("http://localhost:5173");
    expect(downloadCsv).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Export anyway" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadCsv.mock.calls[0][1]).toContain("http://localhost:5173/card/carla-gomez?src=nfc");
  });

  it("warns about a Netlify preview address", async () => {
    siteOrigin = "https://deploy-preview-12--washushpe.netlify.app";
    renderPage();
    await findTable();

    expect(screen.getByText(/don't write chips with this address/i)).toBeInTheDocument();
    expect(screen.getByText(/it's a netlify address/i)).toBeInTheDocument();
  });

  it("marks the selected cards' chips written after a confirm", async () => {
    adminMarkChipsWritten.mockResolvedValue({ ok: true, count: 2, skipped: [] });
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("checkbox", { name: "Select Ana Rivera" }));
    await user.click(within(table).getByRole("checkbox", { name: "Select Bruno Díaz" }));
    await user.click(within(table).getByRole("checkbox", { name: "Select Fer Soto" }));
    await user.click(screen.getByRole("button", { name: /mark chips written \(2\)/i }));

    const confirm = await screen.findByRole("dialog", { name: /mark these chips as written/i });
    expect(confirm).toHaveTextContent(/1 selected member has no card and will be skipped/i);
    expect(adminMarkChipsWritten).not.toHaveBeenCalled();

    // The handles shown in the dialog are the ones recorded, not whatever the
    // database has by the time the request lands.
    expect(within(confirm).getByText("bruno-diaz")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Mark 2 chips written" }));
    expect(adminMarkChipsWritten).toHaveBeenCalledWith(
      [BRUNO.member_id, FER.member_id],
      ["bruno-diaz", "fer-soto"],
    );
    expect(await screen.findByText("Marked 2 chips as written")).toBeInTheDocument();
    // The selection is spent once the chips are recorded.
    expect(within(table).getByRole("checkbox", { name: "Select Bruno Díaz" })).not.toBeChecked();
  });

  it("records the handle from the exported sheet even after the member renames", async () => {
    adminMarkChipsWritten.mockResolvedValue({ ok: true, count: 1, skipped: [] });
    const user = userEvent.setup();
    const { queryClient } = renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("checkbox", { name: "Select Carla Gómez" }));
    await user.click(screen.getByRole("button", { name: /export nfc programming sheet \(1\)/i }));

    // Carla renames on her phone while the chip is written from the sheet, and
    // the list refreshes (any officer action does this).
    fetchAdminCards.mockResolvedValue({
      enabled: true,
      rows: ROWS.map((r) =>
        r === CARLA ? { ...CARLA, handle: "carla-g", old_handles: ["carla-gomez"] } : r,
      ),
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.cards.admin });
    expect(await within(table).findByText("carla-g")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /mark chips written \(1\)/i }));
    const confirm = await screen.findByRole("dialog", { name: /mark these chips as written/i });
    expect(confirm).toHaveTextContent(/carla-gomez \(from the sheet; their handle is now carla-g\)/);

    await user.click(within(confirm).getByRole("button", { name: "Mark 1 chip written" }));
    expect(adminMarkChipsWritten).toHaveBeenCalledWith([CARLA.member_id], ["carla-gomez"]);
  });

  it("reports chips the database skipped, and keeps those members selected", async () => {
    adminMarkChipsWritten.mockResolvedValue({ ok: true, count: 1, skipped: [FER.member_id] });
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("checkbox", { name: "Select Bruno Díaz" }));
    await user.click(within(table).getByRole("checkbox", { name: "Select Fer Soto" }));
    await user.click(screen.getByRole("button", { name: /mark chips written \(2\)/i }));
    const confirm = await screen.findByRole("dialog", { name: /mark these chips as written/i });
    await user.click(within(confirm).getByRole("button", { name: "Mark 2 chips written" }));

    expect(await screen.findByText("Marked 1 chip as written")).toBeInTheDocument();
    expect(
      screen.getByText(/1 chip skipped \(Fer Soto\): the handle on the sheet was reset or released since it was exported/),
    ).toBeInTheDocument();
    // Ready to export again for exactly the chip that needs rewriting.
    expect(within(table).getByRole("checkbox", { name: "Select Fer Soto" })).toBeChecked();
    expect(within(table).getByRole("checkbox", { name: "Select Bruno Díaz" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /export nfc programming sheet \(1\)/i })).toBeEnabled();
  });

  it("can't mark chips when nobody selected has a card", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("checkbox", { name: "Select Ana Rivera" }));
    expect(screen.getByRole("button", { name: /mark chips written/i })).toBeDisabled();
  });

  it("names the phone-sized select-all box by the words beside it, which also tick it", async () => {
    const user = userEvent.setup();
    renderPage();
    await findTable();

    // The list layout below md. Both layouts are in the DOM under jsdom.
    const selectAll = screen.getByRole("checkbox", { name: "Select all shown" });
    expect(selectAll).not.toBeChecked();
    await user.click(screen.getByText("Select all shown"));
    expect(selectAll).toBeChecked();
    expect(screen.getByRole("button", { name: /mark chips written \(5\)/i })).toBeEnabled();
  });

  it("selects every member shown, and keeps earlier ticks while searching", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("checkbox", { name: "Select Carla Gómez" }));
    await user.type(screen.getByLabelText("Search"), "fer");
    await user.click(within(table).getByRole("checkbox", { name: "Select Fer Soto" }));

    expect(screen.getByText(/not shown by this search/i)).toHaveTextContent("(1 not shown by this search)");
    expect(screen.getByRole("button", { name: /mark chips written \(2\)/i })).toBeEnabled();

    await user.clear(screen.getByLabelText("Search"));
    const all = within(table).getByRole("checkbox", { name: "Select every member shown" });
    expect(all).toHaveProperty("indeterminate", true);
    await user.click(all);
    expect(screen.getByRole("button", { name: /mark chips written \(5\)/i })).toBeEnabled();
  });
});

describe("Row actions", () => {
  it("creates a card with the suggested handle, validating edits before sending", async () => {
    adminSuggestCardHandle.mockResolvedValue("ana-rivera");
    adminCreateCard.mockResolvedValue({
      ok: true,
      member_id: ANA.member_id,
      handle: "ana-r",
      is_published: false,
    });
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("button", { name: "Create card for Ana Rivera" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a card for Ana Rivera" });
    const handle = await within(dialog).findByLabelText(/handle/i);
    expect(handle).toHaveValue("ana-rivera");
    expect(adminSuggestCardHandle).toHaveBeenCalledWith(ANA.member_id);
    expect(within(dialog).getByText("https://washushpe.org/card/ana-rivera?src=nfc")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("checkbox", { name: /publish it now as a starter card/i }),
    ).not.toBeChecked();

    await user.clear(handle);
    await user.type(handle, "admin");
    // Blur by clicking the dialog body. (Not Tab: the dialog's focus trap
    // relies on layout, which jsdom doesn't have.)
    await user.click(within(dialog).getByText(/lowercase letters/));
    expect(await within(dialog).findByText("That handle is reserved")).toBeInTheDocument();

    await user.clear(handle);
    await user.type(handle, "an");
    expect(await within(dialog).findByText("Use at least 3 characters")).toBeInTheDocument();

    await user.clear(handle);
    await user.type(handle, "ana--r");
    expect(
      await within(dialog).findByText(/starting and ending with a letter or number/i),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create card" }));
    expect(adminCreateCard).not.toHaveBeenCalled();

    // Typed in capitals; the schema lowercases, as the database would.
    await user.clear(handle);
    await user.type(handle, "Ana-R");
    await user.click(within(dialog).getByRole("button", { name: "Create card" }));

    await waitFor(() =>
      expect(adminCreateCard).toHaveBeenCalledWith(ANA.member_id, { handle: "ana-r", publish: false }),
    );
    expect(await screen.findByText("Card created for Ana Rivera")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("refreshes the list when an action fails because the row was stale", async () => {
    adminSuggestCardHandle.mockResolvedValue("ana-rivera");
    adminCreateCard.mockRejectedValue({ code: "22023", message: "That member already has a card" });
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();
    expect(fetchAdminCards).toHaveBeenCalledTimes(1);

    // Another officer made Ana's card since this page loaded.
    fetchAdminCards.mockResolvedValue({
      enabled: true,
      rows: ROWS.map((r) => (r === ANA ? { ...ANA, handle: "ana-rivera", status: "officer_unopened" } : r)),
    });

    await user.click(within(table).getByRole("button", { name: "Create card for Ana Rivera" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a card for Ana Rivera" });
    await within(dialog).findByLabelText(/handle/i);
    await user.click(within(dialog).getByRole("button", { name: "Create card" }));

    expect(await screen.findByText("That member already has a card")).toBeInTheDocument();
    await waitFor(() => expect(fetchAdminCards).toHaveBeenCalledTimes(2));
    // The row no longer offers the action that just failed.
    await waitFor(() =>
      expect(
        within(table).queryByRole("button", { name: "Create card for Ana Rivera" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("offers a made-up member- handle for a name a URL can't spell, and explains it", async () => {
    adminSuggestCardHandle.mockResolvedValue("member-3f9a1c");
    adminCreateCard.mockResolvedValue({
      ok: true,
      member_id: ANA.member_id,
      handle: "member-3f9a1c",
      is_published: false,
    });
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("button", { name: "Create card for Ana Rivera" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByLabelText(/handle/i)).toHaveValue("member-3f9a1c");
    expect(within(dialog).getByText(/no letters a web address can use/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/add a name/i)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create card" }));
    await waitFor(() =>
      expect(adminCreateCard).toHaveBeenCalledWith(ANA.member_id, {
        handle: "member-3f9a1c",
        publish: false,
      }),
    );
  });

  it("won't offer to create a card for a member with no name", async () => {
    adminSuggestCardHandle.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("button", { name: "Create card for Ana Rivera" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Add a name to their profile first")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create card" })).toBeDisabled();
  });

  it("needs a reason to hide a card, and tells the officer the member sees it", async () => {
    adminSetCardHidden.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("button", { name: "Hide Bruno Díaz's card" }));
    const dialog = await screen.findByRole("dialog", { name: "Hide Bruno Díaz's card?" });
    expect(dialog).toHaveTextContent(/the member sees this/i);

    await user.click(within(dialog).getByRole("button", { name: "Hide card" }));
    expect(await within(dialog).findByText(/say why/i)).toBeInTheDocument();
    expect(adminSetCardHidden).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/reason/i), "Offensive headline");
    await user.click(within(dialog).getByRole("button", { name: "Hide card" }));
    await waitFor(() =>
      expect(adminSetCardHidden).toHaveBeenCalledWith(BRUNO.member_id, true, "Offensive headline"),
    );
  });

  it("unhides without a reason", async () => {
    adminSetCardHidden.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("button", { name: "Unhide Elena Ruiz's card" }));
    const dialog = await screen.findByRole("dialog", { name: "Unhide Elena Ruiz's card?" });
    await user.click(within(dialog).getByRole("button", { name: "Unhide card" }));
    await waitFor(() => expect(adminSetCardHidden).toHaveBeenCalledWith(ELENA.member_id, false, null));
  });

  it("doesn't call an unhidden card live while cards are switched off", async () => {
    fetchAppConfig.mockResolvedValue({ cards_enabled: false });
    adminSetCardHidden.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();
    await screen.findByRole("button", { name: /turn business cards on/i });

    await user.click(within(table).getByRole("button", { name: "Unhide Elena Ruiz's card" }));
    const dialog = await screen.findByRole("dialog", { name: "Unhide Elena Ruiz's card?" });
    expect(dialog).not.toHaveTextContent(/straight away/i);
    expect(dialog).toHaveTextContent(/business cards are switched off/i);

    await user.click(within(dialog).getByRole("button", { name: "Unhide card" }));
    expect(
      await screen.findByText("It goes live at /card/elena-ruiz when business cards are turned on."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/live again/i)).not.toBeInTheDocument();
  });

  it("says an unhidden published card is live again when cards are on", async () => {
    adminSetCardHidden.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();
    await screen.findByRole("button", { name: /turn business cards off/i });

    await user.click(within(table).getByRole("button", { name: "Unhide Elena Ruiz's card" }));
    const dialog = await screen.findByRole("dialog", { name: "Unhide Elena Ruiz's card?" });
    expect(dialog).toHaveTextContent(/opens again at \/card\/elena-ruiz straight away/i);
    await user.click(within(dialog).getByRole("button", { name: "Unhide card" }));
    expect(await screen.findByText("It's live again at /card/elena-ruiz.")).toBeInTheDocument();
  });

  it("doesn't call an unhidden card live while the member is suspended", async () => {
    fetchAdminCards.mockResolvedValue({
      enabled: true,
      rows: ROWS.map((r) => (r === ELENA ? { ...ELENA, membership_status: "suspended" as const } : r)),
    });
    adminSetCardHidden.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();
    await screen.findByRole("button", { name: /turn business cards off/i });

    await user.click(within(table).getByRole("button", { name: "Unhide Elena Ruiz's card" }));
    const dialog = await screen.findByRole("dialog", { name: "Unhide Elena Ruiz's card?" });
    expect(dialog).not.toHaveTextContent(/straight away/i);
    expect(dialog).toHaveTextContent(/their membership is suspended/i);

    await user.click(within(dialog).getByRole("button", { name: "Unhide card" }));
    expect(
      await screen.findByText("It won't open while their membership is suspended."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/live again/i)).not.toBeInTheDocument();
  });

  it("warns that a reset breaks the chip carrying the handle, and needs a reason", async () => {
    adminResetCardHandle.mockResolvedValue({ old_handle: "carla-gomez", handle: "carla-gomez-2" });
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("button", { name: "Reset handle for Carla Gómez" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset Carla Gómez's handle?" });
    expect(dialog).toHaveTextContent("/card/carla-gomez will stop working");
    expect(dialog).toHaveTextContent(/their nfc chip carries this handle/i);

    await user.click(within(dialog).getByRole("button", { name: "Reset handle" }));
    expect(await within(dialog).findByText(/say why/i)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/reason/i), "Impersonation report");
    await user.click(within(dialog).getByRole("button", { name: "Reset handle" }));
    await waitFor(() =>
      expect(adminResetCardHandle).toHaveBeenCalledWith(CARLA.member_id, "Impersonation report"),
    );
    expect(await screen.findByText(/handle is now carla-gomez-2/i)).toBeInTheDocument();
  });

  it("says a dead chip may now open someone else's card, not that it opens nothing", async () => {
    fetchAdminCards.mockResolvedValue({
      enabled: true,
      rows: [
        {
          ...CARLA,
          handle: "carla-gomez-2",
          chip_handle: "carla-gomez",
          chip_handle_active: false,
        },
      ],
    });
    renderPage();
    const table = await findTable();

    const note = within(rowFor(table, "Carla Gómez")).getByText(/needs rewriting/i);
    expect(note).toHaveTextContent(
      "Needs rewriting: the chip carries carla-gomez, which is no longer theirs. A tap shows “card not available”, or another member's card if someone has claimed that handle since.",
    );
    expect(note).not.toHaveTextContent(/no longer opens anything/i);
  });

  it("lists old handles and releases one, with a reason, for good", async () => {
    const BETO = row({
      member_id: "a0000000-0000-4000-8000-000000000007",
      first_name: "Beto",
      last_name: "Bravo",
      email: "b.bravo@wustl.edu",
      handle: "beto-bravo",
      status: "published",
      is_published: true,
      member_opened_at: "2026-09-20T00:00:00.000Z",
      old_handles: ["rosa-rios"],
    });
    fetchAdminCards.mockResolvedValue({ enabled: true, rows: [...ROWS, BETO] });
    adminReleaseCardHandle.mockResolvedValue({
      ok: true,
      handle: "rosa-rios",
      was_current: false,
      new_handle: null,
    });
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    // The squatting report names the handle, so searching for it finds him.
    await user.type(screen.getByLabelText("Search"), "rosa-rios");
    expect(shownNames(table)).toEqual(["Beto Bravo"]);
    const beto = rowFor(table, "Beto Bravo");
    expect(beto).toHaveTextContent(/old handle, still theirs and redirecting here/i);
    expect(within(beto).getByText("rosa-rios")).toBeInTheDocument();

    await user.click(within(beto).getByRole("button", { name: "Release rosa-rios from Beto Bravo's card" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Release rosa-rios from Beto Bravo's card?",
    });
    expect(dialog).toHaveTextContent("/card/rosa-rios will stop redirecting to Beto Bravo");
    expect(dialog).toHaveTextContent(/free for any other member to claim/i);
    expect(dialog).toHaveTextContent(/they can never take it back/i);
    expect(dialog).toHaveTextContent(/their current handle, beto-bravo, isn't affected/i);
    expect(fetchAdminCards).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Release handle" }));
    expect(await within(dialog).findByText(/say why/i)).toBeInTheDocument();
    expect(adminReleaseCardHandle).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/reason/i), "Impersonates Rosa Ríos");
    await user.click(within(dialog).getByRole("button", { name: "Release handle" }));
    await waitFor(() =>
      expect(adminReleaseCardHandle).toHaveBeenCalledWith(
        BETO.member_id,
        "rosa-rios",
        "Impersonates Rosa Ríos",
      ),
    );
    expect(await screen.findByText("Released rosa-rios")).toBeInTheDocument();
    expect(
      screen.getByText("It no longer redirects to Beto Bravo's card, and another member can claim it."),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchAdminCards).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sets and clears a chapter position", async () => {
    adminSetChapterPosition.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    const table = await findTable();

    await user.click(within(table).getByRole("button", { name: "Set position for Fer Soto" }));
    let dialog = await screen.findByRole("dialog", { name: "Chapter position for Fer Soto" });
    await user.type(within(dialog).getByLabelText("Position"), "T");
    await user.click(within(dialog).getByRole("button", { name: "Save position" }));
    expect(await within(dialog).findByText(/Use at least 2 characters/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Position"), "reasurer");
    await user.click(within(dialog).getByRole("button", { name: "Save position" }));
    await waitFor(() =>
      expect(adminSetChapterPosition).toHaveBeenCalledWith(FER.member_id, "Treasurer"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(table).getByRole("button", { name: "Edit position for Diego Gonzalez" }));
    dialog = await screen.findByRole("dialog", { name: "Chapter position for Diego Gonzalez" });
    expect(within(dialog).getByLabelText("Position")).toHaveValue("President");
    await user.click(within(dialog).getByRole("button", { name: "Remove position" }));
    await waitFor(() =>
      expect(adminSetChapterPosition).toHaveBeenCalledWith(DIEGO.member_id, null),
    );
  });
});

describe("Feature switch", () => {
  it("turns cards on in one click", async () => {
    fetchAppConfig.mockResolvedValue({ cards_enabled: false });
    adminSetCardsEnabled.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/members don't see my card/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /turn business cards on/i }));
    await waitFor(() => expect(adminSetCardsEnabled).toHaveBeenCalledWith(true));
  });

  it("asks before turning cards off, because every chip stops working", async () => {
    adminSetCardsEnabled.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /turn business cards off/i }));
    const dialog = await screen.findByRole("dialog", { name: "Turn business cards off?" });
    expect(dialog).toHaveTextContent(/including on chips already handed out/i);
    expect(adminSetCardsEnabled).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Turn cards off" }));
    await waitFor(() => expect(adminSetCardsEnabled).toHaveBeenCalledWith(false));
  });
});

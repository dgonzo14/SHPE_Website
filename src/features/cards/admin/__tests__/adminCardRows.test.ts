import { describe, expect, it, vi } from "vitest";

import {
  cardStatusBadges,
  cardStatusText,
  chipCarriesOldHandle,
  chipIsDead,
  filterCardRows,
  hasCard,
  isCardLive,
  isFallbackHandle,
  isUnopenedOfficerCard,
  matchesSearch,
  programmingSheetCsv,
  type RowWithCard,
} from "../adminCardRows";
import { checkChipOrigin, checkThisSiteChipOrigin } from "../chipOrigin";
import type { AdminCardRow } from "@/types/database";

// cardUrl's origin depends on VITE_SITE_URL and the tab; pin it.
vi.mock("@/services/cards", () => ({
  cardUrl: (handle: string, source?: string) =>
    `https://washushpe.org/card/${handle}${source && source !== "link" ? `?src=${source}` : ""}`,
}));

function row(overrides: Partial<AdminCardRow> = {}): AdminCardRow {
  return {
    member_id: "m1",
    first_name: "Ana",
    last_name: "Rivera",
    email: "ana.rivera@wustl.edu",
    membership_status: "active",
    handle: "ana-rivera",
    status: "member",
    is_published: false,
    hidden_at: null,
    hidden_reason: null,
    created_by_officer: false,
    member_opened_at: "2026-09-01T00:00:00.000Z",
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

describe("card status", () => {
  it("names each status the way the plan does", () => {
    expect(cardStatusText(row({ handle: null, status: "none" }))).toBe("No card");
    expect(cardStatusText(row({ status: "member" }))).toBe("Member set up");
    expect(cardStatusText(row({ status: "hidden" }))).toBe("Hidden");
    expect(
      cardStatusText(
        row({ status: "officer_unopened", created_by_officer: true, member_opened_at: null }),
      ),
    ).toBe("Set up by officer, not opened");
  });

  it("gives a published starter card nobody has opened both badges", () => {
    const starter = row({
      status: "published",
      is_published: true,
      created_by_officer: true,
      member_opened_at: null,
    });
    expect(isUnopenedOfficerCard(starter)).toBe(true);
    expect(cardStatusBadges(starter).map((b) => b.label)).toEqual([
      "Published",
      "Set up by officer, not opened",
    ]);
    // Once the member opens it, it's just published.
    expect(
      cardStatusBadges({ ...starter, member_opened_at: "2026-10-03T00:00:00.000Z" }).map(
        (b) => b.label,
      ),
    ).toEqual(["Published"]);
  });

  it("never calls a member without a card unopened", () => {
    expect(isUnopenedOfficerCard(row({ handle: null, status: "none", member_opened_at: null }))).toBe(
      false,
    );
  });
});

describe("isCardLive", () => {
  const published = row({ status: "published", is_published: true });

  it("needs the switch on, a published card and a membership whose cards resolve", () => {
    expect(isCardLive(published, true)).toBe(true);
    expect(isCardLive({ ...published, membership_status: "alumni" }, true)).toBe(true);
    expect(isCardLive(published, false)).toBe(false);
    expect(isCardLive({ ...published, membership_status: "suspended" }, true)).toBe(false);
    expect(isCardLive({ ...published, status: "hidden" }, true)).toBe(false);
    expect(isCardLive(row({ status: "member" }), true)).toBe(false);
  });
});

describe("chipCarriesOldHandle", () => {
  it("flags a chip written before a rename, and nothing else", () => {
    expect(chipCarriesOldHandle(row({ chip_handle: "ana", chip_written_at: "2026-09-01" }))).toBe(
      true,
    );
    expect(
      chipCarriesOldHandle(row({ chip_handle: "ana-rivera", chip_written_at: "2026-09-01" })),
    ).toBe(false);
    expect(chipCarriesOldHandle(row())).toBe(false);
  });
});

describe("chipIsDead", () => {
  it("trusts the database: only chip_handle_active === false is a dead chip", () => {
    const written = { chip_handle: "ana", chip_written_at: "2026-09-01" };
    expect(chipIsDead(row({ ...written, chip_handle_active: false }))).toBe(true);
    // A rename still redirects, so an old handle on its own is not dead.
    expect(chipIsDead(row({ ...written, chip_handle_active: true }))).toBe(false);
    expect(chipIsDead(row({ ...written, chip_handle_active: null }))).toBe(false);
    expect(chipIsDead(row())).toBe(false);
  });

  it("is a filter, and says so on the programming sheet", () => {
    const dead = row({
      member_id: "9",
      handle: "ana-rivera",
      chip_handle: "ana",
      chip_handle_active: false,
      chip_written_at: "2026-09-25T15:00:00Z",
    });
    const alive = row({ member_id: "8", handle: "luis-mendez" });
    expect(filterCardRows([dead, alive], { search: "", filter: "chip_dead" })).toEqual([dead]);
    // "No longer theirs", not "dead": once someone else claims the handle, the
    // chip opens their card, so it isn't safe to call it inert.
    expect(programmingSheetCsv([dead as RowWithCard])).toContain(
      "as ana (no longer theirs: rewrite it)",
    );
  });
});

describe("search and filters", () => {
  const rows = [
    row({ member_id: "1", first_name: "José", last_name: "Peña", email: "jp@wustl.edu", handle: "jose-pena" }),
    row({ member_id: "2", first_name: "Ana", last_name: "Rivera", handle: null, status: "none" }),
    row({
      member_id: "3",
      first_name: "Luis",
      last_name: "Mendez",
      email: "lm@wustl.edu",
      handle: "luis-mendez",
      chip_handle: "luis",
      chip_written_at: "2026-09-01",
    }),
    row({ member_id: "4", first_name: "Sofia", last_name: "Castro", email: "sc@wustl.edu", handle: "sofia", status: "hidden" }),
  ];

  it("ignores accents and word order", () => {
    expect(matchesSearch(rows[0], "jose pena")).toBe(true);
    expect(matchesSearch(rows[0], "PEÑA josé")).toBe(true);
    expect(matchesSearch(rows[0], "jose rivera")).toBe(false);
    expect(matchesSearch(rows[0], "   ")).toBe(true);
  });

  it("searches emails, handles and the handle on the chip", () => {
    expect(filterCardRows(rows, { search: "lm@", filter: "all" }).map((r) => r.member_id)).toEqual(["3"]);
    expect(filterCardRows(rows, { search: "sofia", filter: "all" }).map((r) => r.member_id)).toEqual(["4"]);
    expect(matchesSearch(rows[2], "luis")).toBe(true);
  });

  it("finds a member by an old handle, the one a squatting report would name", () => {
    const squatter = row({
      member_id: "5",
      first_name: "Beto",
      last_name: "Bravo",
      handle: "beto-bravo",
      old_handles: ["rosa-rios", "beto-b"],
    });
    expect(filterCardRows([...rows, squatter], { search: "rosa-rios", filter: "all" })).toEqual([
      squatter,
    ]);
  });

  it("filters: no card, card without a chip, hidden", () => {
    const ids = (filter: Parameters<typeof filterCardRows>[1]["filter"]) =>
      filterCardRows(rows, { search: "", filter }).map((r) => r.member_id);
    expect(ids("all")).toEqual(["1", "2", "3", "4"]);
    expect(ids("no_card")).toEqual(["2"]);
    expect(ids("no_chip")).toEqual(["1", "4"]);
    expect(ids("hidden")).toEqual(["4"]);
  });
});

describe("isFallbackHandle", () => {
  it("recognises only the member-xxxxxx handle made for names a URL can't spell", () => {
    expect(isFallbackHandle("member-3f9a1c")).toBe(true);
    expect(isFallbackHandle("member-3f9a1")).toBe(false);
    expect(isFallbackHandle("member-xyz123")).toBe(false);
    expect(isFallbackHandle("members-club")).toBe(false);
    expect(isFallbackHandle("ana-rivera")).toBe(false);
    expect(isFallbackHandle(null)).toBe(false);
  });
});

describe("programmingSheetCsv", () => {
  it("writes the exact chip URL and keeps member-typed text out of formulas", () => {
    const rows = [
      row({ first_name: "=HYPERLINK(\"x\")", last_name: "Evil", email: "e@wustl.edu", handle: "evil" }),
      row({
        first_name: "Luis",
        last_name: "Mendez",
        email: "lm@wustl.edu",
        handle: "luis-mendez",
        status: "published",
        chip_handle: "luis",
        chip_written_at: "2026-09-25T23:00:00.000Z",
      }),
    ].filter(hasCard) as RowWithCard[];

    expect(programmingSheetCsv(rows).split("\r\n")).toEqual([
      "Name,Email,Handle,Chip URL,Card status,Chip written",
      "\"'=HYPERLINK(\"\"x\"\") Evil\",e@wustl.edu,evil,https://washushpe.org/card/evil?src=nfc,Member set up,Not yet",
      "Luis Mendez,lm@wustl.edu,luis-mendez,https://washushpe.org/card/luis-mendez?src=nfc,Published,\"September 25, 2026, as luis (redirects)\"",
    ]);
  });
});

describe("checkChipOrigin", () => {
  it("accepts the production origin", () => {
    expect(checkChipOrigin("https://washushpe.org/card/ana?src=nfc")).toEqual({
      origin: "https://washushpe.org",
      problems: [],
    });
  });

  it("flags development machines and plain http", () => {
    const local = checkChipOrigin("http://localhost:5173/card/ana?src=nfc");
    expect(local.origin).toBe("http://localhost:5173");
    expect(local.problems).toHaveLength(2);
    expect(local.problems.join(" ")).toMatch(/localhost/);
    expect(local.problems.join(" ")).toMatch(/http:, not https:/);

    for (const url of [
      "https://127.0.0.1:4173/card/a",
      "https://192.168.1.20/card/a",
      "https://10.0.0.5/card/a",
      "https://172.20.1.1/card/a",
      "https://[::1]:5173/card/a",
      "https://shpe.local/card/a",
    ]) {
      expect(checkChipOrigin(url).problems, url).toHaveLength(1);
    }
    expect(checkChipOrigin("https://172.32.0.1/card/a").problems).toEqual([]);
  });

  it("flags Netlify addresses, previews included", () => {
    expect(
      checkChipOrigin("https://deploy-preview-12--washushpe.netlify.app/card/a").problems,
    ).toEqual([expect.stringMatching(/netlify address/i)]);
    expect(checkChipOrigin("https://washushpe.netlify.app/card/a").problems).toHaveLength(1);
  });

  it("flags an address with no origin at all", () => {
    expect(checkChipOrigin("/card/ana?src=nfc")).toEqual({
      origin: null,
      problems: [expect.stringMatching(/isn't set/)],
    });
  });

  it("checks the address this build would write", () => {
    expect(checkThisSiteChipOrigin()).toEqual({
      example: "https://washushpe.org/card/first-last?src=nfc",
      origin: "https://washushpe.org",
      problems: [],
    });
  });
});

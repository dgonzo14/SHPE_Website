import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_CARD_MAX_RETRIES,
  cardMetaDescription,
  cardPageColor,
  cardPageTitle,
  classifyPublicCardResponse,
  claimCardView,
  isTransientCardError,
  plainText,
  publicCardRetryDelay,
  searchWithoutSource,
  shouldRetryPublicCard,
  VIEW_TTL_MS,
} from "../publicCardPage";
import { CARD_PRESETS, resolveTheme } from "../../themes";
import type { PublicCardData } from "@/types/database";

function makeCard(overrides: Partial<PublicCardData> = {}): PublicCardData {
  return {
    handle: "diego-gonzalez",
    display_name: "Diego Gonzalez",
    pronouns: null,
    headline: "SWE Intern @ Boeing",
    organization: "Washington University in St. Louis",
    status_line: null,
    bio: null,
    location: null,
    skills: [],
    languages: [],
    avatar_path: null,
    banner_path: null,
    background_path: null,
    theme: { preset: "shpe-classic" },
    sections: ["links"],
    allow_indexing: false,
    is_starter: false,
    education: null,
    shpe: { position: "President", member_since: null, national_member_verified: false, is_alumni: false },
    links: [],
    ...overrides,
  };
}

describe("isTransientCardError", () => {
  it.each([
    ["a failed fetch (no code)", { message: "TypeError: Failed to fetch", code: "" }],
    ["a thrown TypeError", new TypeError("Failed to fetch")],
    ["a gateway that answered with HTML", { message: "<html>502 Bad Gateway</html>" }],
    ["a 5xx status", { status: 503, message: "Service Unavailable" }],
    ["a request timeout", { status: 408 }],
    ["rate limiting", { status: 429 }],
    ["PostgREST unable to reach the database", { code: "PGRST000" }],
    ["PostgREST pool timeout", { code: "PGRST003" }],
    ["a dropped connection", { code: "08006" }],
    ["too many connections", { code: "53300" }],
    ["a statement timeout", { code: "57014" }],
    ["a server restarting", { code: "57P03" }],
    ["a serialization failure", { code: "40001" }],
    ["an internal error", { code: "XX000" }],
    ["something that isn't an object", "boom"],
    ["nothing at all", null],
  ])("retries %s", (_label, error) => {
    expect(isTransientCardError(error)).toBe(true);
  });

  it.each([
    ["a build without Supabase settings", new Error("The member portal is not configured for this deployment.")],
    ["permission denied", { code: "42501", message: "permission denied for function get_public_card" }],
    ["a missing function", { code: "42883" }],
    ["a deliberate 22023", { code: "22023" }],
    ["a raised exception", { code: "P0001" }],
    ["a bad JWT", { code: "PGRST301" }],
    ["a function PostgREST can't find", { code: "PGRST202" }],
    ["a 401", { status: 401 }],
    ["a 404", { status: 404, code: "" }],
  ])("does not retry %s", (_label, error) => {
    expect(isTransientCardError(error)).toBe(false);
  });
});

describe("shouldRetryPublicCard", () => {
  it("retries transient errors a bounded number of times", () => {
    const network = { message: "Failed to fetch" };
    for (let failures = 0; failures < PUBLIC_CARD_MAX_RETRIES; failures += 1) {
      expect(shouldRetryPublicCard(failures, network)).toBe(true);
    }
    expect(shouldRetryPublicCard(PUBLIC_CARD_MAX_RETRIES, network)).toBe(false);
  });

  it("never retries a permanent error", () => {
    expect(shouldRetryPublicCard(0, { code: "42501" })).toBe(false);
  });
});

describe("publicCardRetryDelay", () => {
  it("doubles from about a second and caps at eight", () => {
    const middle = () => 0.5;
    expect([0, 1, 2, 3, 4, 10].map((n) => publicCardRetryDelay(n, middle))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });

  it("jitters within ±25%", () => {
    expect(publicCardRetryDelay(1, () => 0)).toBe(1500);
    expect(publicCardRetryDelay(1, () => 0.999999)).toBe(2500);
  });
});

describe("classifyPublicCardResponse", () => {
  it("passes a live card through", () => {
    const card = makeCard();
    expect(classifyPublicCardResponse({ status: "ok", card }, "diego-gonzalez")).toEqual({ kind: "ok", card });
  });

  it("follows a redirect to a well-formed, different handle", () => {
    expect(classifyPublicCardResponse({ status: "redirect", handle: "diego-g" }, "diego")).toEqual({
      kind: "redirect",
      handle: "diego-g",
    });
  });

  it("treats a redirect that would loop or go somewhere odd as not found", () => {
    expect(classifyPublicCardResponse({ status: "redirect", handle: "diego" }, "diego").kind).toBe("not_found");
    expect(classifyPublicCardResponse({ status: "redirect", handle: "../admin" }, "diego").kind).toBe("not_found");
    expect(classifyPublicCardResponse({ status: "redirect" }, "diego").kind).toBe("not_found");
  });

  it("reads not_found", () => {
    expect(classifyPublicCardResponse({ status: "not_found" }, "diego").kind).toBe("not_found");
  });

  it.each([null, undefined, "ok", 42, {}, { status: "ok" }, { status: "ok", card: null }, { status: "weird" }])(
    "calls %j invalid rather than guessing",
    (data) => {
      expect(classifyPublicCardResponse(data, "diego").kind).toBe("invalid");
    },
  );
});

describe("searchWithoutSource", () => {
  it("removes src and keeps everything else", () => {
    expect(searchWithoutSource("?src=nfc")).toBe("");
    expect(searchWithoutSource("?src=qr&utm_source=fair")).toBe("?utm_source=fair");
    expect(searchWithoutSource("?a=1&src=nfc&b=2")).toBe("?a=1&b=2");
  });

  it("leaves a query string without src exactly as it was", () => {
    expect(searchWithoutSource("")).toBe("");
    expect(searchWithoutSource("?utm_source=fair%20day")).toBe("?utm_source=fair%20day");
  });
});

describe("page title and description", () => {
  it("names the member", () => {
    expect(cardPageTitle("Diego Gonzalez")).toBe("Diego Gonzalez | WashU SHPE");
  });

  it("falls back when the name is blank", () => {
    expect(cardPageTitle("   ")).toBe("WashU SHPE member | WashU SHPE");
  });

  it("matches the edge function's description", () => {
    expect(cardMetaDescription(makeCard())).toBe(
      "SWE Intern @ Boeing · President, WashU SHPE · Washington University in St. Louis",
    );
  });

  it("describes a starter card from what it has", () => {
    const starter = makeCard({ headline: null, is_starter: true });
    expect(cardMetaDescription(starter)).toBe("President, WashU SHPE · Washington University in St. Louis");
  });

  it("has a fallback for a card with nothing to say", () => {
    const bare = makeCard({
      headline: null,
      organization: null,
      shpe: { position: null, member_since: null, national_member_verified: false, is_alumni: false },
    });
    expect(cardMetaDescription(bare)).toBe("Digital business card · WashU SHPE");
  });

  it("cleans whitespace and control characters and truncates by character", () => {
    expect(plainText("  a\n\tb\u0007c\u0085 ", 10)).toBe("a bc");
    expect(plainText("é".repeat(12), 10)).toBe(`${"é".repeat(9)}…`);
    expect(plainText(null, 10)).toBe("");
  });
});

describe("cardPageColor", () => {
  it("uses the theme background for solid and pattern backgrounds", () => {
    const classic = resolveTheme({ preset: "shpe-classic", background: { type: "solid" } });
    expect(cardPageColor(classic, false)).toBe(classic.colors.background);
    const pattern = resolveTheme({ preset: "engineer", background: { type: "pattern", pattern: "grid" } });
    expect(cardPageColor(pattern, false)).toBe(pattern.colors.background);
  });

  it("uses the gradient's first stop for gradients, and for a photo background with no photo", () => {
    const gradient = resolveTheme({ preset: "sunrise", background: { type: "gradient", from: "#112233", to: "#445566" } });
    expect(cardPageColor(gradient, false)).toBe("#112233");
    const image = resolveTheme({ preset: "glass", background: { type: "image", from: "#abcdef" } });
    expect(cardPageColor(image, false)).toBe("#abcdef");
    expect(cardPageColor(image, true)).toBe(image.colors.background);
  });

  it("is a hex colour for every preset", () => {
    for (const info of Object.values(CARD_PRESETS)) {
      expect(cardPageColor(info.theme, false)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("claimCardView", () => {
  const T0 = Date.UTC(2026, 9, 6, 15, 0);
  const minutes = (n: number) => n * 60_000;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("says yes once per card per 30 minutes", () => {
    expect(VIEW_TTL_MS).toBe(minutes(30));
    expect(claimCardView("diego", T0)).toBe(true);
    expect(claimCardView("diego", T0 + minutes(1))).toBe(false);
    expect(claimCardView("ana-rivera", T0 + minutes(1))).toBe(true);
    expect(claimCardView("diego", T0 + minutes(29))).toBe(false);
    // Coming back later counts again, and starts a new window.
    expect(claimCardView("diego", T0 + minutes(31))).toBe(true);
    expect(claimCardView("diego", T0 + minutes(45))).toBe(false);
  });

  // An NFC tap or a camera scan opens a new tab, which starts with an empty
  // sessionStorage. The second tap must still be the same visitor.
  it("counts a second tap that opens a new tab as the same view", () => {
    expect(claimCardView("diego", T0)).toBe(true);
    sessionStorage.clear(); // what a fresh tab sees
    expect(claimCardView("diego", T0 + minutes(2))).toBe(false);
    expect(localStorage.getItem("washu-shpe-card-viewed:diego")).toBe(String(T0));
  });

  it("clears markers whose window has passed, so the browser keeps no list of cards seen", () => {
    claimCardView("diego", T0);
    claimCardView("ana-rivera", T0 + minutes(20));
    localStorage.setItem("washu-shpe-card-viewed:garbled", "not a time");
    localStorage.setItem("something-else", "kept");

    claimCardView("maria", T0 + minutes(40));

    expect(localStorage.getItem("washu-shpe-card-viewed:diego")).toBeNull();
    expect(localStorage.getItem("washu-shpe-card-viewed:garbled")).toBeNull();
    expect(localStorage.getItem("washu-shpe-card-viewed:ana-rivera")).toBe(String(T0 + minutes(20)));
    expect(localStorage.getItem("washu-shpe-card-viewed:maria")).toBe(String(T0 + minutes(40)));
    expect(localStorage.getItem("something-else")).toBe("kept");
  });

  it("counts again if the clock has moved backwards past the marker", () => {
    expect(claimCardView("diego", T0)).toBe(true);
    expect(claimCardView("diego", T0 - minutes(60))).toBe(true);
  });

  it("falls back to the same window within the page where storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(claimCardView("no-storage", T0)).toBe(true);
    expect(claimCardView("no-storage", T0 + minutes(5))).toBe(false);
    expect(claimCardView("no-storage", T0 + minutes(31))).toBe(true);
  });

  it("uses the current time by default", () => {
    expect(claimCardView("diego")).toBe(true);
    expect(claimCardView("diego")).toBe(false);
  });
});

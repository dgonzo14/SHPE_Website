import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { onlineManager } from "@tanstack/react-query";

import { PublicCard } from "../PublicCard";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PUBLIC_CARD_MAX_RETRIES, cardPageColor } from "@/features/cards/public/publicCardPage";
import { resolveTheme } from "@/features/cards/themes";
import type { CardEvent, CardSource } from "@/features/cards/model";
import type { PublicCardData, PublicCardResponse } from "@/types/database";

/*
 * The page around the card: which of its states shows, what it counts, and
 * what it does to the address bar and <head>. The renderer itself is real
 * (it's light, and clicking its buttons is the honest test); the backend, the
 * vCard builder and the share sheet are mocked.
 */

const fetchPublicCard = vi.fn<(handle: string) => Promise<PublicCardResponse>>();
const recordCardEvent =
  vi.fn<(handle: string, event: CardEvent, source: CardSource, linkId?: string) => Promise<void>>();

vi.mock("@/services/cards", () => ({
  fetchPublicCard: (handle: string) => fetchPublicCard(handle),
  recordCardEvent: (handle: string, event: CardEvent, source: CardSource, linkId?: string) =>
    recordCardEvent(handle, event, source, linkId),
  cardUrl: (handle: string, source?: string) =>
    `https://washushpe.org/card/${handle}${source && source !== "link" ? `?src=${source}` : ""}`,
  cardMediaUrl: (path: string | null) => (path ? `https://media.test/${path}` : null),
}));

const downloadVCard = vi.fn<(card: PublicCardData, opts: { cardUrl: string }) => Promise<void>>();
vi.mock("@/features/cards/vcard", () => ({
  downloadVCard: (card: PublicCardData, opts: { cardUrl: string }) => downloadVCard(card, opts),
}));

const shareCard =
  vi.fn<(opts: { url: string; title: string }) => Promise<"shared" | "copied" | "cancelled" | "failed">>();
vi.mock("@/features/cards/share", () => ({
  shareCard: (opts: { url: string; title: string }) => shareCard(opts),
}));

// Tests run without Supabase settings, so the page would always say "not
// connected". A getter lets one test switch that back on.
const backend = vi.hoisted(() => ({ configured: true }));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    get isSupabaseConfigured() {
      return backend.configured;
    },
  };
});

function makeCard(overrides: Partial<PublicCardData> = {}): PublicCardData {
  return {
    handle: "diego-gonzalez",
    display_name: "Diego Gonzalez",
    pronouns: "he/him",
    headline: "SWE Intern @ Boeing",
    organization: "Washington University in St. Louis",
    status_line: "Seeking Summer 2027 internships",
    bio: null,
    location: null,
    skills: [],
    languages: [],
    avatar_path: null,
    banner_path: null,
    background_path: null,
    theme: { preset: "shpe-classic" },
    sections: ["status", "links", "education", "shpe"],
    allow_indexing: false,
    is_starter: false,
    education: { major: "Computer Science", secondary_major: null, graduation_year: 2027, degree_level: "undergraduate" },
    shpe: { position: "President", member_since: null, national_member_verified: false, is_alumni: false },
    links: [
      { id: "l-linkedin", kind: "linkedin", label: null, value: "https://www.linkedin.com/in/diego", is_featured: false },
      { id: "l-email", kind: "email", label: null, value: "diego@wustl.edu", is_featured: false },
    ],
    ...overrides,
  };
}

function ok(card: PublicCardData = makeCard()): PublicCardResponse {
  return { status: "ok", card };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</span>;
}

function renderPage(path = "/card/diego-gonzalez") {
  return renderWithProviders(
    <Routes>
      <Route
        path="/card/:handle"
        element={
          <>
            <PublicCard />
            <LocationProbe />
          </>
        }
      />
      <Route path="/portal/card" element={<p>My Card editor</p>} />
      <Route path="/" element={<p>Chapter home</p>} />
    </Routes>,
    { route: path, auth: { status: "signed-out", session: null, user: null, profile: null } },
  );
}

const currentLocation = () => screen.getByTestId("location").textContent;
const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null;
const findCardName = () => screen.findByRole("heading", { level: 1, name: "Diego Gonzalez" });
const viewCalls = () => recordCardEvent.mock.calls.filter(([, event]) => event === "view");

/** Clicks a link without jsdom trying (and noisily failing) to follow it. */
function clickWithoutNavigating(element: Element) {
  const cancel = (event: Event) => event.preventDefault();
  window.addEventListener("click", cancel);
  fireEvent.click(element);
  window.removeEventListener("click", cancel);
}

beforeEach(() => {
  backend.configured = true;
  // claimCardView remembers views in localStorage, which outlives each test.
  localStorage.clear();
  sessionStorage.clear();
  fetchPublicCard.mockReset();
  recordCardEvent.mockReset();
  recordCardEvent.mockResolvedValue(undefined);
  downloadVCard.mockReset();
  downloadVCard.mockResolvedValue(undefined);
  shareCard.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

/* ── States ──────────────────────────────────────────────────────────────── */

describe("PublicCard: a live card", () => {
  it("renders the card, titled with the member's name", async () => {
    fetchPublicCard.mockResolvedValue(ok());
    renderPage();

    expect(await findCardName()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add to contacts/i })).toBeInTheDocument();
    expect(document.querySelector('[data-card-mode="public"]')).not.toBeNull();
    expect(fetchPublicCard).toHaveBeenCalledWith("diego-gonzalez");
    expect(document.title).toBe("Diego Gonzalez | WashU SHPE");
  });

  it("is noindex unless the member opted in", async () => {
    fetchPublicCard.mockResolvedValue(ok());
    renderPage();
    await findCardName();
    expect(robots()).toBe("noindex, nofollow");
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("can be indexed, under one canonical address, when the member opted in", async () => {
    fetchPublicCard.mockResolvedValue(ok(makeCard({ allow_indexing: true })));
    renderPage("/card/diego-gonzalez?src=nfc");
    await findCardName();
    await waitFor(() => expect(robots()).toBeNull());
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://washushpe.org/card/diego-gonzalez",
    );
  });

  it("describes the card in <head> and puts the old description back on the way out", async () => {
    const existing = document.createElement("meta");
    existing.setAttribute("name", "description");
    existing.setAttribute("content", "The chapter site.");
    document.head.appendChild(existing);
    try {
      fetchPublicCard.mockResolvedValue(ok());
      const { unmount } = renderPage();
      await findCardName();
      expect(existing.getAttribute("content")).toBe(
        "SWE Intern @ Boeing · President, WashU SHPE · Washington University in St. Louis",
      );

      unmount();
      expect(existing.getAttribute("content")).toBe("The chapter site.");
      expect(robots()).toBeNull();
    } finally {
      existing.remove();
    }
  });

  it("paints the page behind the card in the theme's colour, and gives it back", async () => {
    const card = makeCard({ theme: { preset: "midnight" } });
    fetchPublicCard.mockResolvedValue(ok(card));
    const { unmount } = renderPage();
    await findCardName();

    const expected = cardPageColor(resolveTheme(card.theme), false);
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(expected);
    expect(document.body.style.backgroundColor).not.toBe("");
    expect(document.documentElement.style.backgroundColor).not.toBe("");

    unmount();
    expect(document.body.style.backgroundColor).toBe("");
    expect(document.documentElement.style.backgroundColor).toBe("");
    expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull();
  });
});

describe("PublicCard: loading", () => {
  it("shows a neutral skeleton while the card loads", () => {
    fetchPublicCard.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByTestId("public-card-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/loading business card/i);
    expect(screen.queryByText(/taking longer/i)).not.toBeInTheDocument();
    expect(robots()).toBe("noindex, nofollow");
  });

  it("keeps the title the page arrived with until the card loads", async () => {
    // What the card-meta edge function writes before any JavaScript runs.
    document.title = "Diego Gonzalez | WashU SHPE";
    let answer: (response: PublicCardResponse) => void = () => {};
    fetchPublicCard.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderPage();
    expect(document.title).toBe("Diego Gonzalez | WashU SHPE");

    act(() => answer(ok(makeCard({ display_name: "Diego G." }))));
    await screen.findByRole("heading", { level: 1, name: "Diego G." });
    expect(document.title).toBe("Diego G. | WashU SHPE");
    document.title = "";
  });

  it("explains a phone with no connection, then loads when it comes back", async () => {
    onlineManager.setOnline(false);
    fetchPublicCard.mockResolvedValue(ok());
    renderPage();

    expect(await screen.findByText(/you're offline/i)).toBeInTheDocument();
    expect(fetchPublicCard).not.toHaveBeenCalled();

    act(() => onlineManager.setOnline(true));
    expect(await findCardName()).toBeInTheDocument();
  });
});

describe("PublicCard: redirects and handles", () => {
  it("follows an old handle to the current one", async () => {
    fetchPublicCard.mockImplementation(async (handle) =>
      handle === "diego" ? { status: "redirect", handle: "diego-gonzalez" } : ok(),
    );
    renderPage("/card/diego?src=nfc");

    expect(await findCardName()).toBeInTheDocument();
    expect(fetchPublicCard).toHaveBeenCalledWith("diego");
    expect(fetchPublicCard).toHaveBeenCalledWith("diego-gonzalez");
    await waitFor(() => expect(currentLocation()).toBe("/card/diego-gonzalez"));
    // Counted against the current handle, credited to the chip.
    await waitFor(() => expect(recordCardEvent).toHaveBeenCalledWith("diego-gonzalez", "view", "nfc", undefined));
  });

  it("keeps the query string through the redirect", async () => {
    fetchPublicCard.mockImplementation((handle) =>
      handle === "diego"
        ? Promise.resolve({ status: "redirect", handle: "diego-gonzalez" })
        : new Promise(() => {}),
    );
    renderPage("/card/diego?src=nfc&utm_source=fair#top");

    await waitFor(() => expect(currentLocation()).toBe("/card/diego-gonzalez?src=nfc&utm_source=fair#top"));
    expect(screen.getByTestId("public-card-skeleton")).toBeInTheDocument();
  });

  it("lowercases the handle in the address bar and only asks for the lowercase one", async () => {
    fetchPublicCard.mockReturnValue(new Promise(() => {}));
    renderPage("/card/Diego-Gonzalez?src=nfc");

    await waitFor(() => expect(currentLocation()).toBe("/card/diego-gonzalez?src=nfc"));
    expect(fetchPublicCard.mock.calls.map(([handle]) => handle)).toEqual(["diego-gonzalez"]);
  });

  it("doesn't ask the backend about a handle that can't exist", async () => {
    renderPage("/card/no");
    expect(await screen.findByRole("heading", { name: /this card isn't available/i })).toBeInTheDocument();
    expect(fetchPublicCard).not.toHaveBeenCalled();
  });
});

describe("PublicCard: not found", () => {
  it("is a friendly branded page that never says why", async () => {
    fetchPublicCard.mockResolvedValue({ status: "not_found" });
    renderPage("/card/someone?src=nfc");

    expect(await screen.findByRole("heading", { level: 1, name: "This card isn't available" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "WashU SHPE" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /visit washu shpe/i })).toHaveAttribute("href", "/");
    expect(screen.getByText(/are you a washu shpe member/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /make your own card/i })).toHaveAttribute("href", "/portal/card");
    expect(document.body.textContent).not.toMatch(/unpublished|hidden|suspended|deleted|doesn't exist/i);

    expect(robots()).toBe("noindex, nofollow");
    expect(document.title).toBe("Card not available | WashU SHPE");
    expect(recordCardEvent).not.toHaveBeenCalled();
  });

  it("sends a member off to make their own card", async () => {
    fetchPublicCard.mockResolvedValue({ status: "not_found" });
    const user = userEvent.setup();
    renderPage("/card/someone");

    await user.click(await screen.findByRole("link", { name: /make your own card/i }));
    expect(screen.getByText("My Card editor")).toBeInTheDocument();
  });
});

describe("PublicCard: backend unavailable", () => {
  it("shows a branded page with a retry when the card can't be loaded", async () => {
    fetchPublicCard.mockRejectedValueOnce({ code: "42501", message: "permission denied" });
    fetchPublicCard.mockResolvedValueOnce(ok());
    const user = userEvent.setup();
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Card temporarily unavailable");
    expect(alert.textContent).not.toMatch(/permission|42501/i);
    expect(screen.getByRole("link", { name: /visit washu shpe/i })).toHaveAttribute("href", "/");
    expect(robots()).toBe("noindex, nofollow");
    // A permanent error isn't retried behind the visitor's back.
    expect(fetchPublicCard).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await findCardName()).toBeInTheDocument();
  });

  it("treats an answer it doesn't understand as unavailable, not as a card", async () => {
    fetchPublicCard.mockResolvedValue({ status: "ok" } as unknown as PublicCardResponse);
    renderPage();
    expect(await screen.findByRole("heading", { name: /temporarily unavailable/i })).toBeInTheDocument();
  });

  it("retries a backend that is slow to wake, says so, and recovers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fetchPublicCard.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchPublicCard.mockResolvedValue(ok());
    renderPage();

    expect(await screen.findByText(/taking longer than usual/i)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(await findCardName()).toBeInTheDocument();
    expect(fetchPublicCard).toHaveBeenCalledTimes(2);
  });

  it("gives up after a few retries and shows the unavailable page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fetchPublicCard.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage();

    await screen.findByText(/taking longer than usual/i);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(await screen.findByRole("heading", { name: /temporarily unavailable/i })).toBeInTheDocument();
    expect(fetchPublicCard).toHaveBeenCalledTimes(1 + PUBLIC_CARD_MAX_RETRIES);
  });

  it("explains a build with no backend, without a retry that can't help", async () => {
    backend.configured = false;
    renderPage();

    expect(await screen.findByRole("heading", { name: /temporarily unavailable/i })).toBeInTheDocument();
    expect(screen.getByText(/isn't connected/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /visit washu shpe/i })).toBeInTheDocument();
    expect(fetchPublicCard).not.toHaveBeenCalled();
  });
});

/* ── Counting and the address bar ────────────────────────────────────────── */

describe("PublicCard: counting views", () => {
  it.each([
    ["?src=nfc", "nfc"],
    ["?src=qr", "qr"],
    ["", "link"],
    ["?src=somewhere-else", "link"],
  ])("credits %j to %s", async (search, source) => {
    fetchPublicCard.mockResolvedValue(ok());
    renderPage(`/card/diego-gonzalez${search}`);
    await findCardName();
    await waitFor(() => expect(viewCalls()).toEqual([["diego-gonzalez", "view", source, undefined]]));
  });

  it("counts one view per card per 30 minutes in a browser", async () => {
    fetchPublicCard.mockResolvedValue(ok());
    const first = renderPage("/card/diego-gonzalez?src=nfc");
    await findCardName();
    await waitFor(() => expect(viewCalls()).toHaveLength(1));
    first.unmount();

    // Tapping the chip again opens a new tab, which starts with an empty
    // sessionStorage; it's still the same visitor.
    sessionStorage.clear();
    renderPage("/card/diego-gonzalez?src=nfc");
    await findCardName();
    await waitFor(() => expect(currentLocation()).toBe("/card/diego-gonzalez"));
    expect(viewCalls()).toHaveLength(1);
  });

  it("counts a different card separately", async () => {
    fetchPublicCard.mockImplementation(async (handle) =>
      ok(makeCard({ handle, display_name: handle === "ana-rivera" ? "Ana Rivera" : "Diego Gonzalez" })),
    );
    const first = renderPage("/card/diego-gonzalez");
    await findCardName();
    first.unmount();

    renderPage("/card/ana-rivera");
    await screen.findByRole("heading", { level: 1, name: "Ana Rivera" });
    await waitFor(() => expect(viewCalls().map(([handle]) => handle)).toEqual(["diego-gonzalez", "ana-rivera"]));
  });

  it("takes ?src off the address once the visit is counted, keeping everything else", async () => {
    fetchPublicCard.mockResolvedValue(ok());
    renderPage("/card/diego-gonzalez?src=qr&utm_source=fair#links");
    await findCardName();
    await waitFor(() => expect(currentLocation()).toBe("/card/diego-gonzalez?utm_source=fair#links"));
  });

  it("leaves ?src alone when there's no card, so a reload still counts the tap", async () => {
    fetchPublicCard.mockResolvedValue({ status: "not_found" });
    renderPage("/card/someone?src=nfc");
    await screen.findByRole("heading", { name: /this card isn't available/i });
    expect(currentLocation()).toBe("/card/someone?src=nfc");
  });
});

/* ── Actions ─────────────────────────────────────────────────────────────── */

describe("PublicCard: Add to Contacts", () => {
  it("downloads the vCard and counts a save", async () => {
    const card = makeCard();
    fetchPublicCard.mockResolvedValue(ok(card));
    const user = userEvent.setup();
    renderPage("/card/diego-gonzalez?src=nfc");

    await user.click(await screen.findByRole("button", { name: /add to contacts/i }));

    await waitFor(() =>
      expect(downloadVCard).toHaveBeenCalledWith(card, { cardUrl: "https://washushpe.org/card/diego-gonzalez" }),
    );
    await waitFor(() => expect(recordCardEvent).toHaveBeenCalledWith("diego-gonzalez", "save", "nfc", undefined));
  });

  it("ignores a second tap while the first contact is still being made", async () => {
    let finish: () => void = () => {};
    downloadVCard.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    fetchPublicCard.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole("button", { name: /add to contacts/i });
    await user.click(button);
    await waitFor(() => expect(downloadVCard).toHaveBeenCalledTimes(1));
    await user.click(button);
    expect(downloadVCard).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    await user.click(button);
    await waitFor(() => expect(downloadVCard).toHaveBeenCalledTimes(2));
  });

  it("says so when the contact can't be made, and counts nothing", async () => {
    downloadVCard.mockRejectedValue(new Error("chunk failed to load"));
    fetchPublicCard.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /add to contacts/i }));
    expect(await screen.findByText("Couldn't create the contact")).toBeInTheDocument();
    expect(recordCardEvent.mock.calls.some(([, event]) => event === "save")).toBe(false);
  });
});

describe("PublicCard: sharing", () => {
  it("shares the plain card address and counts it", async () => {
    shareCard.mockResolvedValue("shared");
    fetchPublicCard.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPage("/card/diego-gonzalez?src=qr");

    await user.click(await screen.findByRole("button", { name: "Share" }));
    expect(shareCard).toHaveBeenCalledWith({
      url: "https://washushpe.org/card/diego-gonzalez",
      title: "Diego Gonzalez | WashU SHPE",
    });
    await waitFor(() => expect(recordCardEvent).toHaveBeenCalledWith("diego-gonzalez", "share", "qr", undefined));
    expect(screen.queryByText("Link copied")).not.toBeInTheDocument();
  });

  it("confirms a copied link", async () => {
    shareCard.mockResolvedValue("copied");
    fetchPublicCard.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Share" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(recordCardEvent).toHaveBeenCalledWith("diego-gonzalez", "share", "link", undefined);
  });

  it("counts nothing when the visitor closes the share sheet", async () => {
    shareCard.mockResolvedValue("cancelled");
    fetchPublicCard.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Share" }));
    await waitFor(() => expect(shareCard).toHaveBeenCalledTimes(1));
    expect(recordCardEvent.mock.calls.some(([, event]) => event === "share")).toBe(false);
    expect(screen.queryByText("Link copied")).not.toBeInTheDocument();
  });

  it("offers the address when neither sharing nor copying worked", async () => {
    shareCard.mockResolvedValue("failed");
    fetchPublicCard.mockResolvedValue(ok());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Share" }));
    expect(await screen.findByText(/copy this address instead: https:\/\/washushpe\.org\/card\/diego-gonzalez/i)).toBeInTheDocument();
    expect(recordCardEvent.mock.calls.some(([, event]) => event === "share")).toBe(false);
  });
});

describe("PublicCard: link clicks", () => {
  it("counts a click on a link, with the link's id and the visit's source", async () => {
    fetchPublicCard.mockResolvedValue(ok());
    renderPage("/card/diego-gonzalez?src=qr");

    const linkedin = (await screen.findAllByRole("link")).find(
      (link) => link.getAttribute("data-link-kind") === "linkedin",
    );
    expect(linkedin).toHaveAttribute("href", "https://www.linkedin.com/in/diego");
    clickWithoutNavigating(linkedin!);

    expect(recordCardEvent).toHaveBeenCalledWith("diego-gonzalez", "link_click", "qr", "l-linkedin");
  });
});

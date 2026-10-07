import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { OfficerCardPrompt } from "../OfficerCardPrompt";
import { Dashboard } from "@/pages/portal/Dashboard";
import { renderWithProviders, testProfile } from "@/test/renderWithProviders";
import { queryKeys } from "@/services/queryKeys";
import type {
  AcademicTermRow,
  AppConfig,
  MemberCard,
  MemberDashboard,
  MyCardResponse,
  MyCardState,
} from "@/types/database";

/*
 * The dashboard's "an officer set up your card" prompt. Whether get_my_card()
 * returns a switched-off answer is the database's call (cards.test.sql); here
 * the questions are when the dashboard asks at all, and that it only nudges a
 * member about a card an officer made and they haven't opened.
 */

const fetchMyCard = vi.fn<() => Promise<MyCardResponse>>();
const fetchAppConfig = vi.fn<() => Promise<AppConfig>>();
const fetchTerms = vi.fn<() => Promise<AcademicTermRow[]>>();
const fetchDashboard = vi.fn<(termId: string | null) => Promise<MemberDashboard>>();

vi.mock("@/services/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cards")>()),
  fetchMyCard: () => fetchMyCard(),
  cardUrl: (handle: string) => `https://washushpe.org/card/${handle}`,
}));

vi.mock("@/services/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/content")>()),
  fetchAppConfig: () => fetchAppConfig(),
  fetchTerms: () => fetchTerms(),
}));

vi.mock("@/services/points", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/points")>()),
  fetchDashboard: (termId: string | null) => fetchDashboard(termId),
}));

function card(overrides: Partial<MemberCard> = {}): MemberCard {
  return {
    member_id: testProfile.id,
    handle: "ana-rivera",
    is_published: false,
    allow_indexing: false,
    hidden_at: null,
    hidden_reason: null,
    created_by_officer: true,
    member_opened_at: null,
    chip_handle: null,
    chip_handle_active: null,
    chip_written_at: null,
    display_name: "Ana Rivera",
    pronouns: null,
    headline: null,
    organization: "Washington University in St. Louis",
    status_line: null,
    bio: null,
    location: null,
    skills: [],
    languages: [],
    avatar_path: null,
    banner_path: null,
    background_path: null,
    show_major: true,
    show_graduation_year: true,
    show_member_since: false,
    show_national_member: true,
    show_chapter_position: true,
    theme: { preset: "shpe-classic" },
    sections: ["status", "featured", "links", "about", "education", "shpe"],
    created_at: "2026-10-20T23:00:00.000Z",
    updated_at: "2026-10-20T23:00:00.000Z",
    ...overrides,
  };
}

function state(cardValue: MemberCard | null, enabled = true): MyCardState {
  return {
    enabled,
    card: cardValue,
    links: [],
    position: null,
    profile: {
      first_name: "Ana",
      last_name: "Rivera",
      major: "Computer Science",
      secondary_major: null,
      graduation_year: 2028,
      degree_level: "undergraduate",
      member_since: "2025-08-25",
      national_member_verified: false,
      membership_status: "active",
    },
  };
}

const OFFICER = { isOfficer: true, roles: ["member", "officer"] as ("member" | "officer")[] };

beforeEach(() => {
  fetchAppConfig.mockResolvedValue({ cards_enabled: true });
  fetchMyCard.mockResolvedValue(state(card()));
});

describe("OfficerCardPrompt", () => {
  it("tells a member an officer made their card and links to the editor", async () => {
    renderWithProviders(<OfficerCardPrompt />, { route: "/portal" });

    expect(await screen.findByText("An officer set up your business card")).toBeInTheDocument();
    expect(screen.getByText(/washushpe\.org\/card\/ana-rivera/)).toBeInTheDocument();
    expect(screen.getByText(/add your links and publish it/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /finish my card/i })).toHaveAttribute(
      "href",
      "/portal/card",
    );
  });

  it("says when the chip already carries the card, and when it's live as a starter", async () => {
    fetchMyCard.mockResolvedValue(
      state(
        card({
          is_published: true,
          chip_handle: "ana-rivera",
          chip_written_at: "2026-10-21T00:00:00.000Z",
        }),
      ),
    );
    renderWithProviders(<OfficerCardPrompt />, { route: "/portal" });

    expect(await screen.findByText(/that's the address on your nfc card/i)).toBeInTheDocument();
    expect(screen.getByText(/live as a starter card/i)).toBeInTheDocument();
  });

  it("doesn't ask about cards at all while they're switched off for members", async () => {
    fetchAppConfig.mockResolvedValue({ cards_enabled: false });
    const { queryClient } = renderWithProviders(<OfficerCardPrompt />, { route: "/portal" });

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.appConfig)?.status).toBe("success"),
    );
    expect(fetchMyCard).not.toHaveBeenCalled();
    expect(screen.queryByText(/an officer set up/i)).not.toBeInTheDocument();
  });

  it("still asks for an officer, who can work on their card before launch", async () => {
    fetchAppConfig.mockResolvedValue({ cards_enabled: false });
    fetchMyCard.mockResolvedValue(state(card(), false));
    renderWithProviders(<OfficerCardPrompt />, { route: "/portal", auth: OFFICER });

    expect(await screen.findByText("An officer set up your business card")).toBeInTheDocument();
  });

  it("doesn't call a published starter card live before cards are switched on", async () => {
    fetchAppConfig.mockResolvedValue({ cards_enabled: false });
    fetchMyCard.mockResolvedValue(state(card({ is_published: true }), false));
    renderWithProviders(<OfficerCardPrompt />, { route: "/portal", auth: OFFICER });

    expect(
      await screen.findByText(/published as a starter card .* goes live when business cards are turned on/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/live as a starter card/i)).not.toBeInTheDocument();
  });

  it.each([
    ["a switched-off response", { enabled: false } as MyCardResponse],
    ["no card", state(null)],
    ["a card the member made", state(card({ created_by_officer: false, member_opened_at: "2026-10-01T00:00:00Z" }))],
    ["an officer-made card the member has opened", state(card({ member_opened_at: "2026-10-22T00:00:00Z" }))],
    ["a hidden card", state(card({ hidden_at: "2026-10-22T00:00:00Z", hidden_reason: "Review" }))],
  ])("shows nothing for %s", async (_label, response) => {
    fetchMyCard.mockResolvedValue(response);
    const { queryClient } = renderWithProviders(<OfficerCardPrompt />, { route: "/portal" });

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.cards.mine)?.status).toBe("success"),
    );
    expect(screen.queryByText(/an officer set up/i)).not.toBeInTheDocument();
  });

  it("shows nothing when the request fails", async () => {
    fetchMyCard.mockRejectedValue(new Error("network"));
    const { queryClient } = renderWithProviders(<OfficerCardPrompt />, { route: "/portal" });

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.cards.mine)?.status).toBe("error"),
    );
    expect(screen.queryByText(/an officer set up/i)).not.toBeInTheDocument();
  });
});

describe("Dashboard", () => {
  const DASHBOARD: MemberDashboard = {
    profile: {
      id: testProfile.id,
      first_name: "Ana",
      last_name: "Rivera",
      email: testProfile.email,
      membership_status: "active",
      member_since: "2025-08-25",
    },
    roles: ["member"],
    term: null,
    points: {
      member_id: testProfile.id,
      term_id: null,
      academic_year: null,
      total_points: 25,
      events_attended: 2,
      top_percent: null,
      ranked_member_count: 0,
      by_category: [],
    },
    next_event: null,
    recent_points: [],
    announcements: [],
    membership: null,
  };

  beforeEach(() => {
    fetchTerms.mockResolvedValue([]);
    fetchDashboard.mockResolvedValue(DASHBOARD);
  });

  it("shows the card prompt above the member's usual dashboard", async () => {
    renderWithProviders(<Dashboard />, { route: "/portal" });

    expect(await screen.findByText("An officer set up your business card")).toBeInTheDocument();
    expect(await screen.findByText("25 pts")).toBeInTheDocument();
  });

  it("is the usual dashboard when there's no officer-made card", async () => {
    fetchMyCard.mockResolvedValue(state(null));
    renderWithProviders(<Dashboard />, { route: "/portal" });

    expect(await screen.findByText("25 pts")).toBeInTheDocument();
    expect(screen.queryByText(/an officer set up/i)).not.toBeInTheDocument();
  });
});

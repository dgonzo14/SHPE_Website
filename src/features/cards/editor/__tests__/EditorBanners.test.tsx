import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "@/test/renderWithProviders";
import type { MemberCard, MyCardState } from "@/types/database";
import { EditorBanners } from "../EditorBanners";

const CARD: MemberCard = {
  member_id: "11111111-1111-4111-8111-111111111111",
  handle: "ana-rivera",
  is_published: false,
  allow_indexing: false,
  hidden_at: null,
  hidden_reason: null,
  created_by_officer: false,
  member_opened_at: "2026-09-20T15:00:00.000Z",
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
  created_at: "2026-10-20T17:00:00.000Z",
  updated_at: "2026-10-20T17:00:00.000Z",
};

function state(card: Partial<MemberCard> | null, overrides: Partial<MyCardState> = {}): MyCardState {
  return {
    enabled: true,
    card: card ? { ...CARD, ...card } : null,
    links: [],
    position: null,
    profile: {
      first_name: "Ana",
      last_name: "Rivera",
      major: null,
      secondary_major: null,
      graduation_year: null,
      degree_level: null,
      member_since: "2025-08-25",
      national_member_verified: false,
      membership_status: "active",
    },
    ...overrides,
  };
}

function banners() {
  return screen.queryAllByRole("status").map((node) => node.textContent ?? "");
}

describe("EditorBanners", () => {
  it("welcomes a member with no card yet, and says nothing is public", () => {
    renderWithProviders(<EditorBanners state={state(null)} isOfficer={false} />);
    expect(banners()).toEqual([expect.stringContaining("Nothing is public until you do.")]);
  });

  it("calls a saved, unpublished card a draft", () => {
    renderWithProviders(<EditorBanners state={state({})} isOfficer={false} />);
    expect(banners()).toEqual([expect.stringMatching(/^Your card is a draftOnly you can see it/)]);
  });

  it("says nothing when the card is live", () => {
    renderWithProviders(<EditorBanners state={state({ is_published: true })} isOfficer={false} />);
    expect(banners()).toEqual([]);
  });

  it("warns that a published starter card goes live in full on the first save", () => {
    renderWithProviders(
      <EditorBanners
        state={state({ created_by_officer: true, member_opened_at: null, is_published: true })}
        isOfficer={false}
      />,
    );
    const [text] = banners();
    expect(text).toContain("An officer set up your card on October 20, 2026.");
    // No chip recorded yet, so the banner gives the address rather than claiming a chip.
    expect(text).toMatch(/Its address is \S*\/card\/ana-rivera\./);
    expect(text).toContain("When you save, everything you add goes live too.");
    expect(banners()).toHaveLength(1);
  });

  it("puts a hidden card first and drops the officer-made prompt, which can't be followed", () => {
    renderWithProviders(
      <EditorBanners
        state={state({
          created_by_officer: true,
          member_opened_at: null,
          hidden_at: "2026-10-21T00:00:00.000Z",
          hidden_reason: null,
        })}
        isOfficer={false}
      />,
    );
    expect(banners()).toEqual([expect.stringMatching(/^An officer has hidden your card/)]);
    expect(screen.queryByText(/Reason given/)).not.toBeInTheDocument();
  });

  it("tells an officer previewing before launch that nobody can see cards yet", () => {
    renderWithProviders(
      <EditorBanners state={state({ is_published: true }, { enabled: false })} isOfficer />,
    );
    expect(banners()).toEqual([expect.stringMatching(/^Business cards are switched off for members/)]);
    expect(screen.getByRole("link", { name: "Admin › Cards" })).toHaveAttribute("href", "/admin/cards");
  });
});

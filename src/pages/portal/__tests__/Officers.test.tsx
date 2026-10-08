import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";

import { Officers } from "../Officers";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { ChapterOfficer } from "@/types/database";

// Who is on the board, its order and who may see it are asserted against the
// database in supabase/tests/officers.test.sql. Here the question is only
// whether a member can tell who each officer is and reach them.
const fetchChapterOfficers = vi.fn<() => Promise<ChapterOfficer[]>>();

vi.mock("@/services/officers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/officers")>()),
  fetchChapterOfficers: () => fetchChapterOfficers(),
}));

function officer(overrides: Partial<ChapterOfficer> = {}): ChapterOfficer {
  return {
    position: "President",
    first_name: "Ana",
    last_name: "Rivera",
    major: "Computer Science",
    graduation_year: 2027,
    email: "ana.rivera@wustl.edu",
    linkedin_url: "https://www.linkedin.com/in/ana-rivera",
    is_me: false,
    ...overrides,
  };
}

describe("Officers", () => {
  it("lists each officer with their position and ways to contact them", async () => {
    fetchChapterOfficers.mockResolvedValue([
      officer(),
      officer({
        position: "Treasurer",
        first_name: "Luis",
        last_name: "Mendez",
        major: null,
        graduation_year: null,
        email: "luis.mendez@wustl.edu",
        linkedin_url: null,
      }),
    ]);
    renderWithProviders(<Officers />, { route: "/portal/officers" });

    const cards = await screen.findAllByRole("listitem");
    expect(cards).toHaveLength(2);

    const president = within(cards[0]);
    expect(president.getByText("President")).toBeInTheDocument();
    expect(president.getByRole("heading", { name: "Ana Rivera" })).toBeInTheDocument();
    expect(president.getByText("Computer Science · Class of 2027")).toBeInTheDocument();
    expect(president.getByRole("link", { name: /email ana rivera, president/i })).toHaveAttribute(
      "href",
      "mailto:ana.rivera@wustl.edu",
    );
    const linkedin = president.getByRole("link", { name: /ana rivera on linkedin/i });
    expect(linkedin).toHaveAttribute("href", "https://www.linkedin.com/in/ana-rivera");
    expect(linkedin).toHaveAttribute("target", "_blank");

    // No LinkedIn on file: no LinkedIn button, rather than a dead one.
    const treasurer = within(cards[1]);
    expect(treasurer.getByRole("link", { name: /email luis mendez/i })).toBeInTheDocument();
    expect(treasurer.queryByRole("link", { name: /linkedin/i })).not.toBeInTheDocument();
  });

  it("never renders a stored LinkedIn value that is not an http(s) URL", async () => {
    fetchChapterOfficers.mockResolvedValue([
      officer({ linkedin_url: "javascript:alert(document.cookie)" }),
    ]);
    renderWithProviders(<Officers />, { route: "/portal/officers" });

    await screen.findByRole("heading", { name: "Ana Rivera" });
    expect(screen.queryByRole("link", { name: /linkedin/i })).not.toBeInTheDocument();
  });

  it("marks the member's own card when they are on the board", async () => {
    fetchChapterOfficers.mockResolvedValue([officer({ is_me: true })]);
    renderWithProviders(<Officers />, { route: "/portal/officers" });

    const heading = await screen.findByRole("heading", { name: /ana rivera/i });
    expect(within(heading).getByText("You")).toBeInTheDocument();
  });

  it("points to the chapter email when no positions are assigned yet", async () => {
    fetchChapterOfficers.mockResolvedValue([]);
    renderWithProviders(<Officers />, { route: "/portal/officers" });

    expect(await screen.findByText(/the board hasn't been listed yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "shpe@wustl.edu" })[0]).toHaveAttribute(
      "href",
      "mailto:shpe@wustl.edu",
    );
  });
});

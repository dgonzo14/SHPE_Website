import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PointsLeaderboard } from "../PointsLeaderboard";
import { renderWithProviders } from "@/test/renderWithProviders";
import type {
  LeaderboardBoard,
  LeaderboardResponse,
  LeaderboardScope,
} from "@/types/database";

// Who may see the board, the ranking and the daily rebuild are all asserted
// against the database in supabase/tests/leaderboard.test.sql. Here the
// question is only whether the member sees what the RPC said.
const fetchLeaderboard = vi.fn<(scope: LeaderboardScope) => Promise<LeaderboardResponse>>();

vi.mock("@/services/leaderboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/leaderboard")>()),
  fetchLeaderboard: (scope: LeaderboardScope) => fetchLeaderboard(scope),
}));

function board(overrides: Partial<LeaderboardBoard> = {}): LeaderboardBoard {
  return {
    enabled: true,
    scope: "term",
    refreshed_at: "2026-10-05T06:05:00.000Z",
    term_name: "Fall 2026",
    academic_year: "2026-2027",
    top_n: 25,
    ranked_member_count: 3,
    entries: [
      { rank: 1, display_name: "Luis Mendez", total_points: 40, events_attended: 4, is_me: false },
      { rank: 1, display_name: "Sofia Castro", total_points: 40, events_attended: 3, is_me: false },
      { rank: 3, display_name: "Ana Rivera", total_points: 25, events_attended: 2, is_me: true },
    ],
    me: { rank: 3, display_name: "Ana Rivera", total_points: 25, events_attended: 2, is_me: true },
    ...overrides,
  };
}

describe("PointsLeaderboard", () => {
  it("ranks members and marks the caller's own row", async () => {
    fetchLeaderboard.mockResolvedValue(board());
    renderWithProviders(<PointsLeaderboard />, { route: "/portal/leaderboard" });

    const table = await screen.findByRole("table", { name: /points leaderboard, fall 2026/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["1", "1", "3"]);
    expect(within(rows[2]).getByText("You")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("You")).not.toBeInTheDocument();

    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.getByText(/of 3 ranked members/i)).toBeInTheDocument();
    expect(fetchLeaderboard).toHaveBeenCalledWith("term");
  });

  it("says how old the numbers are, because the board is not live", async () => {
    fetchLeaderboard.mockResolvedValue(board());
    renderWithProviders(<PointsLeaderboard />, { route: "/portal/leaderboard" });

    expect(await screen.findByText(/updated once a day/i)).toHaveTextContent(
      "last on Monday, October 5 at 1:05 AM CT",
    );
  });

  it("shows a member below the cut-off their own place after the top of the board", async () => {
    fetchLeaderboard.mockResolvedValue(
      board({
        ranked_member_count: 40,
        entries: [
          { rank: 1, display_name: "Luis Mendez", total_points: 90, events_attended: 9, is_me: false },
        ],
        me: { rank: 31, display_name: "Ana Rivera", total_points: 5, events_attended: 1, is_me: true },
      }),
    );
    renderWithProviders(<PointsLeaderboard />, { route: "/portal/leaderboard" });

    const table = await screen.findByRole("table");
    const last = within(table).getAllByRole("row").at(-1)!;
    expect(within(last).getByText("31")).toBeInTheDocument();
    expect(within(last).getByText("You")).toBeInTheDocument();
  });

  it("tells a member the board is hidden, and shows no one", async () => {
    fetchLeaderboard.mockResolvedValue({ enabled: false });
    renderWithProviders(<PointsLeaderboard />, { route: "/portal/leaderboard" });

    expect(await screen.findByText(/the leaderboard is hidden right now/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see my points/i })).toHaveAttribute(
      "href",
      "/portal/points",
    );
  });

  it("warns an officer that what they are previewing is hidden from members", async () => {
    fetchLeaderboard.mockResolvedValue(board({ enabled: false }));
    renderWithProviders(<PointsLeaderboard />, {
      route: "/portal/leaderboard",
      auth: { isOfficer: true, roles: ["member", "officer"] },
    });

    expect(await screen.findByText(/hidden from members/i)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("asks for a different board when the scope changes", async () => {
    fetchLeaderboard.mockImplementation(async (scope) =>
      board({ scope, entries: [], me: null, ranked_member_count: 0 }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PointsLeaderboard />, { route: "/portal/leaderboard" });

    await screen.findByText(/nobody is on the board yet/i);
    await user.selectOptions(screen.getByLabelText(/show the board for/i), "all_time");

    expect(await screen.findByRole("heading", { name: "All time" })).toBeInTheDocument();
    expect(fetchLeaderboard).toHaveBeenLastCalledWith("all_time");
  });
});

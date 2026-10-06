import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { PortalLayout } from "../PortalLayout";
import { renderWithProviders } from "@/test/renderWithProviders";
import { queryKeys } from "@/services/queryKeys";
import type { AppConfig } from "@/types/database";

const fetchAppConfig = vi.fn<() => Promise<AppConfig>>();

vi.mock("@/services/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/content")>()),
  fetchAppConfig: () => fetchAppConfig(),
}));

// The desktop sidebar and the drawer both render NavLinks; the drawer is
// closed here, so one link per item is expected.
function leaderboardLink() {
  return screen.queryByRole("link", { name: "Leaderboard" });
}

describe("PortalLayout leaderboard link", () => {
  it("is shown to members when officers have the board switched on", async () => {
    fetchAppConfig.mockResolvedValue({ leaderboard_enabled: true });
    renderWithProviders(<PortalLayout />, { route: "/portal" });

    expect(await screen.findByRole("link", { name: "Leaderboard" })).toHaveAttribute(
      "href",
      "/portal/leaderboard",
    );
  });

  it("is removed for members while the board is hidden", async () => {
    fetchAppConfig.mockResolvedValue({ leaderboard_enabled: false });
    const { queryClient } = renderWithProviders(<PortalLayout />, { route: "/portal" });

    // The link is also absent while the config loads, so wait for the answer
    // or this would pass without testing the switch at all.
    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.appConfig)?.status).toBe("success"),
    );
    // Still there for everything else: the filter removes one item, not the menu.
    expect(screen.getByRole("link", { name: "My Points" })).toBeInTheDocument();
    expect(leaderboardLink()).not.toBeInTheDocument();
  });

  it("stays for officers, so they can preview a hidden board", async () => {
    fetchAppConfig.mockResolvedValue({ leaderboard_enabled: false });
    renderWithProviders(<PortalLayout />, {
      route: "/portal",
      auth: { isOfficer: true, roles: ["member", "officer"] },
    });

    expect(leaderboardLink()).toBeInTheDocument();
  });
});

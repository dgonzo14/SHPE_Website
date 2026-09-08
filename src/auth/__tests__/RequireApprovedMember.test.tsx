import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RequireApprovedMember } from "../RequireApprovedMember";

const useAuth = vi.hoisted(() => vi.fn());
vi.mock("../useAuth", () => ({ useAuth }));

function mockAuth(overrides: {
  membership_status?: string | null;
  profileLoading?: boolean;
  isOfficer?: boolean;
}) {
  useAuth.mockReturnValue({
    profile:
      overrides.membership_status === null
        ? null
        : { id: "m1", membership_status: overrides.membership_status ?? "active" },
    profileLoading: overrides.profileLoading ?? false,
    isOfficer: overrides.isOfficer ?? false,
  });
}

/**
 * The guard decides what renders; the database decides what is readable. These
 * only cover the first half — the RLS half is in supabase/tests/rls.test.sql,
 * where it is asserted against the `authenticated` role directly.
 *
 * The case that matters most is the deep link. A gate that only redirects
 * /portal is not a gate, because nothing stops someone typing
 * /portal/announcements.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireApprovedMember />}>
          <Route path="/portal" element={<div>Dashboard</div>} />
          <Route path="/portal/announcements" element={<div>Announcements</div>} />
        </Route>
        <Route path="/join" element={<div>Join gate</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireApprovedMember", () => {
  beforeEach(() => useAuth.mockReset());

  it("lets an active member through", () => {
    mockAuth({ membership_status: "active" });
    renderAt("/portal");
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("sends a pending member to the join gate", () => {
    mockAuth({ membership_status: "pending" });
    renderAt("/portal");
    expect(screen.getByText("Join gate")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("sends a pending member to the join gate on a deep link too", () => {
    // The whole point: guarding only the index route would leave every other
    // portal page reachable by typing its URL.
    mockAuth({ membership_status: "pending" });
    renderAt("/portal/announcements");
    expect(screen.getByText("Join gate")).toBeInTheDocument();
    expect(screen.queryByText("Announcements")).not.toBeInTheDocument();
  });

  it("waits rather than guessing while the profile is still loading", () => {
    // Guessing "not approved" here would bounce an active member to /join and
    // straight back on every sign-in, because the profile loads in a second
    // effect after the session attaches.
    mockAuth({ membership_status: null, profileLoading: true });
    renderAt("/portal");
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Join gate")).not.toBeInTheDocument();
  });

  it("lets a pending officer through so they cannot lock themselves out", () => {
    // The admin screen that sets the join code is behind these routes.
    mockAuth({ membership_status: "pending", isOfficer: true });
    renderAt("/portal");
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("does not gate statuses other than pending", () => {
    // Alumni and suspended keep the access they had; that is chapter policy,
    // not something this change decides.
    for (const status of ["alumni", "inactive", "suspended"]) {
      mockAuth({ membership_status: status });
      const { unmount } = renderAt("/portal");
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      unmount();
    }
  });
});

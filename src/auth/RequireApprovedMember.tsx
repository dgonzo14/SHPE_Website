import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "./useAuth";
import { FullPageLoader } from "@/components/shared/states";

/**
 * Stands between signing in and the portal.
 *
 * A pending account is one that has registered but has not been let in — by
 * join code or by an officer. Until then there is nothing in the portal for
 * them, so rather than showing a dashboard full of empty panels behind a
 * banner, they are sent to /join, which says what to do.
 *
 * Waiting on `profileLoading` is what stops a redirect loop and a flash: the
 * profile is loaded in a second effect after the session attaches, so for a
 * moment after sign-in there is a user and no profile. Treating that gap as
 * "not approved" would bounce an active member to /join and then straight back
 * again. It resolves in a few hundred milliseconds; a loader is honest about
 * it, a guess is not.
 *
 * Officers are exempt. An officer whose own profile is pending would otherwise
 * be locked out of the admin screen that sets the join code — the one tool
 * that fixes the problem. Their role was granted by an admin, which is a
 * stronger statement than membership_status.
 *
 * As with every guard in this directory, this decides what renders and nothing
 * more. The control is in the database: since 20260911000001 a pending account
 * reads exactly what a signed-out visitor reads, so bypassing this component
 * gets an attacker a dashboard drawn from empty responses.
 */
export function RequireApprovedMember() {
  const { profile, profileLoading, isOfficer } = useAuth();
  const location = useLocation();

  if (profileLoading && !profile) {
    return <FullPageLoader label="Checking your membership" />;
  }

  if (isOfficer) return <Outlet />;

  if (profile?.membership_status === "pending") {
    // `from` so /join can send them where they were headed once they are in,
    // rather than dropping everyone on the dashboard.
    return <Navigate to="/join" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";
import { FullPageLoader, PortalUnavailable } from "@/components/shared/states";

/**
 * Gate for anything under /portal and /admin.
 *
 * The `loading` branch is what stops the "admin page → login → admin page"
 * flicker: while the stored session is being restored we render a loader rather
 * than assuming the visitor is signed out.
 *
 * This is a routing convenience, not a security boundary. Every table and RPC
 * behind these routes enforces its own access rules in the database, so
 * bypassing this component gains an attacker nothing.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "unconfigured") return <PortalUnavailable />;
  if (status === "loading") return <FullPageLoader label="Checking your session" />;

  if (status === "signed-out") {
    // Remember where they were headed so login can return them there, not
    // dump everyone on the dashboard.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

/** Keeps a signed-in member off the auth screens. */
export function RedirectIfAuthenticated() {
  const { status } = useAuth();

  if (status === "loading") return <FullPageLoader label="Checking your session" />;
  if (status === "signed-in") return <Navigate to="/portal" replace />;

  return <Outlet />;
}

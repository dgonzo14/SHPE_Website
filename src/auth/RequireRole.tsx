import { Outlet } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "./useAuth";
import type { AppRole } from "@/types/database";
import { FullPageLoader } from "@/components/shared/states";
import { LinkButton } from "@/components/ui/button";

/**
 * A member who lands on /admin gets a plain "you don't have access" page rather
 * than a silent redirect that pretends the route does not exist — being bounced
 * to the homepage with no explanation is the more confusing failure.
 *
 * As with RequireAuth, hiding the UI is not the control. Every admin RPC calls
 * public.require_officer()/require_admin() and every admin table is behind an
 * RLS policy, so this component only decides what to render.
 */
export function RequireRole({ allow }: { allow: AppRole[] }) {
  const { roles, profileLoading, status } = useAuth();

  if (status === "loading" || (status === "signed-in" && profileLoading && roles.length === 0)) {
    return <FullPageLoader label="Checking your permissions" />;
  }

  const permitted = roles.some((role) => allow.includes(role));
  if (!permitted) return <Unauthorized />;

  return <Outlet />;
}

export function Unauthorized() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <span className="rounded-full bg-shpe-orange-soft p-3">
        <ShieldAlert className="h-7 w-7 text-shpe-orange-dark" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-bold text-shpe-navy">You don't have access to this area</h1>
      <p className="mt-2 text-gray-600">
        The admin portal is limited to SHPE officers. If you think you should have access, ask a
        chapter admin to update your role.
      </p>
      <LinkButton to="/portal" variant="secondary" className="mt-6">
        Back to My SHPE
      </LinkButton>
    </div>
  );
}

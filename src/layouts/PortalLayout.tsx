import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  Bell,
  BookOpen,
  CalendarDays,
  ExternalLink,
  History,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  QrCode,
  Settings,
  ShieldCheck,
  Trophy,
  UserRound,
  X,
} from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/shared/BrandMark";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const MEMBER_NAV: NavItem[] = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/portal/events", label: "Events", icon: CalendarDays },
  { to: "/portal/check-in", label: "Check In", icon: QrCode },
  { to: "/portal/points", label: "My Points", icon: Trophy },
  { to: "/portal/history", label: "History", icon: History },
  { to: "/portal/announcements", label: "Announcements", icon: Bell },
  { to: "/portal/resources", label: "Resources", icon: BookOpen },
  { to: "/portal/membership", label: "Membership", icon: ShieldCheck },
  { to: "/portal/profile", label: "Profile", icon: UserRound },
  { to: "/portal/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { isOfficer } = useAuth();

  return (
    <nav aria-label="Member portal" className="space-y-1">
      {MEMBER_NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium no-link-style transition-colors",
              isActive
                ? "bg-shpe-orange-dark text-white"
                : "text-shpe-navy hover:bg-shpe-navy-soft",
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span>{label}</span>
        </NavLink>
      ))}

      {/* Officers see the admin entry point. Hiding it from members is a
          convenience, not the control: /admin re-checks roles, and every admin
          RPC checks again in the database. */}
      {isOfficer && (
        <>
          <hr className="my-3 border-gray-200" />
          <NavLink
            to="/admin"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium no-link-style transition-colors",
                isActive
                  ? "bg-shpe-navy text-white"
                  : "text-shpe-navy hover:bg-shpe-navy-soft",
              )
            }
          >
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
            <span>Admin Portal</span>
          </NavLink>
        </>
      )}
    </nav>
  );
}

function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { signOut } = useAuth();
  return (
    <div className="space-y-1 border-t border-gray-200 pt-3">
      <Link
        to="/"
        onClick={onNavigate}
        className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 no-link-style hover:bg-gray-100"
      >
        <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
        <span>Back to the website</span>
      </Link>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          void signOut();
        }}
        className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden />
        <span>Sign out</span>
      </button>
    </div>
  );
}

/**
 * Sidebar on desktop, slide-over drawer on phones.
 *
 * The phone layout is the one that matters most: check-in happens standing in a
 * room, on a small screen, sometimes on a bad connection.
 */
export function PortalLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { profile } = useAuth();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const inactive =
    profile && profile.membership_status !== "active" ? profile.membership_status : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
        {/* min-w-0 lets the lockup shrink instead of shoving the menu button
            off the edge on a 320px phone. */}
        <Link to="/portal" className="flex min-w-0 items-center gap-2 no-link-style">
          <BrandMark className="h-8 max-w-[8.5rem] shrink" />
          <span className="truncate font-bold text-shpe-navy">My SHPE</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open portal menu"
          aria-expanded={drawerOpen}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between overflow-y-auto border-r border-shpe-rule bg-white p-4 lg:flex">
          <div>
            {/* Stacked, not inline: the lockup is 6.58:1, so at any legible
                height it plus a wordmark exceeds the 224px rail. */}
            <Link to="/portal" className="mb-6 flex flex-col items-start gap-2 no-link-style">
              <BrandMark className="h-7 max-w-full" />
              <span className="text-lg font-bold leading-none text-shpe-navy">My SHPE</span>
            </Link>
            <NavLinks />
          </div>
          <SidebarFooter />
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <div
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto bg-white p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Portal menu"
            >
              <div>
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-lg font-bold text-shpe-navy">My SHPE</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close portal menu"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </Button>
                </div>
                <NavLinks onNavigate={() => setDrawerOpen(false)} />
              </div>
              <SidebarFooter onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <main id="portal-content" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {inactive && (
            <Alert tone="warning" title="Your chapter membership isn't active" className="mb-6">
              Your membership is currently marked <strong>{inactive}</strong>. You can browse
              events and see your history, but check-in is limited to active members. Contact a
              SHPE officer if you think this is wrong.
            </Alert>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

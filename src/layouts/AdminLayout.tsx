import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/shared/BrandMark";

interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const ADMIN_NAV: AdminNavItem[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/events", label: "Events", icon: CalendarDays },
  { to: "/admin/attendance", label: "Attendance", icon: ClipboardCheck },
  { to: "/admin/members", label: "Members", icon: Users },
  { to: "/admin/points", label: "Points", icon: Trophy },
  { to: "/admin/announcements", label: "Announcements", icon: Bell },
  { to: "/admin/resources", label: "Resources", icon: BookOpen },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/audit-log", label: "Audit Log", icon: FileClock },
];

function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin portal" className="space-y-1">
      {ADMIN_NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium no-link-style transition-colors",
              isActive ? "bg-shpe-navy text-white" : "text-shpe-navy hover:bg-shpe-navy-soft",
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
        <Link to="/admin" className="flex min-w-0 items-center gap-2 no-link-style">
          <BrandMark className="h-8 max-w-[8.5rem] shrink" />
          <span className="truncate font-bold text-shpe-navy">SHPE Admin</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open admin menu"
          aria-expanded={drawerOpen}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-[90rem]">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between overflow-y-auto border-r border-shpe-rule bg-white p-4 lg:flex">
          <div>
            {/* The admin rail is narrower still (208px) — same stack. */}
            <Link to="/admin" className="mb-6 flex flex-col items-start gap-2 no-link-style">
              <BrandMark className="h-7 max-w-full" />
              <span className="text-lg font-bold leading-none text-shpe-navy">SHPE Admin</span>
            </Link>
            <AdminNav />
          </div>
          <div className="border-t border-gray-200 pt-3">
            <Link
              to="/portal"
              className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 no-link-style hover:bg-gray-100"
            >
              <UserRound className="h-4 w-4 shrink-0" aria-hidden />
              <span>Back to My SHPE</span>
            </Link>
          </div>
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <div
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Admin menu"
            >
              <div className="mb-6 flex items-center justify-between">
                <span className="text-lg font-bold text-shpe-navy">SHPE Admin</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close admin menu"
                >
                  <X className="h-5 w-5" aria-hidden />
                </Button>
              </div>
              <AdminNav onNavigate={() => setDrawerOpen(false)} />
              <Link
                to="/portal"
                onClick={() => setDrawerOpen(false)}
                className="mt-3 flex min-h-[44px] items-center gap-3 rounded-lg border-t border-gray-200 px-3 pt-4 text-sm text-gray-600 no-link-style"
              >
                <UserRound className="h-4 w-4 shrink-0" aria-hidden />
                <span>Back to My SHPE</span>
              </Link>
            </div>
          </div>
        )}

        <main id="admin-content" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

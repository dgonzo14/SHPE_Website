import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, LogIn, Menu, ShieldCheck, X } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { BrandMark } from "@/components/shared/BrandMark";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navLinks = [
  { path: "/", label: "Home" },
  { path: "/members", label: "Members" },
  { path: "/sponsorship", label: "Sponsorship" },
  { path: "/leadership", label: "Leadership" },
  { path: "/get-plugged-in", label: "Get Plugged In" },
];

/**
 * Public navigation, with a single entry point into the member portal.
 *
 * Signed out it reads "Member Login"; signed in it becomes a "My SHPE" menu.
 * The portal's own routes deliberately do not appear here — the public nav
 * stays about the chapter, and the portal has its own sidebar.
 */
export function Navbar() {
  const location = useLocation();
  const { status, profile, isOfficer, signOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const isActive = (path: string) => location.pathname === path;
  const signedIn = status === "signed-in";

  const handleNavClick = () => {
    setIsMenuOpen(false);
    setAccountOpen(false);
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }, 0);
  };

  // Close the account menu on outside click or Escape, the way a menu should.
  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

  const firstName = profile?.first_name?.trim();

  return (
    <nav className="sticky top-0 z-50 isolate border-b border-shpe-rule bg-white">
      <div className="mx-auto max-w-7xl px-5 py-3 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-3"
            onClick={handleNavClick}
            style={{ textDecoration: "none" }}
          >
            <BrandMark
              alt="WashU SHPE"
              className="max-w-[9rem] lg:max-w-[10.5rem] xl:max-w-[12.5rem]"
              fetchPriority="high"
            />
          </Link>

          {/* Desktop Navigation */}
          {/* lg, not md: measured at 1024px the row needs 1028px in a 961px
              container. At md the nav alone is 692px and cannot fit at all. */}
          <div className="hidden lg:flex items-center gap-2 xl:gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={handleNavClick}
                aria-current={isActive(link.path) ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[44px] items-center px-3 text-sm no-link-style transition-colors lg:px-4 lg:text-base",
                  "after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:bg-shpe-orange after:transition-opacity lg:after:inset-x-4",
                  "focus-visible:outline-[3px] focus-visible:-outline-offset-2 focus-visible:outline-shpe-navy",
                  isActive(link.path)
                    ? "font-semibold text-shpe-navy after:opacity-100"
                    : "text-shpe-navy/80 after:opacity-0 hover:text-shpe-navy hover:after:opacity-40",
                )}
              >
                {link.label}
              </Link>
            ))}

            {signedIn ? (
              <div className="relative" ref={accountRef}>
                <button
                  type="button"
                  onClick={() => setAccountOpen((open) => !open)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  className="flex min-h-[44px] items-center gap-1.5 border-2 border-shpe-navy px-4 py-2 text-sm font-semibold text-shpe-navy transition-colors hover:bg-shpe-navy hover:text-white focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
                >
                  <span>My SHPE</span>
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </button>

                {accountOpen && (
                  <div
                    role="menu"
                    aria-label="Member menu"
                    className="absolute right-0 z-50 mt-2 w-56 border border-shpe-rule-strong bg-white py-1"
                  >
                    {firstName && (
                      <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
                        Signed in as {firstName}
                      </p>
                    )}
                    {[
                      { to: "/portal", label: "Dashboard" },
                      { to: "/portal/check-in", label: "Check In" },
                      { to: "/portal/points", label: "My Points" },
                      { to: "/portal/profile", label: "My Profile" },
                    ].map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        role="menuitem"
                        onClick={handleNavClick}
                        className="block px-4 py-2.5 text-sm text-shpe-navy no-link-style hover:bg-gray-50"
                      >
                        {item.label}
                      </Link>
                    ))}
                    {isOfficer && (
                      <Link
                        to="/admin"
                        role="menuitem"
                        onClick={handleNavClick}
                        className="flex items-center gap-2 border-t border-gray-100 px-4 py-2.5 text-sm font-medium text-shpe-navy no-link-style hover:bg-gray-50"
                      >
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                        Admin Portal
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountOpen(false);
                        void signOut();
                      }}
                      className="block w-full border-t border-gray-100 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <LinkButton to="/login" onClick={handleNavClick}>
                <LogIn className="h-4 w-4" aria-hidden />
                Member Login
              </LinkButton>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen((open) => !open)}
            className="block min-h-[44px] min-w-[44px] p-2 text-shpe-navy transition-colors hover:bg-shpe-navy-soft focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy lg:hidden"
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? (
              <X className="h-6 w-6" aria-hidden />
            ) : (
              <Menu className="h-6 w-6" aria-hidden />
            )}
          </button>
        </div>

        {/* Mobile Navigation Menu */}
        {isMenuOpen && (
          <div className="mt-3 border-t border-shpe-rule pb-3 lg:hidden">
            <div className="flex flex-col gap-2 pt-4">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={handleNavClick}
                  aria-current={isActive(link.path) ? "page" : undefined}
                  className={cn(
                    "flex min-h-[48px] items-center border-l-4 px-4 text-base no-link-style transition-colors",
                    "focus-visible:outline-[3px] focus-visible:-outline-offset-2 focus-visible:outline-shpe-navy",
                    isActive(link.path)
                      ? "border-shpe-orange bg-shpe-navy-soft font-semibold text-shpe-navy"
                      : "border-transparent text-shpe-navy/80 hover:bg-shpe-navy-soft hover:text-shpe-navy",
                  )}
                >
                  {link.label}
                </Link>
              ))}

              <div className="mt-3 space-y-2 border-t border-shpe-rule pt-3">
                {signedIn ? (
                  <>
                    <LinkButton to="/portal" onClick={handleNavClick} variant="secondary" block>
                      Open My SHPE
                    </LinkButton>
                    {isOfficer && (
                      <LinkButton to="/admin" onClick={handleNavClick} variant="outline" block>
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                        Admin Portal
                      </LinkButton>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        handleNavClick();
                        void signOut();
                      }}
                      className="min-h-[44px] w-full px-4 py-3 text-base text-shpe-navy hover:bg-shpe-navy-soft focus-visible:outline-[3px] focus-visible:-outline-offset-2 focus-visible:outline-shpe-navy"
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <LinkButton to="/login" onClick={handleNavClick} block>
                    <LogIn className="h-4 w-4" aria-hidden />
                    Member Login
                  </LinkButton>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

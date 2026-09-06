import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, LogIn, Menu, ShieldCheck, X } from "lucide-react";
import shpeLogo from "/SHPE_logo.png";

import { useAuth } from "@/auth/useAuth";

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
    <nav
      className="sticky top-0 z-50 shadow-md"
      style={{ backgroundColor: "#FFFFFF", isolation: "isolate" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-3"
            onClick={handleNavClick}
            style={{ textDecoration: "none" }}
          >
            <div style={{ padding: "4px", borderRadius: "4px" }}>
              <img
                src={shpeLogo}
                alt="SHPE Logo"
                className="h-10 sm:h-12 w-auto"
                fetchPriority="high"
                decoding="async"
                width={48}
                height={48}
              />
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-2 lg:gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={handleNavClick}
                className="px-3 lg:px-4 py-2 rounded-lg transition-all hover:scale-105 text-sm lg:text-base"
                style={{
                  backgroundColor: isActive(link.path) ? "#E84E1B" : "transparent",
                  color: isActive(link.path) ? "white" : "#1B365D",
                  textDecoration: "none",
                  minHeight: "44px",
                  display: "flex",
                  alignItems: "center",
                }}
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
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg border-2 border-shpe-navy px-4 py-2 text-sm font-semibold text-shpe-navy transition-colors hover:bg-shpe-navy hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
                >
                  <span>My SHPE</span>
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </button>

                {accountOpen && (
                  <div
                    role="menu"
                    aria-label="Member menu"
                    className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
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
              <Link
                to="/login"
                onClick={handleNavClick}
                className="flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white no-link-style transition-colors hover:bg-shpe-orange-dark lg:text-base"
                style={{ backgroundColor: "#E84E1B" }}
              >
                <LogIn className="h-4 w-4" aria-hidden />
                Member Login
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen((open) => !open)}
            className="block md:hidden p-2 rounded-lg transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B365D]"
            style={{ minWidth: "44px", minHeight: "44px" }}
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Navigation Menu */}
        {isMenuOpen && (
          <div className="md:hidden mt-4 pb-4 border-t border-gray-200">
            <div className="flex flex-col gap-2 pt-4">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={handleNavClick}
                  className="px-4 py-3 rounded-lg transition-all text-base font-medium"
                  style={{
                    backgroundColor: isActive(link.path) ? "#E84E1B" : "transparent",
                    color: isActive(link.path) ? "white" : "#1B365D",
                    textDecoration: "none",
                    minHeight: "44px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {link.label}
                </Link>
              ))}

              <div className="mt-2 border-t border-gray-200 pt-3">
                {signedIn ? (
                  <>
                    <Link
                      to="/portal"
                      onClick={handleNavClick}
                      className="flex min-h-[44px] items-center justify-center rounded-lg px-4 py-3 text-base font-semibold text-white no-link-style"
                      style={{ backgroundColor: "#1B365D" }}
                    >
                      Open My SHPE
                    </Link>
                    {isOfficer && (
                      <Link
                        to="/admin"
                        onClick={handleNavClick}
                        className="mt-2 flex min-h-[44px] items-center justify-center gap-2 rounded-lg border-2 border-shpe-navy px-4 py-3 text-base font-semibold text-shpe-navy no-link-style"
                      >
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                        Admin Portal
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        handleNavClick();
                        void signOut();
                      }}
                      className="mt-2 min-h-[44px] w-full rounded-lg px-4 py-3 text-base text-gray-700 hover:bg-gray-50"
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <Link
                    to="/login"
                    onClick={handleNavClick}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 py-3 text-base font-semibold text-white no-link-style"
                    style={{ backgroundColor: "#E84E1B" }}
                  >
                    <LogIn className="h-4 w-4" aria-hidden />
                    Member Login
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

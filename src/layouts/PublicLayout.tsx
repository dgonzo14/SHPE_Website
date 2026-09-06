import { Outlet } from "react-router-dom";
import { Navbar } from "@/components/Navbar";

/**
 * The public marketing site, unchanged in structure from before the portal
 * existed: one Navbar, one <main> landmark, page content underneath.
 */
export function PublicLayout() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main id="main-content">
        <Outlet />
      </main>
    </div>
  );
}

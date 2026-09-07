import { Link, Outlet } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/shared/BrandMark";

/**
 * Sign-in, registration and password recovery. Branded as SHPE WashU rather
 * than a generic auth screen, so it never feels like leaving the site.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="px-4 py-4 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-gray-600 no-link-style hover:text-shpe-navy"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>Back to the WashU SHPE website</span>
        </Link>
      </header>

      <main id="auth-content" className="flex flex-1 items-start justify-center px-4 pb-16 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center text-center">
            <BrandMark alt="WashU SHPE" className="h-12 max-w-[15rem] sm:h-14" />
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

import { LinkButton } from "@/components/ui/button";
import { SEOHead } from "@/components/SEOHead";

/**
 * A real 404 rather than a silent redirect home.
 *
 * The old catch-all sent every unknown path to "/", which made a typo and a
 * removed page indistinguishable — and quietly swallowed broken links instead
 * of surfacing them.
 */
export function NotFound() {
  return (
    <main className="min-h-screen bg-white">
      <SEOHead
        title="Page not found - WashU SHPE"
        description="The page you're looking for doesn't exist."
      />
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-shpe-orange">404</p>
        <h1 className="mt-2 text-3xl font-bold text-shpe-navy">We couldn't find that page</h1>
        <p className="mt-3 text-gray-600">
          The link may be out of date, or the page may have moved.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <LinkButton to="/">Return home</LinkButton>
          <LinkButton to="/members" variant="outline">
            Members &amp; events
          </LinkButton>
        </div>
      </div>
    </main>
  );
}

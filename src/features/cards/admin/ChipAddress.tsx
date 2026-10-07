import { Alert } from "@/components/ui/primitives";
import { EXAMPLE_HANDLE, checkThisSiteChipOrigin } from "./chipOrigin";

/**
 * The exact address this build would write to chips, and a loud warning when
 * it's one that must never go on a chip. Shown before export rather than only
 * in the file, because by the time someone reads the CSV the chips may already
 * be written.
 */
export function ChipAddress() {
  const { example, origin, problems } = checkThisSiteChipOrigin();

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-gray-700">Chips from this site are written with</p>
        <p className="mt-1 break-all font-mono text-sm font-medium text-shpe-navy">{example}</p>
        <p className="mt-1 text-xs text-gray-500">
          with each member's handle in place of <span className="font-mono">{EXAMPLE_HANDLE}</span>
          . Origin: <span className="font-mono">{origin ?? "not set"}</span>
        </p>
      </div>

      {problems.length > 0 && (
        <Alert tone="danger" title="Don't write chips with this address">
          <ul className="list-disc space-y-1 pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="mt-2">
            A chip keeps its address until someone rewrites it by hand. Set{" "}
            <span className="font-mono">VITE_SITE_URL</span> to the chapter's production address
            (for example <span className="font-mono">https://washushpe.org</span>) in the deploy
            settings, redeploy, and export the sheet from there.
          </p>
        </Alert>
      )}
    </div>
  );
}

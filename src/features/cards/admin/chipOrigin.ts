/**
 * Is this build safe to program chips from?
 *
 * A chip keeps whatever address it was written with until someone physically
 * rewrites it, and a locked chip can't be rewritten at all. cardUrl() takes its
 * origin from VITE_SITE_URL, falling back to the address of the tab, so a
 * programming sheet exported from a laptop running `npm run dev` or from a
 * Netlify deploy preview would quietly carry that address onto every chip.
 * This names the problem before anything is written.
 */

import { cardUrl } from "@/services/cards";

export interface ChipOriginCheck {
  /** The origin chips would carry, e.g. "https://washushpe.org", or null if unparseable. */
  origin: string | null;
  /** Plain-English reasons not to write chips with it. Empty means it looks right. */
  problems: string[];
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

export function checkChipOrigin(chipUrl: string): ChipOriginCheck {
  let url: URL;
  try {
    url = new URL(chipUrl);
  } catch {
    return {
      origin: null,
      problems: [
        "The site address isn't set, so the sheet can't contain a complete web address.",
      ],
    };
  }

  const problems: string[] = [];

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    problems.push("This isn't a web address, so a phone won't open it.");
  }
  if (isLocalHost(url.hostname)) {
    problems.push(
      "It points at a development computer (localhost), so it only opens on the machine that built the site.",
    );
  }
  if (url.protocol === "http:") {
    problems.push(
      "It starts with http:, not https:. Phones warn about or block plain http addresses.",
    );
  }
  if (url.hostname.toLowerCase().endsWith(".netlify.app")) {
    problems.push(
      "It's a Netlify address, not the chapter's domain. Preview addresses change with every deploy and can disappear.",
    );
  }

  return { origin: url.origin, problems };
}

/** A placeholder handle, only for showing the shape of the address. */
export const EXAMPLE_HANDLE = "first-last";

/**
 * The check for the address this build actually writes: an example chip URL
 * from cardUrl(), the same function the programming sheet uses.
 */
export function checkThisSiteChipOrigin(): ChipOriginCheck & { example: string } {
  const example = cardUrl(EXAMPLE_HANDLE, "nfc");
  return { example, ...checkChipOrigin(example) };
}

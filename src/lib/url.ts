/**
 * Guards for URLs that came from the database rather than from this codebase.
 *
 * Input validation (see optionalUrl in lib/validation.ts) stops a bad URL being
 * stored. This is the other half: it stops one being *rendered*, which matters
 * because validation only ever applies to the next write. Rows already in the
 * table, rows written before a rule tightened, and rows written by a client
 * that skipped the form are all unaffected by a Zod schema.
 *
 * The sink here is `href`. A `javascript:` URI in an href executes on click,
 * and the portal keeps its Supabase session in localStorage, so that would be
 * session theft rather than a defacement.
 */

/** Protocols allowed to reach an href. Everything else is dropped. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Returns the URL if it is safe to put in an href, otherwise undefined.
 *
 * Undefined rather than "#" on purpose: React omits the attribute entirely, so
 * the anchor stops being a link instead of becoming one that silently does
 * nothing when clicked.
 */
export function safeExternalHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  try {
    // Parsing is what makes this reliable. Prefix tricks that defeat string
    // matching -- "JaVaScRiPt:", a leading space, an embedded newline or tab --
    // are all normalised by the URL parser before the protocol is read.
    const parsed = new URL(trimmed);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? trimmed : undefined;
  } catch {
    // Relative or unparseable. Nothing in this app renders a relative external
    // link, so treating it as unusable is correct rather than merely cautious.
    return undefined;
  }
}

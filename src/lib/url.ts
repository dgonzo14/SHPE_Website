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

export interface ResolvedLink {
  href: string;
  external: boolean;
}

/**
 * Resolves a stored link target to an href, or to null when it should not be
 * a link at all.
 *
 * Previously this was two functions — one producing the href, one deciding
 * whether to show the external-link affordance — and they could disagree. A
 * value like `//elsewhere.example/login` is not matched by /^https?:\/\//, so
 * it was labelled internal and rendered with no `target="_blank"`, yet the
 * browser reads it as protocol-relative and leaves the site. An officer (a
 * rotating student role, or a phished account) could therefore publish a
 * resource that silently replaced the portal tab with a cloned sign-in page.
 *
 * Deriving both values from one parse is the point: they can no longer
 * disagree, whatever the stored string looks like.
 */
export function resolveSiteLink(value: string | null | undefined): ResolvedLink | null {
  const raw = (value ?? "").trim();
  if (raw === "") return null;

  // Explicitly absolute and http(s): take it as written.
  if (/^https?:\/\//i.test(raw)) return { href: raw, external: true };

  /*
   * Anything else is meant to be a file this site serves. Strip every leading
   * slash AND backslash before resolving: "//host" is protocol-relative, and
   * browsers normalise "/\host" and "\\host" the same way, so removing only a
   * single forward slash still leaves the site.
   *
   * Resolving against BASE_URL rather than the bare origin matters on a
   * sub-path deployment: "/handbook.pdf" has to become /SHPE_Website/handbook.pdf,
   * not /handbook.pdf.
   */
  try {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    const parsed = new URL(raw.replace(/^[/\\]+/, ""), base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return { href: parsed.href, external: parsed.origin !== window.location.origin };
  } catch {
    return null;
  }
}

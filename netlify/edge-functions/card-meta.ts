import type { Config, Context } from "https://edge.netlify.com";

/*
 * The app's own rules, imported so the handle shape, the media path, when a
 * photo may be shown and which fonts a card loads can't drift from what the
 * page uses. Netlify bundles this file with Deno, which needs the ".ts"
 * extensions and doesn't know the app's "@/" alias, so everything reachable
 * from here must use plain relative paths and import no packages. model.ts,
 * photoVisibility.ts and fontLinks.ts keep to that, and
 * src/features/cards/public/__tests__/cardMetaEdge.test.ts walks these imports
 * so CI fails if that ever stops being true, instead of the deploy.
 */
import {
  CARD_MEDIA_BUCKET,
  CARD_MEDIA_PATH_PATTERN,
  HANDLE_PATTERN,
  type CardFontId,
} from "../../src/features/cards/model.ts";
import { visiblePhotoPath } from "../../src/features/cards/photoVisibility.ts";
import { googleFontHref, storedThemeFonts } from "../../src/features/cards/fontLinks.ts";

/**
 * Link previews for business cards.
 *
 * The card page is the SPA's index.html, the same for every card, and the name
 * and photo only appear once JavaScript has fetched the card. Link-preview bots
 * (iMessage, Slack, LinkedIn, WhatsApp, Discord) don't run JavaScript, so
 * without this a shared card previews as the generic chapter homepage. This
 * edge function looks the card up while the page is being fetched and writes
 * that card's title, description, photo and robots rule into <head>.
 *
 * Having the card in hand, it also adds the stylesheets for the card's two
 * fonts, so they download alongside the app instead of after it has run: the
 * name appears in its own face rather than a fallback that then reflows.
 *
 * It is an enhancement, never a dependency, so it FAILS OPEN: a missing
 * environment variable, a slow or paused Supabase, an unexpected answer or any
 * error at all serves the untouched page, and the SPA renders the card (or its
 * own error state) exactly as it would without this file. `onError: "bypass"`
 * below covers anything that escapes the code's own checks.
 *
 * What it injects is only <title>, <meta>, <link rel="canonical"> and font
 * stylesheets. Never a <script>: the CSP has no 'unsafe-inline', and nothing
 * here needs one. Every value is HTML-escaped, the only image URL it will build
 * is this project's own card-media bucket from a path that matches the storage
 * pattern, and the only stylesheet URLs are Google Fonts ones built from the
 * fixed catalog in fontLinks.ts (already allowed by the CSP), so a card can't
 * point the page at an arbitrary host. A photo the card's design hides is left
 * out of the preview too.
 *
 * It decides nothing about who may see a card. get_public_card() is the same
 * anon RPC the page itself calls; this just asks it earlier. Views are not
 * counted here (the page counts them), so bots don't inflate insights.
 *
 * Cost: one extra RPC per card page load, in parallel with fetching the page.
 * Edge function invocations are metered by the Netlify plan; at chapter scale
 * the count is tiny, but it is the one metered piece of the card design.
 */

/**
 * Someone is standing in front of the member waiting for the page, so the
 * lookup gets a hard budget. Past it, the plain page is served and the SPA
 * fetches the card itself.
 */
const LOOKUP_TIMEOUT_MS = 1500;

/** index.html is about 2 KB. Anything far bigger isn't the page we expect. */
const MAX_HTML_BYTES = 512 * 1024;

const SITE_NAME = "WashU SHPE";

/** Exactly /card/<one segment>, with an optional trailing slash. */
const CARD_PATH = /^\/card\/([^/]+)\/?$/;

/** Printable ASCII. See matchCardRequest for why it matters. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

interface Env {
  supabaseUrl: string;
  anonKey: string;
  /** The production origin (VITE_SITE_URL), or null to use the request's. */
  siteUrl: string | null;
}

/** The few PublicCardData fields a preview needs. */
interface CardMeta {
  handle: string;
  displayName: string;
  headline: string | null;
  organization: string | null;
  position: string | null;
  /** Only when the card shows its photo; null when the design hides it. */
  avatarPath: string | null;
  allowIndexing: boolean;
  /** The fonts the card's theme draws with, from the catalog only. */
  fonts: CardFontId[];
}

type Lookup =
  | { status: "ok"; card: CardMeta }
  | { status: "redirect"; handle: string }
  | { status: "not_found" };

interface CardRequest {
  url: URL;
  /** The decoded path segment, as the page would send it to get_public_card. */
  segment: string;
  /** Trimmed and lowercased, the way the database normalises it. */
  handle: string;
}

/* ── Request matching ────────────────────────────────────────────────────── */

// Link-preview bots often send "Accept: */*" or no Accept header at all, so
// those count as wanting HTML. The response's own content type is checked
// again before anything is rewritten.
function acceptsHtml(accept: string | null): boolean {
  if (!accept) return true;
  const value = accept.toLowerCase();
  return (
    value.includes("text/html") || value.includes("application/xhtml+xml") || value.includes("*/*")
  );
}

function matchCardRequest(request: Request): CardRequest | null {
  if (request.method !== "GET" || !acceptsHtml(request.headers.get("accept"))) return null;
  try {
    const url = new URL(request.url);
    const match = CARD_PATH.exec(url.pathname);
    if (!match) return null;
    const segment = decodeURIComponent(match[1]);
    return { url, segment, handle: segment.trim().toLowerCase() };
  } catch {
    // A malformed percent-escape. Let the page deal with it.
    return null;
  }
}

/**
 * True when the handle can't exist, so the database would answer not_found
 * anyway and asking it is a wasted round trip (bots probe /card/wp-login.php
 * and friends). Only decided for printable ASCII, where trimming and
 * lowercasing here agree with Postgres's btrim() and lower(); anything else
 * goes to the database, which has the final word.
 */
function isImpossibleHandle(request: CardRequest): boolean {
  return PRINTABLE_ASCII.test(request.segment) && !HANDLE_PATTERN.test(request.handle);
}

/* ── Environment ─────────────────────────────────────────────────────────── */

/**
 * Edge functions only see variables set in the Netlify UI with the Functions
 * scope; values in netlify.toml are invisible here. The unprefixed names are
 * the same fallback the keep-alive function accepts.
 */
function envValue(...names: string[]): string {
  for (const name of names) {
    try {
      const value = Netlify.env.get(name)?.trim();
      if (value) return value;
    } catch {
      // Not running on Netlify. Treated as unset.
    }
  }
  return "";
}

/**
 * An https URL without its query, hash or trailing slash. Plain http is
 * accepted only for localhost, for `netlify dev` against a local Supabase.
 */
function baseUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function readEnv(): Env | null {
  const supabaseUrl = baseUrl(envValue("VITE_SUPABASE_URL", "SUPABASE_URL"));
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return null;
  return { supabaseUrl, anonKey, siteUrl: baseUrl(envValue("VITE_SITE_URL")) };
}

/* ── The lookup ──────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Accepts only the shapes get_public_card() is documented to return. Anything
 * else is treated as "don't know" (null), which serves the untouched page.
 */
function parseLookup(data: unknown): Lookup | null {
  if (!isRecord(data)) return null;
  if (data.status === "not_found") return { status: "not_found" };
  if (data.status === "redirect") {
    return typeof data.handle === "string" && HANDLE_PATTERN.test(data.handle)
      ? { status: "redirect", handle: data.handle }
      : null;
  }
  if (data.status !== "ok" || !isRecord(data.card)) return null;
  const card = data.card;
  if (typeof card.handle !== "string" || !HANDLE_PATTERN.test(card.handle)) return null;
  if (typeof card.display_name !== "string") return null;
  const shpe = isRecord(card.shpe) ? card.shpe : {};
  return {
    status: "ok",
    card: {
      handle: card.handle,
      displayName: card.display_name,
      headline: optionalString(card.headline),
      organization: optionalString(card.organization),
      position: optionalString(shpe.position),
      // get_public_card returns the photo even when the design hides it (the
      // "No photo" shape, or the Minimal layout Paper uses), because switching
      // back brings it back. A hidden face must not appear in every chat the
      // link is pasted into, so the theme decides here.
      avatarPath: visiblePhotoPath(card),
      allowIndexing: card.allow_indexing === true,
      fonts: storedThemeFonts(card.theme),
    },
  };
}

/** Never throws and never takes longer than LOOKUP_TIMEOUT_MS. null = unknown. */
async function lookupCard(env: Env, handle: string): Promise<Lookup | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/get_public_card`, {
      method: "POST",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ p_handle: handle }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Includes the function not existing yet because the migration hasn't
      // been pushed. Unknown, so the page is served as it is.
      await response.body?.cancel();
      return null;
    }
    return parseLookup(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Rewriting <head> ────────────────────────────────────────────────────── */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * One line of plain text: whitespace collapsed, control characters dropped,
 * cut to `max` characters (not UTF-16 units, so an emoji is never split).
 */
function plainText(value: string | null, max: number): string {
  if (!value) return "";
  const chars = Array.from(value.replace(/\s+/g, " ").trim()).filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x20 && !(code >= 0x7f && code <= 0x9f);
  });
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

function metaTag(attribute: "name" | "property", key: string, content: string): string {
  return `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`;
}

/** Same rule as cardMediaUrl() in services/cards.ts: a valid path, or nothing. */
function cardMediaUrl(env: Env, path: string | null): string | null {
  if (!path || !CARD_MEDIA_PATH_PATTERN.test(path)) return null;
  return `${env.supabaseUrl}/storage/v1/object/public/${CARD_MEDIA_BUCKET}/${path}`;
}

/** Same address cardUrl() builds in the app, without ?src= (it's canonical). */
function canonicalCardUrl(env: Env, request: CardRequest, handle: string): string {
  return `${env.siteUrl ?? request.url.origin}/card/${encodeURIComponent(handle)}`;
}

const NOINDEX = "noindex, nofollow";

function cardHeadTags(card: CardMeta, env: Env, request: CardRequest): string[] {
  const name = plainText(card.displayName, 80) || `${SITE_NAME} member`;
  const position = plainText(card.position, 60);
  const description =
    plainText(
      [card.headline, position ? `${position}, ${SITE_NAME}` : null, card.organization]
        .filter(Boolean)
        .join(" · "),
      200,
    ) || `Digital business card · ${SITE_NAME}`;
  const url = canonicalCardUrl(env, request, card.handle);
  const image = cardMediaUrl(env, card.avatarPath);

  const tags = [
    `<title>${escapeHtml(`${name} | ${SITE_NAME}`)}</title>`,
    metaTag("name", "description", description),
    metaTag("property", "og:site_name", SITE_NAME),
    metaTag("property", "og:type", "profile"),
    metaTag("property", "og:title", name),
    metaTag("property", "og:description", description),
    metaTag("property", "og:url", url),
  ];
  if (image) {
    tags.push(metaTag("property", "og:image", image));
    tags.push(metaTag("property", "og:image:alt", `Photo of ${name}`));
  }
  // "summary" (small square image) suits a square profile photo.
  tags.push(metaTag("name", "twitter:card", "summary"));
  if (card.allowIndexing) {
    // Folds ?src=nfc, ?src=qr and old handles into one search result.
    tags.push(`<link rel="canonical" href="${escapeHtml(url)}" />`);
  } else {
    // Search engines are opt-in per card: a student's phone number turning up
    // in Google is a bad default.
    tags.push(metaTag("name", "robots", NOINDEX));
  }
  // The card's fonts, tagged the way the app's ensureCardFont() tags its own,
  // so the app finds them already there and doesn't add a second copy.
  for (const id of card.fonts) {
    const href = googleFontHref(id);
    if (href) tags.push(`<link rel="stylesheet" href="${escapeHtml(href)}" data-card-font="${escapeHtml(id)}" />`);
  }
  return tags;
}

/*
 * Tags this function owns. Any copy already in <head> is removed first, so the
 * page never carries two titles or two robots rules. The patterns only need to
 * handle our own index.html, whose attribute values contain no ">".
 */
const CARD_OWNED_TAGS = [
  /<title\b[^>]*>[\s\S]*?<\/title\s*>\s*/gi,
  /<meta\b[^>]*\b(?:name|property)\s*=\s*(["']?)(?:description|robots|og:[\w:.-]*|twitter:[\w:.-]*)\1(?=[\s/>])[^>]*>\s*/gi,
  /<link\b[^>]*\brel\s*=\s*(["']?)canonical\1(?=[\s/>])[^>]*>\s*/gi,
];
const ROBOTS_TAG = /<meta\b[^>]*\bname\s*=\s*(["']?)robots\1(?=[\s/>])[^>]*>\s*/gi;

/**
 * Removes `remove` from <head>, then appends `tags` just before </head>.
 * null when there is no </head> to anchor on.
 *
 * Built by slicing, not String.replace with a replacement string: a member
 * named "$&" would otherwise have their name expanded into markup.
 */
function rewriteHead(html: string, remove: RegExp[], tags: string[]): string | null {
  const end = html.search(/<\/head\s*>/i);
  if (end === -1) return null;
  let head = html.slice(0, end);
  for (const pattern of remove) head = head.replace(pattern, "");
  return `${head.trimEnd()}\n    ${tags.join("\n    ")}\n  ${html.slice(end)}`;
}

/** Only a plain, complete, reasonably sized HTML page is rewritten. */
function isRewritableHtml(response: Response): boolean {
  if (response.status !== 200 || !response.body) return false;
  if (!/^\s*text\/html\b/i.test(response.headers.get("content-type") ?? "")) return false;
  // A compressed body would need decoding first; not worth the risk.
  const encoding = (response.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (encoding !== "identity") return false;
  const length = Number(response.headers.get("content-length") ?? "0");
  return !(length > MAX_HTML_BYTES);
}

function rewrittenResponse(
  body: string,
  from: Response,
  status: number,
  noindex: boolean,
): Response {
  const headers = new Headers(from.headers);
  // The body changed length; let the platform recompute it.
  headers.delete("content-length");
  // These describe index.html, not this card. Left in place, a browser could
  // revalidate the card page against index.html and keep yesterday's name.
  headers.delete("etag");
  headers.delete("last-modified");
  if (noindex) headers.set("x-robots-tag", NOINDEX);
  return new Response(body, { status, headers });
}

/* ── Handler ─────────────────────────────────────────────────────────────── */

export default async (request: Request, context: Context): Promise<Response> => {
  const target = matchCardRequest(request);
  if (!target) return context.next();

  const env = readEnv();
  if (!env) return context.next();

  // Fetch the page and the card at the same time, so a person tapping a card
  // waits for one round trip rather than two. lookupCard never rejects; if
  // context.next() does, onError: "bypass" serves the page without us.
  const [lookup, response] = await Promise.all([
    isImpossibleHandle(target)
      ? Promise.resolve<Lookup>({ status: "not_found" })
      : lookupCard(env, target.segment),
    context.next(),
  ]);

  if (!lookup) return response;

  if (lookup.status === "redirect") {
    if (lookup.handle === target.handle) return response;
    void response.body?.cancel().catch(() => undefined);
    // Same origin as the request, so a deploy preview stays on itself, and the
    // query string survives so ?src=nfc still counts as a tap.
    const location = new URL(`/card/${lookup.handle}`, target.url.origin);
    location.search = target.url.search;
    return new Response(null, {
      status: 301,
      headers: {
        location: location.href,
        // Browsers otherwise cache a 301 indefinitely. A handle an officer
        // resets is freed and can later belong to someone else, so the hop
        // is re-asked each time rather than remembered.
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  }

  if (!isRewritableHtml(response)) return response;

  // If reading the body fails, the throw reaches onError: "bypass".
  const html = await response.text();
  try {
    if (lookup.status === "ok") {
      const { card } = lookup;
      const rewritten = rewriteHead(html, CARD_OWNED_TAGS, cardHeadTags(card, env, target));
      return rewrittenResponse(rewritten ?? html, response, response.status, !card.allowIndexing);
    }
    // not_found: unpublished, hidden, switched off and nonexistent all look the
    // same. The body is the SPA as usual, which renders its own not-found
    // page; the 404 and noindex are for crawlers.
    const rewritten = rewriteHead(html, [ROBOTS_TAG], [metaTag("name", "robots", NOINDEX)]);
    return rewrittenResponse(rewritten ?? html, response, 404, true);
  } catch {
    return new Response(html, response);
  }
};

export const config: Config = {
  path: "/card/*",
  method: "GET",
  // Belt and braces for failing open: an uncaught error skips this function
  // and serves the page, instead of Netlify's error page.
  onError: "bypass",
};

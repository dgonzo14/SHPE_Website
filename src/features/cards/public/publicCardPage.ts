import type { PublicCardData } from "@/types/database";
import { isHandleShapeValid } from "../model";
import type { ResolvedTheme } from "../themes";

/**
 * The rules behind /card/:handle that don't need React: how hard to retry,
 * how to read a response, what to put in <head>, and counting a view once per
 * card per 30 minutes in a browser. Kept apart from the page so each can be
 * tested on its own.
 *
 * Nothing here may import zod, react-hook-form, @/lib/validation or editor
 * code: this is the page an NFC tap opens, and someone is standing in front of
 * the member waiting for it.
 */

export const SITE_NAME = "WashU SHPE";

/* ── Retrying ────────────────────────────────────────────────────────────── */

/** Attempts after the first. With the delays below, about 15 s in all. */
export const PUBLIC_CARD_MAX_RETRIES = 4;

/** The longest single wait between attempts. */
const MAX_RETRY_DELAY_MS = 8000;

/*
 * SQLSTATE classes that fail the same way every time: feature not supported,
 * bad data, constraint violations, bad authorization, access rule violations
 * (42501, a missing function) and raised exceptions. Retrying those only
 * delays the message. Connection trouble (08), resource limits (53), timeouts
 * and restarts (57), serialization failures (40) and internal errors (XX) can
 * clear up on their own.
 */
const PERMANENT_SQLSTATE_CLASSES = ["0A", "22", "23", "28", "42", "P0"];

/**
 * Whether a failed card fetch is worth trying again.
 *
 * A free Supabase project that has gone quiet can take a while to answer its
 * first request, and a phone at a career fair drops packets, so anything that
 * looks like the network or the server having a bad moment is retried: no
 * code at all (fetch failed, or a gateway answered with HTML), a 5xx, a
 * timeout, and PostgREST's own "couldn't reach the database" codes
 * PGRST000-PGRST003. Answers that will be the same next time are not: a
 * build without Supabase settings, a 4xx, any other PostgREST code, and the
 * permanent SQLSTATE classes above.
 *
 * A clean not_found is a successful response, not an error, so it never
 * reaches this function and is never retried.
 */
export function isTransientCardError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code.trim().toUpperCase() : "";
  const status = typeof e.status === "number" ? e.status : null;
  const message = typeof e.message === "string" ? e.message : "";

  if (/not configured for this deployment/i.test(message)) return false;
  if (status !== null && status >= 400 && status < 500) return status === 408 || status === 429;
  if (code.startsWith("PGRST")) return /^PGRST00[0-3]$/.test(code);
  if (/^[0-9A-Z]{5}$/.test(code)) {
    return !PERMANENT_SQLSTATE_CLASSES.some((prefix) => code.startsWith(prefix));
  }
  return true;
}

/** React Query's `retry`. `failureCount` is 0 when the first attempt has just failed. */
export function shouldRetryPublicCard(failureCount: number, error: unknown): boolean {
  return failureCount < PUBLIC_CARD_MAX_RETRIES && isTransientCardError(error);
}

/**
 * React Query's `retryDelay`: about 1 s, 2 s, 4 s, then 8 s. The ±25% jitter
 * keeps a room full of phones that all failed at once from all retrying at
 * once.
 */
export function publicCardRetryDelay(failureCount: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** Math.max(0, failureCount), MAX_RETRY_DELAY_MS);
  return Math.round(base * (0.75 + random() * 0.5));
}

/* ── Reading the response ────────────────────────────────────────────────── */

export type PublicCardOutcome =
  | { kind: "ok"; card: PublicCardData }
  | { kind: "redirect"; handle: string }
  | { kind: "not_found" }
  /** Something that isn't any of the three answers get_public_card() gives. */
  | { kind: "invalid" };

/**
 * get_public_card()'s answer, checked rather than trusted. A redirect must
 * point at a well-formed handle other than the one asked for (anything else
 * would loop or navigate somewhere odd, so it reads as not found), and an
 * "ok" must carry a card.
 */
export function classifyPublicCardResponse(data: unknown, requested: string): PublicCardOutcome {
  if (!data || typeof data !== "object") return { kind: "invalid" };
  const response = data as { status?: unknown; handle?: unknown; card?: unknown };

  switch (response.status) {
    case "not_found":
      return { kind: "not_found" };
    case "redirect": {
      const handle = typeof response.handle === "string" ? response.handle : "";
      return isHandleShapeValid(handle) && handle !== requested
        ? { kind: "redirect", handle }
        : { kind: "not_found" };
    }
    case "ok": {
      const card = response.card as PublicCardData | null | undefined;
      return card && typeof card === "object" && typeof card.handle === "string"
        ? { kind: "ok", card }
        : { kind: "invalid" };
    }
    default:
      return { kind: "invalid" };
  }
}

/* ── The address bar ─────────────────────────────────────────────────────── */

/**
 * The query string without `src`, everything else untouched. Chips carry
 * ?src=nfc and printed QR codes ?src=qr; once the visit has been counted the
 * tag comes off, so an address copied out of the browser and pasted to a
 * friend counts as a shared link rather than another tap.
 */
export function searchWithoutSource(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has("src")) return search;
  params.delete("src");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/* ── <head> ──────────────────────────────────────────────────────────────── */

/**
 * Collapses whitespace, drops control characters and cuts to `max`
 * characters with an ellipsis. Same rule as plainText() in
 * netlify/edge-functions/card-meta.ts, which writes these tags for link
 * previews before any JavaScript runs; the page writes the same values so the
 * two never disagree.
 */
export function plainText(value: string | null | undefined, max: number): string {
  if (!value) return "";
  const chars = Array.from(value.replace(/\s+/g, " ").trim()).filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x20 && !(code >= 0x7f && code <= 0x9f);
  });
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * "Diego Gonzalez | WashU SHPE". Portal titles never carry a member's name
 * (see usePageMeta), but a published card is the member choosing to put
 * their name on a public page, and the tab, the bookmark and the share sheet
 * should all say whose card it is.
 */
export function cardPageTitle(displayName: string | null | undefined): string {
  const name = plainText(displayName, 80) || `${SITE_NAME} member`;
  return `${name} | ${SITE_NAME}`;
}

/** "SWE Intern @ Boeing · President, WashU SHPE · Washington University in St. Louis". */
export function cardMetaDescription(card: PublicCardData): string {
  const position = plainText(card.shpe?.position ?? null, 60);
  return (
    plainText(
      [card.headline, position ? `${position}, ${SITE_NAME}` : null, card.organization]
        .filter(Boolean)
        .join(" · "),
      200,
    ) || `Digital business card · ${SITE_NAME}`
  );
}

/**
 * The flat colour behind the card: the same backgroundColor themeCssVars()
 * gives the card's own root. The page puts it on <html> and <body> (so
 * pulling past the end on a phone shows the card's colour, not white) and in
 * theme-color (so Android's toolbar matches).
 */
export function cardPageColor(theme: ResolvedTheme, hasBackgroundImage: boolean): string {
  const { type, from } = theme.background;
  if (type === "gradient" || (type === "image" && !hasBackgroundImage)) return from;
  return theme.colors.background;
}

/* ── Counting a view ─────────────────────────────────────────────────────── */

const VIEW_KEY_PREFIX = "washu-shpe-card-viewed:";

/**
 * How long one visitor's view of a card lasts: long enough to cover a page
 * that was slow to load and got tapped again, or a chip tap followed by a scan
 * of the printed QR, short enough that coming back later in the day counts.
 */
export const VIEW_TTL_MS = 30 * 60_000;

/** Used only where localStorage throws (storage disabled, some private modes). */
const viewedThisPage = new Map<string, number>();

function isFreshView(last: number, now: number): boolean {
  // A time in the future means the clock moved; count the view rather than
  // stay silent until the clock catches up.
  return last > 0 && now >= last && now - last < VIEW_TTL_MS;
}

/**
 * True the first time it's asked about a card in this browser, then false for
 * VIEW_TTL_MS: once per card per 30 minutes in a browser. Reloading, tapping
 * the same chip twice or scanning the QR right after a tap counts one view,
 * which is the most the client can promise (record_card_event is anonymous by
 * design).
 *
 * localStorage rather than sessionStorage, because sessionStorage belongs to
 * one tab: an NFC tap or a camera scan opens the page in a new tab, and once
 * ?src= has come off the address the first tab is at a different URL, so a
 * second tap would always look like a new visitor. Entries older than the
 * window are cleared on each call, so the browser doesn't keep a long list of
 * cards someone looked at. Where storage is unavailable it falls back to the
 * same window within this page load.
 */
export function claimCardView(handle: string, now: number = Date.now()): boolean {
  const key = `${VIEW_KEY_PREFIX}${handle}`;
  try {
    const storage = window.localStorage;
    forgetOldViews(storage, now);
    if (isFreshView(Number(storage.getItem(key)), now)) return false;
    storage.setItem(key, String(now));
    return true;
  } catch {
    if (isFreshView(viewedThisPage.get(key) ?? 0, now)) return false;
    viewedThisPage.set(key, now);
    return true;
  }
}

/** Removes view markers whose window has passed, or that can't be read. */
function forgetOldViews(storage: Storage, now: number): void {
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(VIEW_KEY_PREFIX) && !isFreshView(Number(storage.getItem(key)), now)) {
      stale.push(key);
    }
  }
  for (const key of stale) storage.removeItem(key);
}

/* ── Add to Contacts ─────────────────────────────────────────────────────── */

/** The vCard builder, which loads only when someone is about to need it. */
export function loadVCardModule() {
  return import("@/features/cards/vcard");
}

/**
 * Fetches the vCard module once the page has settled, so "Add to Contacts"
 * doesn't wait on a round trip for code. Deferred until the browser is idle
 * (or a couple of seconds have passed) so it never competes with the card's
 * own photo. Returns a cancel function for the effect cleanup.
 */
export function prefetchVCardWhenIdle(delayMs = 2000): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) loadVCardModule().catch(() => {});
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: delayMs * 2 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(id);
    };
  }
  const timer = window.setTimeout(run, delayMs);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}

/**
 * Sharing a card: the phone's own share sheet where there is one, otherwise a
 * copied link.
 *
 * The share sheet is the better experience on a phone (AirDrop, Messages,
 * LinkedIn DMs), but desktop browsers often lack it and some refuse it outside
 * a direct tap, so every path ends somewhere useful.
 */

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
}

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * The legacy copy path, for browsers without the async clipboard API or
 * outside a secure context (a LAN preview over http, older iOS webviews).
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Off-screen rather than display:none, which can't be selected. The font
  // size stops iOS zooming the page in when the field takes focus.
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  textarea.style.fontSize = "16px";
  const previous = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previous?.focus?.();
  }
}

/** Copies text to the clipboard. True when it got there. */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission refused or no user gesture; the legacy path may still work.
    }
  }
  return legacyCopy(text);
}

/**
 * Opens the share sheet, or copies the link when there isn't one or it fails.
 * Dismissing the sheet is "cancelled", not a failure: the member changed their
 * mind, and copying the link behind their back would be a surprise.
 */
export async function shareCard(opts: {
  url: string;
  title: string;
  text?: string;
}): Promise<ShareResult> {
  if (canNativeShare()) {
    const data: ShareData = { url: opts.url, title: opts.title };
    if (opts.text) data.text = opts.text;
    const shareable = typeof navigator.canShare !== "function" || navigator.canShare(data);
    if (shareable) {
      try {
        await navigator.share(data);
        return "shared";
      } catch (error) {
        if (errorName(error) === "AbortError") return "cancelled";
        // NotAllowedError (no user gesture), DataError and friends: copy instead.
      }
    }
  }
  return (await copyText(opts.url)) ? "copied" : "failed";
}

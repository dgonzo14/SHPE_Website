import { useEffect } from "react";

export const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes to your card. Leave this page and lose them?";

/**
 * Warns before unsaved card edits are thrown away.
 *
 * The app uses BrowserRouter, not a data router, so React Router's useBlocker
 * isn't available. Two listeners cover the common exits instead:
 *
 *   beforeunload   closing the tab, reloading, or typing another address. The
 *                  browser shows its own wording; ours can't replace it.
 *   click capture  following an in-app link (the portal menu, the logo). It
 *                  runs before React Router's handler, and cancelling the
 *                  event there stops <Link> navigating at all.
 *
 * The browser's Back button can't be intercepted this way, which is why the
 * editor also says plainly, beside Save, when there are unsaved changes.
 *
 * Links inside the card preview are skipped: they never navigate anyway.
 */
export function useUnsavedChangesGuard(when: boolean, message = UNSAVED_CHANGES_MESSAGE) {
  useEffect(() => {
    if (!when) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older Chrome and Safari only prompt when returnValue is set.
      event.returnValue = "";
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.closest("[data-card-root]")) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // Other sites unload the page, which beforeunload already covers.
      if (url.origin !== window.location.origin) return;
      // Same page (a #fragment link): nothing is lost.
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [when, message]);
}

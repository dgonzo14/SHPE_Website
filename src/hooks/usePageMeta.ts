import { useEffect } from "react";

/**
 * Sets the document title and, for authenticated surfaces, a
 * `robots: noindex, nofollow` meta tag.
 *
 * Titles here are always generic ("Points | My SHPE"), never personalised —
 * a title leaks into browser history, screen shares and tab previews, so it is
 * not a place for a member's name or standing.
 */
export function usePageMeta({
  title,
  noindex = false,
}: {
  title: string;
  noindex?: boolean;
}) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;

    let meta: HTMLMetaElement | null = null;
    if (noindex) {
      meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "robots");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", "noindex, nofollow");
    }

    return () => {
      document.title = previous;
      // Leaving noindex behind would silently de-index the public pages the
      // member navigates to next.
      if (noindex) {
        document.querySelector('meta[name="robots"]')?.remove();
      }
    };
  }, [title, noindex]);
}

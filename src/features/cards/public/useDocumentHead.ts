import { useEffect } from "react";

/*
 * Small hooks for the bits of the document a card page changes and must give
 * back. The card page is a full-screen island inside the SPA: when a visitor
 * leaves it for the chapter site, the home page must not inherit the card's
 * description, canonical address or background colour. Each hook restores
 * exactly what was there before, including "nothing".
 */

/**
 * Sets `<meta name={name} content={content}>` while mounted. null leaves the
 * tag alone. A tag the hook had to create is removed again; an existing one
 * (index.html's description, or one the card-meta edge function wrote) gets
 * its old content back.
 */
export function useMetaTag(name: string, content: string | null): void {
  useEffect(() => {
    if (content === null) return;
    let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    const created = meta === null;
    const previous = meta?.getAttribute("content") ?? null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", name);
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", content);
    const tag = meta;
    return () => {
      if (created) tag.remove();
      else if (previous === null) tag.removeAttribute("content");
      else tag.setAttribute("content", previous);
    };
  }, [name, content]);
}

/**
 * Sets `<link rel="canonical">` while mounted; null leaves it alone. Matters
 * because SEOHead on the public pages writes a canonical for the page it's on
 * and never removes it, so a card reached by in-app navigation could
 * otherwise tell search engines that it is the home page.
 */
export function useCanonicalLink(href: string | null): void {
  useEffect(() => {
    if (href === null) return;
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const created = link === null;
    const previous = link?.getAttribute("href") ?? null;
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);
    const tag = link;
    return () => {
      if (created) tag.remove();
      else if (previous === null) tag.removeAttribute("href");
      else tag.setAttribute("href", previous);
    };
  }, [href]);
}

/**
 * Paints <html> and <body> while mounted. The card draws its own background,
 * but on a phone pulling past the top or bottom of the page shows the
 * document behind it, which is white everywhere else on the site; a white
 * flash under a navy card is exactly the kind of jolt this page shouldn't
 * have. Inline styles, put back exactly as they were on the way out.
 */
export function usePageBackground(color: string | null): void {
  useEffect(() => {
    if (!color) return;
    const html = document.documentElement;
    const body = document.body;
    const previous = [html.style.backgroundColor, body.style.backgroundColor] as const;
    html.style.backgroundColor = color;
    body.style.backgroundColor = color;
    return () => {
      html.style.backgroundColor = previous[0];
      body.style.backgroundColor = previous[1];
    };
  }, [color]);
}

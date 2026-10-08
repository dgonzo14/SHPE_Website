import type { MouseEvent, ReactNode } from "react";

import type { PublicCardLink } from "@/types/database";
import { isExternalHref, linkHref } from "../linkKinds";
import type { CardMode, LinkClickHandler } from "./types";

/**
 * The one place a card link becomes an anchor.
 *
 * The href always goes through linkHref(), so only https:, a plain mailto:
 * or a digits-only tel: can come out, whatever the stored value says.
 *
 * Public: web links open in a new tab with rel="noopener noreferrer" (the
 * visitor keeps the card, and the destination gets no handle on this window
 * or a Referer naming whose card it was); email and phone open the mail or
 * phone app in place. `onLinkClick` fires for every link, including a
 * middle-click that opens it in a background tab.
 *
 * Preview: the same anchor, real href and all, so hovering shows where it
 * goes, but the click is cancelled. The editor holds unsaved work, and a
 * stray tap in the preview must not take it anywhere. `onLinkClick` still
 * fires so the editor can say what would have happened.
 */
export function CardLink({
  link,
  mode,
  onLinkClick,
  className,
  title,
  children,
}: {
  link: PublicCardLink;
  mode: CardMode;
  onLinkClick?: LinkClickHandler;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const href = linkHref(link.kind, link.value);
  const preview = mode === "preview";

  if (!href) {
    // Only reachable in the preview (BusinessCard drops unusable links from a
    // public card): show the member the row so they can see it needs fixing.
    if (!preview) return null;
    return (
      <span
        role="link"
        aria-disabled="true"
        title="This link isn't complete yet"
        data-link-kind={link.kind}
        className={className}
      >
        {children}
      </span>
    );
  }

  const external = isExternalHref(href);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (preview) event.preventDefault();
    onLinkClick?.(link);
  }

  function handleAuxClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 1) return; // middle button only; right-click opens a menu
    if (preview) event.preventDefault();
    onLinkClick?.(link);
  }

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      title={title}
      data-link-kind={link.kind}
      className={className}
    >
      {children}
      {external && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

import type { MouseEvent } from "react";
import { ArrowRight } from "lucide-react";

import { absoluteAppUrl } from "@/lib/config";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./styles";
import type { CardMode } from "./types";

/**
 * "Member of WashU SHPE", on every card. It protects the brand (anything under
 * washushpe.org/card/ looks official, so the card says plainly whose site this
 * is) and turns every tap into a way back to the chapter.
 *
 * It's the site's own home page, so it opens in the same tab. In the preview
 * it's inert like every other link.
 */
export function FooterBlock({ mode }: { mode: CardMode }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (mode === "preview") event.preventDefault();
  }
  return (
    <footer data-part="footer" className="border-t border-(--card-rule) pt-3 text-center @3xl:col-span-2">
      <a
        href={absoluteAppUrl("/")}
        onClick={handleClick}
        onAuxClick={handleClick}
        className={cn(
          "no-link-style inline-flex min-h-11 items-center gap-1.5 rounded-sm px-2 text-sm text-(--card-muted) no-underline underline-offset-4 hover:underline",
          FOCUS_RING,
        )}
      >
        Member of <span className="font-semibold text-(--card-text)">WashU SHPE</span>
        <ArrowRight className="size-4 shrink-0" />
      </a>
    </footer>
  );
}

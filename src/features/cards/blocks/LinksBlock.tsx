import type { PublicCardLink } from "@/types/database";
import type { ResolvedTheme } from "../themes";
import { linkDisplayLabel } from "../linkKinds";
import { cn } from "@/lib/utils";
import { CardLink } from "./CardLink";
import { LinkKindIcon } from "./LinkKindIcon";
import { FOCUS_RING, WRAP_ANYWHERE, buttonClass, tileClass } from "./styles";
import type { CardMode, LinkClickHandler } from "./types";

interface LinkBlockProps {
  theme: ResolvedTheme;
  mode: CardMode;
  centered: boolean;
  onLinkClick?: LinkClickHandler;
}

/**
 * The featured link: one big primary button, e.g. "Book a coffee chat" or a
 * résumé. Always filled, whatever the button style, so it reads as the main
 * thing to tap; button text on the accent fill is a pairing the contrast
 * checks always cover.
 */
export function FeaturedLinkBlock({
  link,
  theme,
  mode,
  onLinkClick,
}: LinkBlockProps & { link: PublicCardLink }) {
  return (
    <div data-section="featured">
      <CardLink
        link={link}
        mode={mode}
        onLinkClick={onLinkClick}
        className={cn(
          buttonClass("primary"),
          "min-h-[calc(var(--card-button-h)+0.75rem)] justify-center text-center text-lg",
        )}
      >
        {theme.buttons.icons && <LinkKindIcon kind={link.kind} className="size-6 shrink-0" />}
        <span className={WRAP_ANYWHERE}>{linkDisplayLabel(link)}</span>
      </CardLink>
    </div>
  );
}

/**
 * Every other link, as a list of full-width buttons or a grid of icon tiles,
 * in the member's order.
 */
export function LinksBlock({ links, theme, mode, centered, onLinkClick }: LinkBlockProps & { links: PublicCardLink[] }) {
  if (links.length === 0) return null;
  const { style, arrangement, icons } = theme.buttons;

  // Icon tiles: the icon inside a square in the button style, the label under
  // it in the body text colour. Both sit inside one anchor, so the whole tile
  // and its caption are a single target.
  //
  // A tile is only about 66px wide on a phone, room for ten or so characters
  // a line, and every custom link shares the same icon, so the caption is
  // often the only way to tell two links apart. It wraps onto a second line
  // (breaking a long word if it has to) rather than being cut to one, and
  // only a label too long for two lines is shortened. The full label stays in
  // the anchor's text, which clamping hides only visually, so it is always
  // the link's accessible name; `title` shows it to mouse users on hover.
  if (arrangement === "icon-grid" && icons) {
    return (
      <div data-section="links" data-arrangement="icon-grid">
        <h2 className="sr-only">Links</h2>
        <ul role="list" className="grid grid-cols-3 gap-x-3 gap-y-4 @xs:grid-cols-4">
          {links.map((link) => {
            const label = linkDisplayLabel(link);
            return (
              <li key={link.id} className="min-w-0">
                <CardLink
                  link={link}
                  mode={mode}
                  onLinkClick={onLinkClick}
                  title={label}
                  className={cn(
                    "no-link-style flex min-h-11 flex-col items-center gap-1.5 rounded-(--card-button-radius) text-(--card-text) no-underline",
                    FOCUS_RING,
                  )}
                >
                  <span className={tileClass(style)}>
                    <LinkKindIcon kind={link.kind} className="size-7" />
                  </span>
                  <span
                    data-part="tile-label"
                    className={cn(
                      "line-clamp-2 w-full text-center text-xs leading-snug font-medium text-(--card-text)",
                      WRAP_ANYWHERE,
                    )}
                  >
                    {label}
                  </span>
                </CardLink>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // A grid without icons would be a grid of blank squares, so it becomes
  // two columns of labelled buttons instead.
  const grid = arrangement === "icon-grid";

  return (
    <div data-section="links" data-arrangement={grid ? "grid" : "list"}>
      <h2 className="sr-only">Links</h2>
      <ul role="list" className={grid ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3"}>
        {links.map((link) => {
          const balance = centered && icons && !grid;
          return (
            <li key={link.id} className="min-w-0">
              <CardLink
                link={link}
                mode={mode}
                onLinkClick={onLinkClick}
                className={cn(
                  buttonClass(style),
                  centered || grid ? "justify-center text-center" : "justify-start text-left",
                )}
              >
                {icons && <LinkKindIcon kind={link.kind} className="size-5 shrink-0" />}
                <span className={cn(WRAP_ANYWHERE, balance && "flex-1")}>{linkDisplayLabel(link)}</span>
                {/* Mirrors the icon so a centred label is centred on the button, not on the space beside the icon. */}
                {balance && <span aria-hidden="true" className="size-5 shrink-0" />}
              </CardLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

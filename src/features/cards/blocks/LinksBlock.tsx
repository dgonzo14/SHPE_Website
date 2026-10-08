import { useId, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";

import type { PublicCardLink } from "@/types/database";
import type { CardButtonStyle } from "../model";
import type { ResolvedTheme } from "../themes";
import { useLayoutSpec } from "../layouts";
import { LINK_GROUPS, isExternalHref, linkDetail, linkDisplayLabel, linkGroup, linkHref } from "../linkKinds";
import { cn } from "@/lib/utils";
import { CardLink } from "./CardLink";
import { LinkKindIcon } from "./LinkKindIcon";
import { Section } from "./Section";
import {
  FOCUS_RING,
  ICON_CHIPS,
  LIFT,
  SECTION_STYLES,
  WRAP_ANYWHERE,
  buttonClass,
  iconTone,
  tileClass,
} from "./styles";
import type { CardMode, LinkClickHandler } from "./types";

interface LinkBlockProps {
  theme: ResolvedTheme;
  mode: CardMode;
  centered: boolean;
  onLinkClick?: LinkClickHandler;
}

/**
 * The featured link, e.g. "Book a coffee chat" or a résumé, set apart from
 * the others whatever the button style. In the original layouts it's one big
 * button in the main button colour. The professional layouts give it the
 * same height as Add to Contacts and outline it in the accent instead, so a
 * visitor sees one main action, not two of equal weight. Either way its
 * colours are pairings the contrast checks always cover.
 */
export function FeaturedLinkBlock({
  link,
  theme,
  mode,
  onLinkClick,
}: LinkBlockProps & { link: PublicCardLink }) {
  const { featured } = useLayoutSpec();
  const secondary = featured === "secondary";
  return (
    <div data-section="featured" data-emphasis={featured}>
      <CardLink
        link={link}
        mode={mode}
        onLinkClick={onLinkClick}
        className={cn(
          secondary
            ? cn(buttonClass("featured"), "justify-center text-center")
            : cn(
                buttonClass("primary"),
                "min-h-[calc(var(--card-button-h)+0.75rem)] justify-center text-center text-lg",
              ),
        )}
      >
        {theme.buttons.icons && (
          <LinkKindIcon
            kind={link.kind}
            className={secondary ? "size-5 shrink-0 text-(--card-accent)" : "size-6 shrink-0"}
          />
        )}
        <span className={WRAP_ANYWHERE}>{linkDisplayLabel(link)}</span>
      </CardLink>
    </div>
  );
}

interface ArrangementProps {
  links: PublicCardLink[];
  style: CardButtonStyle;
  icons: boolean;
  mode: CardMode;
  onLinkClick?: LinkClickHandler;
}

/**
 * Rows: each link on its own line between fine rules, with where it goes
 * underneath ("linkedin.com/in/ana", the email address), and an arrow. Quiet
 * enough for a formal card, and the address is right there to read aloud or
 * copy down. Indexed rows number the links like a contents page and set the
 * labels in the name font.
 */
function LinkRows({
  links,
  style,
  icons,
  mode,
  onLinkClick,
  indexed,
  framed,
}: ArrangementProps & { indexed: boolean; framed: boolean }) {
  return (
    <ul
      role="list"
      className={cn("flex flex-col divide-y divide-(--card-rule)", framed && "border-y border-(--card-rule)")}
    >
      {links.map((link, index) => {
        const label = linkDisplayLabel(link);
        const detail = linkDetail(link);
        const href = linkHref(link.kind, link.value);
        // Mail and phone open an app in place; everything else leaves the card.
        const Trail = href && !isExternalHref(href) ? ChevronRight : ArrowUpRight;
        return (
          <li key={link.id} className="min-w-0">
            <CardLink
              link={link}
              mode={mode}
              onLinkClick={onLinkClick}
              className={cn(
                "no-link-style group flex min-h-[3.25rem] w-full items-center gap-3.5 rounded-[0.375rem] py-3 text-left text-(--card-text) no-underline",
                FOCUS_RING,
              )}
            >
              {indexed && (
                <span
                  aria-hidden="true"
                  className="w-6 shrink-0 self-start pt-1 text-[0.8125rem] text-(--card-muted) tabular-nums"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              )}
              {icons && (
                <span aria-hidden="true" className={ICON_CHIPS[style]}>
                  <LinkKindIcon kind={link.kind} className={style === "hairline" ? "size-5" : "size-[1.125rem]"} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  data-part="row-label"
                  className={cn(
                    WRAP_ANYWHERE,
                    indexed
                      ? "[font-family:var(--card-font-heading)] text-[1.25rem] leading-tight [font-weight:var(--card-heading-weight)]"
                      : "text-base leading-snug font-semibold",
                  )}
                >
                  {label}
                </span>
                {detail && detail !== label && (
                  <>
                    {/* Two block lines read as one word ("LinkedInlinkedin.com/in/ana") without a pause between. */}
                    <span className="sr-only">, </span>
                    <span data-part="row-detail" title={detail} className="truncate text-sm text-(--card-muted)">
                      {detail}
                    </span>
                  </>
                )}
              </span>
              <Trail
                aria-hidden="true"
                className="size-4 shrink-0 text-(--card-muted) motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:translate-x-0.5"
              />
            </CardLink>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Compact: two columns of 44px buttons, labels centred. An odd last button
 * takes the full row rather than sitting alone in half of it, and on a very
 * narrow screen the buttons stack into one column.
 */
function CompactLinks({ links, style, icons, mode, onLinkClick }: ArrangementProps) {
  return (
    <ul
      role="list"
      className="grid grid-cols-[repeat(auto-fit,minmax(max(8.5rem,calc(50%-0.375rem)),1fr))] gap-3"
    >
      {links.map((link) => (
        <li key={link.id} className="min-w-0 [&:last-child:nth-child(odd)]:col-[1/-1]">
          <CardLink
            link={link}
            mode={mode}
            onLinkClick={onLinkClick}
            className={cn(buttonClass(style, "compact"), "h-full justify-center text-center")}
          >
            {icons && <LinkKindIcon kind={link.kind} className={cn("size-[1.125rem] shrink-0", iconTone(style))} />}
            <span className={WRAP_ANYWHERE}>{linkDisplayLabel(link)}</span>
          </CardLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * Grouped: link cards sorted into Work, Professional and Social (LINK_GROUPS),
 * in the member's order within each. Group titles appear only when there is
 * more than one group; a card with three work links just shows the three.
 * Cards pair up only when each still has room for its address (11rem), which
 * is a desktop card; on a phone they stack, addresses whole.
 */
function GroupedLinks({
  links,
  style,
  icons,
  mode,
  onLinkClick,
  titleClass,
}: ArrangementProps & { titleClass: string }) {
  const idPrefix = useId();
  const groups = LINK_GROUPS.map((group) => ({
    ...group,
    links: links.filter((link) => linkGroup(link.kind) === group.id),
  })).filter((group) => group.links.length > 0);
  const titled = groups.length > 1;

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => {
        const titleId = `${idPrefix}-${group.id}`;
        return (
          <div key={group.id} data-group={group.id} className="flex flex-col gap-2.5">
            {titled && (
              <h3 id={titleId} className={titleClass}>
                {group.title}
              </h3>
            )}
            <ul
              role="list"
              aria-labelledby={titled ? titleId : undefined}
              className="grid grid-cols-[repeat(auto-fit,minmax(max(11rem,calc(50%-0.3125rem)),1fr))] gap-2.5"
            >
              {group.links.map((link) => {
                const label = linkDisplayLabel(link);
                const detail = linkDetail(link);
                return (
                  <li key={link.id} className="min-w-0">
                    <CardLink
                      link={link}
                      mode={mode}
                      onLinkClick={onLinkClick}
                      className={cn(
                        "no-link-style flex h-full min-h-[3.75rem] items-center gap-3 rounded-[min(var(--card-radius),0.875rem)] border border-(--card-border) bg-(--card-surface) p-3 text-left text-(--card-text) no-underline",
                        LIFT,
                        FOCUS_RING,
                      )}
                    >
                      {icons && (
                        <span aria-hidden="true" className={ICON_CHIPS[style]}>
                          <LinkKindIcon kind={link.kind} className="size-[1.125rem]" />
                        </span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("text-[0.9375rem] leading-snug font-semibold", WRAP_ANYWHERE)}>
                          {label}
                        </span>
                        {detail && detail !== label && (
                          <>
                            <span className="sr-only">, </span>
                            <span data-part="row-detail" title={detail} className="truncate text-xs text-(--card-muted)">
                              {detail}
                            </span>
                          </>
                        )}
                      </span>
                    </CardLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Every other link, in the member's order, laid out by the arrangement:
 * full-width buttons, icon tiles, rows, compact buttons, or grouped cards.
 */
export function LinksBlock({ links, theme, mode, centered, onLinkClick }: LinkBlockProps & { links: PublicCardLink[] }) {
  const spec = useLayoutSpec();
  if (links.length === 0) return null;
  const { style, arrangement, icons } = theme.buttons;
  const shared = { links, style, icons, mode, onLinkClick };

  let name: string;
  let body: ReactNode;
  if (arrangement === "rows") {
    name = "rows";
    body = <LinkRows {...shared} indexed={spec.indexedRows} framed={spec.framedRows} />;
  } else if (arrangement === "compact") {
    name = "compact";
    body = <CompactLinks {...shared} />;
  } else if (arrangement === "grouped") {
    name = "grouped";
    body = <GroupedLinks {...shared} titleClass={SECTION_STYLES[spec.sectionStyle].title} />;
  } else if (arrangement === "icon-grid" && icons) {
    // Icon tiles: the icon inside a square in the button style, the label
    // under it in the body text colour. Both sit inside one anchor, so the
    // whole tile and its caption are a single target.
    //
    // A tile is only about 66px wide on a phone, room for ten or so
    // characters a line, and every custom link shares the same icon, so the
    // caption is often the only way to tell two links apart. It wraps onto a
    // second line (breaking a long word if it has to) rather than being cut
    // to one, and only a label too long for two lines is shortened. The full
    // label stays in the anchor's text, which clamping hides only visually,
    // so it is always the link's accessible name; `title` shows it to mouse
    // users on hover.
    name = "icon-grid";
    body = (
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
                  <LinkKindIcon kind={link.kind} className={cn("size-7", iconTone(style))} />
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
    );
  } else {
    // A grid without icons would be a grid of blank squares, so it becomes
    // two columns of labelled buttons instead.
    const grid = arrangement === "icon-grid";
    name = grid ? "grid" : "list";
    body = (
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
                {icons && <LinkKindIcon kind={link.kind} className={cn("size-5 shrink-0", iconTone(style))} />}
                <span className={cn(WRAP_ANYWHERE, balance && "flex-1")}>{linkDisplayLabel(link)}</span>
                {/* Mirrors the icon so a centred label is centred on the button, not on the space beside the icon. */}
                {balance && <span aria-hidden="true" className="size-5 shrink-0" />}
              </CardLink>
            </li>
          );
        })}
      </ul>
    );
  }

  // The original layouts keep the links untitled (the heading is for screen
  // readers); the professional ones introduce them like any other block.
  // Grouped links already carry titles of their own once there are two
  // groups, so "Links" above "Work" would only repeat itself.
  if (!spec.linksTitle) {
    return (
      <div data-section="links" data-arrangement={name}>
        <h2 className="sr-only">Links</h2>
        {body}
      </div>
    );
  }
  const groupTitles =
    arrangement === "grouped" && new Set(links.map((link) => linkGroup(link.kind))).size > 1;
  return (
    <Section id="links" title="Links" hideTitle={groupTitles} arrangement={name}>
      {body}
    </Section>
  );
}

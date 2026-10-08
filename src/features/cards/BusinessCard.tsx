import { Fragment, useId, useMemo, type ReactNode } from "react";

import type { PublicCardData, PublicCardLink } from "@/types/database";
import { cardMediaUrl } from "@/services/cards";
import { cn } from "@/lib/utils";
import { CARD_SECTION_IDS, DEFAULT_CARD_SECTIONS, type CardSectionId } from "./model";
import { resolveTheme, themeCssVars } from "./themes";
import { themeShowsPhoto } from "./photoVisibility";
import { CardLayoutContext, layoutSpec } from "./layouts";
import { useCardFonts } from "./fonts";
import { linkHref } from "./linkKinds";
import { HeaderBlock } from "./blocks/HeaderBlock";
import { AccentEdge, BadgeBand, BannerCover } from "./blocks/Cover";
import { ActionsBlock } from "./blocks/ActionsBlock";
import { FeaturedLinkBlock, LinksBlock } from "./blocks/LinksBlock";
import { AboutBlock, EducationBlock, ShpeBlock, StatusBlock, TagsBlock } from "./blocks/ContentBlocks";
import { FooterBlock } from "./blocks/FooterBlock";
import type { CardMode } from "./blocks/types";

export interface BusinessCardProps {
  card: PublicCardData;
  /** preview: nothing navigates away; buttons call handlers or are inert. */
  mode: CardMode;
  onAddToContacts?: () => void;
  onShare?: () => void;
  onLinkClick?: (link: PublicCardLink) => void;
  /** Storage path → URL. Defaults to cardMediaUrl, which only accepts card-media paths. */
  resolveMedia?: (path: string | null) => string | null;
  className?: string;
}

/** The listed sections, known ids only, each once, in the member's order. */
function orderedSections(sections: unknown): CardSectionId[] {
  const list = Array.isArray(sections) ? sections : DEFAULT_CARD_SECTIONS;
  const seen = new Set<CardSectionId>();
  for (const id of list) {
    if ((CARD_SECTION_IDS as readonly unknown[]).includes(id)) seen.add(id as CardSectionId);
  }
  return [...seen];
}

function asList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/*
 * Fonts are set per element, not just inherited: index.css gives p, li, a,
 * button and every heading Libre Franklin directly, which would beat an
 * inherited family. These rules live in Tailwind's utilities layer, so they
 * outrank that base-layer rule without !important.
 */
const FONT_SCOPE =
  "font-[family-name:var(--card-font-body)] " +
  "[&_:where(p,li,a,button,h2,h3)]:[font-family:var(--card-font-body)] " +
  "[&_h1]:[font-family:var(--card-font-heading)]";

/**
 * The business card. One component draws both the public page and the
 * editor's live preview, so the preview is always exactly what a visitor sees.
 *
 * It renders PublicCardData and nothing else: what a card may show was
 * decided upstream, by get_public_card() for the public page and by
 * toPreviewCard() (which mirrors it) for the editor. The theme is resolved
 * defensively (resolveTheme never throws), and every colour reaches the page
 * through CSS custom properties built from validated values.
 *
 * Layout: the root fills its container with the theme's background and
 * centres a card up to 28rem wide (the split, editorial and studio layouts
 * grow to two columns once their container is 48rem wide). Container queries
 * rather than media queries, so a narrow preview frame on a wide screen still
 * gets the phone layout. Everything a layout changes beyond its header lives
 * in LAYOUT_SPECS (layouts.ts), which the blocks read through context, so
 * there is one set of composition rules for the page and the preview alike.
 *
 * Always present, whatever the sections: the header, Add to Contacts, Share
 * and the "Member of WashU SHPE" footer. Starter cards (officer-made, not yet
 * opened) show only the name, school, education, verified position, Add to
 * Contacts and the footer.
 */
export function BusinessCard({
  card,
  mode,
  onAddToContacts,
  onShare,
  onLinkClick,
  resolveMedia = cardMediaUrl,
  className,
}: BusinessCardProps) {
  const nameId = useId();
  const theme = useMemo(() => resolveTheme(card.theme), [card.theme]);
  useCardFonts([theme.font.heading, theme.font.body]);

  const starter = Boolean(card.is_starter);
  const layout = theme.layout;
  const spec = layoutSpec(layout);
  const centered = spec.centered;

  const backgroundUrl =
    !starter && theme.background.type === "image" ? resolveMedia(card.background_path) : null;
  const style = themeCssVars(theme, backgroundUrl);
  const avatarUrl = starter ? null : resolveMedia(card.avatar_path);
  const bannerUrl = starter ? null : resolveMedia(card.banner_path);
  // The same rule decides whether Add to Contacts and link previews may use
  // the photo, so a photo hidden here is hidden there too.
  const showAvatar = !starter && themeShowsPhoto(theme);

  const sections: CardSectionId[] = starter ? ["education"] : orderedSections(card.sections);

  // A public card drops links that can't be made safe; the database CHECK
  // means there shouldn't be any. The preview keeps them, shown as not yet
  // working, so the member can see what needs fixing.
  const links = starter
    ? []
    : asList(card.links).filter((link) => mode === "preview" || linkHref(link.kind, link.value));
  const featured = links.find((link) => link.is_featured) ?? null;
  // The featured link moves out of the list only when its section is shown;
  // hide the Featured block and it goes back among the others.
  const showFeatured = Boolean(featured) && sections.includes("featured");
  const listLinks = showFeatured ? links.filter((link) => link !== featured) : links;

  const linkProps = { theme, mode, centered, onLinkClick };

  function renderSection(id: CardSectionId): ReactNode {
    switch (id) {
      case "status":
        return <StatusBlock text={card.status_line} centered={centered} />;
      case "featured":
        return showFeatured && featured ? <FeaturedLinkBlock link={featured} {...linkProps} /> : null;
      case "links":
        return <LinksBlock links={listLinks} {...linkProps} />;
      case "about":
        return <AboutBlock bio={card.bio} />;
      case "education":
        return <EducationBlock education={card.education} />;
      case "shpe":
        return <ShpeBlock shpe={card.shpe} centered={centered} />;
      case "skills":
        return <TagsBlock id="skills" title="Skills" items={asList(card.skills)} centered={centered} />;
      case "languages":
        return <TagsBlock id="languages" title="Languages" items={asList(card.languages)} centered={centered} />;
    }
  }

  return (
    <div
      data-card-root=""
      data-card-layout={layout}
      data-card-preset={theme.preset}
      data-card-mode={mode}
      style={style}
      className={cn(
        "@container flex min-h-full w-full flex-col items-center px-4 py-8 text-(--card-text) sm:py-12",
        FONT_SCOPE,
        className,
      )}
    >
      <CardLayoutContext value={spec}>
        <article
          aria-labelledby={nameId}
          className={cn(
            "relative w-full max-w-[28rem] overflow-hidden rounded-(--card-radius) bg-(--card-surface-fill)",
            "[backdrop-filter:var(--card-backdrop)] [-webkit-backdrop-filter:var(--card-backdrop)]",
            spec.card,
          )}
        >
          {layout === "banner" && <BannerCover src={bannerUrl} />}
          {layout === "badge" && <BadgeBand />}
          {layout === "profile" && <AccentEdge />}

          <div
            className={cn(
              "flex flex-col gap-(--card-gap) p-(--card-pad)",
              centered ? "text-center" : "text-left",
              spec.columns,
            )}
          >
            <div className={cn("flex min-w-0 flex-col gap-(--card-gap)", spec.lead)}>
              <HeaderBlock
                card={card}
                theme={theme}
                avatarUrl={avatarUrl}
                nameId={nameId}
                showAvatar={showAvatar}
              />
              <ActionsBlock
                onAddToContacts={onAddToContacts}
                onShare={onShare}
                showShare={!starter}
                icons={theme.buttons.icons}
              />
            </div>

            <div
              data-part="sections"
              className={cn("flex min-w-0 flex-col gap-(--card-gap) empty:hidden", spec.sections)}
            >
              {sections.map((id) => (
                <Fragment key={id}>{renderSection(id)}</Fragment>
              ))}
            </div>

            <FooterBlock mode={mode} />
          </div>
        </article>
      </CardLayoutContext>
    </div>
  );
}

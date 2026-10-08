import type { ReactNode } from "react";
import { BadgeCheck, MapPin } from "lucide-react";

import type { PublicCardData } from "@/types/database";
import type { CardLayout } from "../model";
import type { ResolvedTheme } from "../themes";
import { layoutSpec } from "../layouts";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { nameLengthStep } from "./format";
import { WRAP_ANYWHERE } from "./styles";

const VERIFIED_LABEL = "Verified by chapter officers";

/**
 * "WashU SHPE · President ✔", for a line or a chip. The check rides inline at
 * the end of the text, glued to the last word, so a long title wraps with the
 * check still beside it rather than leaving it alone on a line of its own.
 * The glue is the nowrap wrapper: it is the nearest common ancestor of the
 * text's last letter and the icon, so no line break can fall between them,
 * while the text inside still wraps as normal.
 */
function VerifiedPositionContent({ position }: { position: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className={cn("whitespace-normal", WRAP_ANYWHERE)}>WashU SHPE · {position}</span>
      <span title={VERIFIED_LABEL} className="ml-1.5 inline-flex align-[-0.2em]">
        <BadgeCheck role="img" aria-label={VERIFIED_LABEL} className="size-4 shrink-0 text-(--card-accent)" />
      </span>
    </span>
  );
}

/**
 * "WashU SHPE · President ✔". The only line on a card that speaks for the
 * chapter, so it comes only from the officer-assigned position
 * (card.shpe.position, from chapter_positions). Nothing a member types, not
 * even a headline that says "President of SHPE", can produce it.
 */
function VerifiedPosition({
  position,
  centered,
  className,
}: {
  position: string;
  centered: boolean;
  className?: string;
}) {
  return (
    <p
      data-part="verified-position"
      className={cn("text-sm font-semibold text-(--card-text)", centered && "text-center", className)}
    >
      <VerifiedPositionContent position={position} />
    </p>
  );
}

function Pronouns({ value }: { value: string }) {
  return (
    <span className="text-sm text-(--card-muted)">
      <span className="sr-only">Pronouns: </span>
      {value}
    </span>
  );
}

function Location({ value, centered }: { value: string; centered: boolean }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-sm text-(--card-muted)", centered && "justify-center")}>
      <MapPin className="size-4 shrink-0" />
      <span className={WRAP_ANYWHERE}>{value}</span>
    </p>
  );
}

function AlumniTag({ centered }: { centered: boolean }) {
  return (
    <p className={cn("flex pt-1", centered && "justify-center")}>
      <span
        data-part="alumni"
        className="rounded-(--card-button-radius) border border-(--card-rule) px-2.5 py-0.5 text-xs font-semibold tracking-[0.08em] text-(--card-text) uppercase"
      >
        Alumni
      </span>
    </p>
  );
}

/**
 * A small rounded tag for the Studio and Layered headers. Sized so a location
 * and "WashU SHPE · President" share one row on a 375px phone.
 */
const CHIP =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-(--card-border) px-2 py-1 text-xs leading-snug text-(--card-text)";

/* ── Name sizes ──────────────────────────────────────────────────────────── */

const NAME_SIZES: Record<"classic" | "banner" | "badge" | "split" | "minimal", string> = {
  classic: "text-[1.875rem] leading-tight",
  banner: "text-[1.875rem] leading-tight",
  badge: "text-[2rem] leading-tight",
  split: "text-[1.625rem] leading-tight @3xl:text-[1.875rem]",
  minimal: "text-[2.5rem] leading-[1.05] tracking-tight",
};

/**
 * The professional layouts set the name large, so each steps down twice as a
 * name gets longer: a name is the anchor of the card, and "Maria Guadalupe
 * Hernández-Villanueva" should wrap onto two comfortable lines, not four.
 */
const NAME_SCALES: Record<Exclude<CardLayout, keyof typeof NAME_SIZES>, readonly [string, string, string]> = {
  profile: ["text-[1.875rem]", "text-[1.625rem]", "text-[1.375rem]"],
  editorial: ["text-[2.875rem]", "text-[2.375rem]", "text-[1.875rem]"],
  studio: ["text-[1.375rem]", "text-[1.25rem]", "text-[1.125rem]"],
  layered: ["text-[2rem]", "text-[1.75rem]", "text-[1.5rem]"],
  letterhead: ["text-[2.25rem]", "text-[1.875rem]", "text-[1.625rem]"],
  monogram: ["text-[3rem]", "text-[2.375rem]", "text-[1.875rem]"],
};

const NAME_LENGTHS = ["regular", "long", "longest"] as const;

/* ── Compositions ────────────────────────────────────────────────────────── */

interface HeaderContent {
  name: string;
  nameId: string;
  pronouns: string | null;
  headline: string | null;
  organization: string | null;
  location: string | null;
  position: string | null;
  isAlumni: boolean;
  /** Only when the card shows it (show_graduation_year). */
  classYear: number | null;
  /** The photo (or initials), or null when the design shows none. */
  avatar: (className?: string) => ReactNode;
}

function NameHeading({ content, className }: { content: HeaderContent; className: string }) {
  return (
    <h1
      id={content.nameId}
      className={cn(className, WRAP_ANYWHERE, "[font-weight:var(--card-heading-weight)] text-(--card-text)")}
    >
      {content.name}
    </h1>
  );
}

/** The name with the pronouns after it, wrapping onto a line of their own when there isn't room. */
function NameRow({
  content,
  className,
  centered = false,
}: {
  content: HeaderContent;
  className: string;
  centered?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", centered && "justify-center")}>
      <NameHeading content={content} className={className} />
      {content.pronouns && <Pronouns value={content.pronouns} />}
    </div>
  );
}

/**
 * The original five layouts: photo, name, pronouns, the verified position
 * line, headline, school and location, and an alumni marker.
 */
function OriginalHeader({
  content,
  layout,
}: {
  content: HeaderContent;
  layout: keyof typeof NAME_SIZES;
}) {
  const centered = layout === "classic" || layout === "banner" || layout === "badge";
  const { headline, organization, location, position, isAlumni } = content;

  return (
    <header
      data-part="header"
      className={cn(
        "flex gap-4",
        centered ? "flex-col items-center text-center" : "items-start text-left",
        layout === "split" && "flex-row items-center @3xl:flex-col @3xl:items-start [--card-avatar-size:5rem]",
        layout === "minimal" && "flex-col",
      )}
    >
      {content.avatar()}

      <div className={cn("flex min-w-0 flex-col gap-1.5", centered && "items-center")}>
        <NameRow content={content} className={NAME_SIZES[layout]} centered={centered} />

        {layout === "minimal" && (
          <span aria-hidden="true" className="my-1 block h-1 w-12 bg-(--card-accent)" />
        )}

        {position && <VerifiedPosition position={position} centered={centered} />}

        {headline && <p className={cn("text-base text-(--card-text)", WRAP_ANYWHERE)}>{headline}</p>}

        {organization && <p className={cn("text-sm text-(--card-muted)", WRAP_ANYWHERE)}>{organization}</p>}

        {location && <Location value={location} centered={centered} />}

        {isAlumni && <AlumniTag centered={centered} />}
      </div>
    </header>
  );
}

/*
 * The professional layouts all read in the same order: name, then role (the
 * headline), then affiliation (school or employer, the verified chapter
 * position, location). What changes is the composition around them. Each
 * group renders only when it has something in it, so a card with just a name
 * is just a name, with no stray rules or gaps.
 */

interface ProfessionalHeaderProps {
  content: HeaderContent;
  /** The name's size class, stepped down for long names. */
  scale: string;
  /** Which step, as data-name-length, for tests and debugging. */
  nameLength: (typeof NAME_LENGTHS)[number];
}

/** Executive: the portrait beside the name, affiliations below a hairline. */
function ProfileHeader({ content, scale, nameLength }: ProfessionalHeaderProps) {
  const { headline, organization, location, position, isAlumni } = content;
  const details = Boolean(position || location || isAlumni);
  return (
    <header data-part="header" data-name-length={nameLength} className="flex flex-col gap-5 text-left">
      <div className={cn("flex gap-4 @xs:gap-5", headline || organization ? "items-start" : "items-center")}>
        {content.avatar("[--card-avatar-size:4.5rem] @sm:[--card-avatar-size:5.25rem]")}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <NameRow content={content} className={cn(scale, "leading-[1.12] tracking-[-0.01em] text-balance")} />
          {headline && (
            <p className={cn("text-[1.0625rem] leading-snug text-(--card-text)", WRAP_ANYWHERE)}>{headline}</p>
          )}
          {organization && (
            <p className={cn("text-[0.9375rem] leading-snug text-(--card-muted)", WRAP_ANYWHERE)}>{organization}</p>
          )}
        </div>
      </div>
      {details && (
        <div data-part="affiliations" className="flex flex-col gap-2 border-t border-(--card-rule) pt-4">
          {position && <VerifiedPosition position={position} centered={false} />}
          {location && <Location value={location} centered={false} />}
          {isAlumni && <AlumniTag centered={false} />}
        </div>
      )}
    </header>
  );
}

/**
 * Editorial: a running head over a large serif name, the portrait set off to
 * the right, and the headline held to a short measure like a standfirst. The
 * running head names the chapter like a masthead and, where the card shows
 * it, the member's class like an issue line; with no year it is just the
 * chapter.
 */
function EditorialHeader({ content, scale, nameLength }: ProfessionalHeaderProps) {
  const { headline, organization, location, position, isAlumni } = content;
  const details = Boolean(organization || location || position || isAlumni);
  return (
    <header data-part="header" data-name-length={nameLength} className="flex flex-col gap-5 text-left">
      <p
        aria-hidden="true"
        data-part="masthead"
        className="flex items-baseline gap-3 border-b border-(--card-text) pb-2.5 text-[0.6875rem] font-semibold tracking-[0.22em] text-(--card-text) uppercase"
      >
        <span>WashU SHPE</span>
        {content.classYear && (
          <span data-part="class-year" className="ml-auto text-(--card-muted)">
            Class of {content.classYear}
          </span>
        )}
      </p>
      <div className="flex items-start gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
          <NameHeading content={content} className={cn(scale, "leading-[1.02] tracking-[-0.01em] text-balance")} />
          {content.pronouns && <Pronouns value={content.pronouns} />}
        </div>
        {content.avatar("[--card-avatar-size:5rem] @sm:[--card-avatar-size:5.75rem]")}
      </div>
      {headline && (
        <p className={cn("max-w-[34ch] text-[1.125rem] leading-normal text-(--card-text)", WRAP_ANYWHERE)}>
          {headline}
        </p>
      )}
      {details && (
        <div data-part="affiliations" className="flex flex-col gap-1.5">
          {organization && (
            <p className={cn("text-[0.9375rem] leading-snug text-(--card-muted)", WRAP_ANYWHERE)}>{organization}</p>
          )}
          {location && <Location value={location} centered={false} />}
          {position && <VerifiedPosition position={position} centered={false} />}
          {isAlumni && <AlumniTag centered={false} />}
        </div>
      )}
    </header>
  );
}

/**
 * Studio: a compact row of photo, name, role and school, with the location
 * and chapter position as tags underneath. The school stays a line of text
 * rather than a tag: names like "Washington University in St. Louis" are long
 * enough to take a row of tags to themselves on a phone.
 */
function StudioHeader({ content, scale, nameLength }: ProfessionalHeaderProps) {
  const { headline, organization, location, position, isAlumni } = content;
  const tags = Boolean(location || position || isAlumni);
  return (
    <header data-part="header" data-name-length={nameLength} className="flex flex-col gap-4 text-left">
      <div className={cn("flex gap-3.5", headline || organization ? "items-start" : "items-center")}>
        {content.avatar("[--card-avatar-size:3.75rem]")}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <NameRow content={content} className={cn(scale, "leading-tight tracking-[-0.02em]")} />
          {headline && (
            <p className={cn("text-[0.9375rem] leading-snug text-(--card-text)", WRAP_ANYWHERE)}>{headline}</p>
          )}
          {organization && (
            <p className={cn("text-sm leading-snug text-(--card-muted)", WRAP_ANYWHERE)}>{organization}</p>
          )}
        </div>
      </div>
      {tags && (
        <ul role="list" data-part="affiliations" className="flex flex-wrap gap-1.5">
          {location && (
            <li className={CHIP}>
              <MapPin aria-hidden="true" className="size-3 shrink-0 text-(--card-muted)" />
              <span className={WRAP_ANYWHERE}>{location}</span>
            </li>
          )}
          {position && (
            <li data-part="verified-position" className={cn(CHIP, "font-semibold")}>
              <VerifiedPositionContent position={position} />
            </li>
          )}
          {isAlumni && (
            <li data-part="alumni" className={cn(CHIP, "text-xs font-semibold tracking-[0.08em] uppercase")}>
              Alumni
            </li>
          )}
        </ul>
      )}
    </header>
  );
}

/** Layered: a centred identity over raised tags, on a charcoal card. */
function LayeredHeader({ content, scale, nameLength }: ProfessionalHeaderProps) {
  const { headline, organization, location, position, isAlumni } = content;
  const tags = Boolean(location || position || isAlumni);
  const raised = cn(CHIP, "bg-(--card-raised)");
  return (
    <header data-part="header" data-name-length={nameLength} className="flex flex-col items-center gap-4 text-center">
      {content.avatar(
        "[--card-avatar-size:5.75rem] shadow-[0_0_0_1px_var(--card-border),0_12px_28px_-12px_rgba(0,0,0,0.6)]",
      )}
      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <NameRow
          content={content}
          centered
          className={cn(scale, "leading-[1.1] tracking-[-0.015em] text-balance")}
        />
        {headline && (
          <p className={cn("text-[1.0625rem] leading-snug text-(--card-text)", WRAP_ANYWHERE)}>{headline}</p>
        )}
        {organization && (
          <p className={cn("text-[0.9375rem] leading-snug text-(--card-muted)", WRAP_ANYWHERE)}>{organization}</p>
        )}
      </div>
      {tags && (
        <ul role="list" data-part="affiliations" className="flex flex-wrap justify-center gap-2">
          {position && (
            <li data-part="verified-position" className={cn(raised, "font-semibold")}>
              <VerifiedPositionContent position={position} />
            </li>
          )}
          {location && (
            <li className={raised}>
              <MapPin aria-hidden="true" className="size-3 shrink-0 text-(--card-muted)" />
              <span className={WRAP_ANYWHERE}>{location}</span>
            </li>
          )}
          {isAlumni && (
            <li data-part="alumni" className={cn(raised, "text-xs font-semibold tracking-[0.08em] uppercase")}>
              Alumni
            </li>
          )}
        </ul>
      )}
    </header>
  );
}

/**
 * An affiliation set in spaced capitals (Letterhead, Monogram). Wide tracking
 * suits a short name; a long one ("McKelvey School of Engineering, Washington
 * University in St. Louis") would run to three spaced-out lines on a phone, so
 * past 34 characters it closes up.
 */
function isLongAffiliation(text: string): boolean {
  return [...text].length > 34;
}

/** Letterhead's ornament: a small accent diamond between two rules. */
function Ornament() {
  return (
    <span aria-hidden="true" data-part="ornament" className="flex w-28 items-center gap-2">
      <span className="h-px flex-1 bg-(--card-rule-strong)" />
      <span className="size-1.5 rotate-45 bg-(--card-accent)" />
      <span className="h-px flex-1 bg-(--card-rule-strong)" />
    </span>
  );
}

/**
 * Letterhead: a double rule and the member's university or employer at the
 * top, like headed paper, then the portrait and name, with the chapter
 * position under an ornament.
 */
function LetterheadHeader({ content, scale, nameLength }: ProfessionalHeaderProps) {
  const { headline, organization, location, position, isAlumni } = content;
  const details = Boolean(position || location || isAlumni);
  const longAffiliation = organization ? isLongAffiliation(organization) : false;
  return (
    <header data-part="header" data-name-length={nameLength} className="flex flex-col items-center gap-5 text-center">
      <span aria-hidden="true" data-part="letterhead-rule" className="block h-[5px] w-full border-y border-(--card-text)" />
      {organization && (
        <p
          data-part="affiliation"
          data-length={longAffiliation ? "long" : "short"}
          className={cn(
            "text-xs font-semibold text-balance text-(--card-text) uppercase",
            longAffiliation ? "tracking-[0.1em]" : "tracking-[0.2em]",
            WRAP_ANYWHERE,
          )}
        >
          {organization}
        </p>
      )}
      {content.avatar("mt-1 [--card-avatar-size:6rem]")}
      <div className="flex min-w-0 flex-col items-center gap-2">
        <NameRow content={content} centered className={cn(scale, "leading-[1.1] text-balance")} />
        {headline && <p className={cn("text-base leading-snug text-(--card-text)", WRAP_ANYWHERE)}>{headline}</p>}
      </div>
      {details && (
        <div data-part="affiliations" className="flex flex-col items-center gap-2">
          <Ornament />
          {position && <VerifiedPosition position={position} centered className="mt-1" />}
          {location && <Location value={location} centered />}
          {isAlumni && <AlumniTag centered />}
        </div>
      )}
    </header>
  );
}

/** Monogram's divider: two fine rules and an accent point. */
function FineDivider() {
  return (
    <span aria-hidden="true" data-part="divider" className="flex w-32 items-center gap-3">
      <span className="h-px flex-1 bg-(--card-rule-strong)" />
      <span className="size-1 rounded-full bg-(--card-accent)" />
      <span className="h-px flex-1 bg-(--card-rule-strong)" />
    </span>
  );
}

/**
 * Monogram: the name set large as the centrepiece, under a portrait or the
 * member's initials in a fine ring. Choose "No photo" and the name stands
 * entirely on its own.
 */
function MonogramHeader({ content, scale, nameLength }: ProfessionalHeaderProps) {
  const { headline, organization, location, position, isAlumni } = content;
  const details = Boolean(headline || organization || location || position || isAlumni);
  return (
    <header data-part="header" data-name-length={nameLength} className="flex flex-col items-center gap-6 text-center">
      {content.avatar("[--card-avatar-size:5.25rem]")}
      <div className="flex min-w-0 flex-col items-center gap-2">
        <NameHeading content={content} className={cn(scale, "leading-[1.04] tracking-[-0.005em] text-balance")} />
        {content.pronouns && <Pronouns value={content.pronouns} />}
      </div>
      {details && (
        <div data-part="affiliations" className="flex flex-col items-center gap-2">
          <FineDivider />
          {headline && (
            <p className={cn("mt-2 text-base leading-snug text-(--card-text)", WRAP_ANYWHERE)}>{headline}</p>
          )}
          {organization && (
            <p
              data-part="affiliation"
              data-length={isLongAffiliation(organization) ? "long" : "short"}
              className={cn(
                "text-xs font-medium text-balance text-(--card-muted) uppercase",
                isLongAffiliation(organization) ? "tracking-[0.1em]" : "tracking-[0.2em]",
                WRAP_ANYWHERE,
              )}
            >
              {organization}
            </p>
          )}
          {location && <p className={cn("text-sm text-(--card-muted)", WRAP_ANYWHERE)}>{location}</p>}
          {position && <VerifiedPosition position={position} centered className="mt-1" />}
          {isAlumni && <AlumniTag centered />}
        </div>
      )}
    </header>
  );
}

/**
 * The top of the card: photo, name, pronouns, role, affiliations, the
 * verified position and an alumni marker, composed by the layout. Starter
 * cards get the name, school and position only.
 */
export function HeaderBlock({
  card,
  theme,
  avatarUrl,
  nameId,
  showAvatar,
}: {
  card: PublicCardData;
  theme: ResolvedTheme;
  avatarUrl: string | null;
  nameId: string;
  showAvatar: boolean;
}) {
  const layout = theme.layout;
  const spec = layoutSpec(layout);
  const starter = card.is_starter;
  const overlap = layout === "banner" || layout === "badge";

  const content: HeaderContent = {
    name: card.display_name,
    nameId,
    pronouns: starter ? null : card.pronouns,
    headline: starter ? null : card.headline,
    organization: card.organization,
    location: starter ? null : card.location,
    position: card.shpe?.position?.trim() || null,
    isAlumni: Boolean(card.shpe?.is_alumni) && !starter,
    classYear: card.education?.graduation_year ?? null,
    avatar: (className) =>
      showAvatar ? (
        <Avatar
          name={card.display_name}
          src={avatarUrl}
          shape={theme.avatar.shape}
          ring={theme.avatar.ring}
          overlap={overlap}
          ringStyle={spec.ring}
          initialsStyle={spec.initials}
          headingFont={spec.initialsInHeadingFont}
          className={className}
        />
      ) : null,
  };

  if (layout in NAME_SIZES) return <OriginalHeader content={content} layout={layout as keyof typeof NAME_SIZES} />;

  const professional = layout as keyof typeof NAME_SCALES;
  const step = nameLengthStep(card.display_name);
  const scale = NAME_SCALES[professional][step];
  const props: ProfessionalHeaderProps = { content, scale, nameLength: NAME_LENGTHS[step] };

  switch (professional) {
    case "profile":
      return <ProfileHeader {...props} />;
    case "editorial":
      return <EditorialHeader {...props} />;
    case "studio":
      return <StudioHeader {...props} />;
    case "layered":
      return <LayeredHeader {...props} />;
    case "letterhead":
      return <LetterheadHeader {...props} />;
    case "monogram":
      return <MonogramHeader {...props} />;
  }
}

import { BadgeCheck, MapPin } from "lucide-react";

import type { PublicCardData } from "@/types/database";
import type { CardLayout } from "../model";
import type { ResolvedTheme } from "../themes";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { WRAP_ANYWHERE } from "./styles";

const VERIFIED_LABEL = "Verified by chapter officers";

/**
 * "WashU SHPE · President ✔". The only line on a card that speaks for the
 * chapter, so it comes only from the officer-assigned position
 * (card.shpe.position, from chapter_positions). Nothing a member types, not
 * even a headline that says "President of SHPE", can produce it.
 */
function VerifiedPosition({ position, centered }: { position: string; centered: boolean }) {
  return (
    <p
      data-part="verified-position"
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold text-(--card-text)",
        centered && "justify-center",
      )}
    >
      <span className={WRAP_ANYWHERE}>WashU SHPE · {position}</span>
      <span title={VERIFIED_LABEL} className="inline-flex">
        <BadgeCheck role="img" aria-label={VERIFIED_LABEL} className="size-4 shrink-0 text-(--card-accent)" />
      </span>
    </p>
  );
}

const NAME_SIZES: Record<CardLayout, string> = {
  classic: "text-[1.875rem] leading-tight",
  banner: "text-[1.875rem] leading-tight",
  badge: "text-[2rem] leading-tight",
  split: "text-[1.625rem] leading-tight @3xl:text-[1.875rem]",
  minimal: "text-[2.5rem] leading-[1.05] tracking-tight",
};

/**
 * Photo, name, pronouns, the verified position line, headline, school and
 * location, and an alumni marker. Starter cards pass `starter` and get the name,
 * school and position only.
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
  const centered = layout === "classic" || layout === "banner" || layout === "badge";
  const overlap = layout === "banner" || layout === "badge";
  const starter = card.is_starter;
  const position = card.shpe?.position?.trim() || null;
  const pronouns = starter ? null : card.pronouns;
  const headline = starter ? null : card.headline;
  const location = starter ? null : card.location;
  const isAlumni = Boolean(card.shpe?.is_alumni) && !starter;

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
      {showAvatar && (
        <Avatar
          name={card.display_name}
          src={avatarUrl}
          shape={theme.avatar.shape}
          ring={theme.avatar.ring}
          overlap={overlap}
        />
      )}

      <div className={cn("flex min-w-0 flex-col gap-1.5", centered && "items-center")}>
        <div
          className={cn(
            "flex flex-wrap items-baseline gap-x-2 gap-y-0.5",
            centered && "justify-center",
          )}
        >
          <h1
            id={nameId}
            className={cn(
              NAME_SIZES[layout],
              WRAP_ANYWHERE,
              "[font-weight:var(--card-heading-weight)] text-(--card-text)",
            )}
          >
            {card.display_name}
          </h1>
          {pronouns && (
            <span className="text-sm text-(--card-muted)">
              <span className="sr-only">Pronouns: </span>
              {pronouns}
            </span>
          )}
        </div>

        {layout === "minimal" && (
          <span aria-hidden="true" className="my-1 block h-1 w-12 bg-(--card-accent)" />
        )}

        {position && <VerifiedPosition position={position} centered={centered} />}

        {headline && <p className={cn("text-base text-(--card-text)", WRAP_ANYWHERE)}>{headline}</p>}

        {card.organization && (
          <p className={cn("text-sm text-(--card-muted)", WRAP_ANYWHERE)}>{card.organization}</p>
        )}

        {location && (
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm text-(--card-muted)",
              centered && "justify-center",
            )}
          >
            <MapPin className="size-4 shrink-0" />
            <span className={WRAP_ANYWHERE}>{location}</span>
          </p>
        )}

        {isAlumni && (
          <p className={cn("flex pt-1", centered && "justify-center")}>
            <span
              data-part="alumni"
              className="rounded-(--card-button-radius) border border-(--card-rule) px-2.5 py-0.5 text-xs font-semibold tracking-[0.08em] text-(--card-text) uppercase"
            >
              Alumni
            </span>
          </p>
        )}
      </div>
    </header>
  );
}

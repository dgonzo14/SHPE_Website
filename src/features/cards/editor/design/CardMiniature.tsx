import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { CardButtonShape, CardButtonStyle } from "../../model";
import { initials } from "../../blocks/format";
import { themeCssVars, type ResolvedTheme } from "../../themes";

/**
 * A miniature of the card a theme draws, for the preset gallery: the real
 * page background, card colour, name font and main-button colour, laid out
 * the way the theme's layout composes the header and the way its arrangement
 * lays out links. Plain elements reading the same --card-* properties as the
 * card itself, so a miniature can't drift from the colours it stands for.
 * Decorative: the gallery button's label names the preset.
 */

const BUTTON_RADIUS: Record<CardButtonShape, string> = {
  pill: "rounded-full",
  rounded: "rounded-[3px]",
  square: "rounded-none",
};

/** A link button in the theme's style, at miniature size. */
const MINI_FILL: Record<CardButtonStyle, string> = {
  filled: "bg-(--card-accent)",
  outline: "border border-(--card-accent)",
  soft: "bg-(--card-soft)",
  glass: "border border-(--card-glass-border) bg-(--card-glass)",
  hairline: "border border-(--card-rule-strong)",
};

/** A line of text, drawn as a bar. */
function Line({ width, tone = "muted", className }: { width: string; tone?: "text" | "muted"; className?: string }) {
  return (
    <span
      className={cn(
        "block h-[3px] shrink-0 rounded-full",
        tone === "text" ? "bg-(--card-text) opacity-80" : "bg-(--card-muted) opacity-55",
        className,
      )}
      style={{ width }}
    />
  );
}

/** The member's name in the theme's name font, on one line or wrapping onto two. */
function Name({
  name,
  size,
  wrap = false,
  className,
}: {
  name: string;
  size: string;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block max-w-full leading-[1.1] text-(--card-text) [font-family:var(--card-font-heading)] [font-weight:var(--card-heading-weight)]",
        wrap ? "line-clamp-2" : "truncate",
        size,
        className,
      )}
    >
      {name}
    </span>
  );
}

/** The photo: a soft shape in the theme's photo shape. */
function Photo({ theme, size, className }: { theme: ResolvedTheme; size: string; className?: string }) {
  if (theme.avatar.shape === "hidden" || theme.layout === "minimal") return null;
  return (
    <span
      className={cn(
        "block shrink-0 rounded-(--card-avatar-radius) bg-[color-mix(in_srgb,var(--card-muted)_45%,var(--card-surface))]",
        theme.avatar.ring && "outline-1 outline-offset-1 outline-(--card-accent) outline-solid",
        size,
        className,
      )}
    />
  );
}

function Header({ theme, name }: { theme: ResolvedTheme; name: string }): ReactNode {
  switch (theme.layout) {
    case "classic":
      return (
        <span className="flex flex-col items-center gap-1">
          <Photo theme={theme} size="size-6" />
          <Name name={name} size="text-[0.625rem]" />
          <Line width="45%" />
        </span>
      );
    case "banner":
      return (
        <span className="flex flex-col items-center gap-1">
          <span className="-mx-2.5 -mt-2.5 block h-6 w-[calc(100%+1.25rem)] bg-(--card-accent) [background-image:var(--card-band)]" />
          <Photo theme={theme} size="-mt-4 size-6 border-2 border-(--card-surface)" />
          <Name name={name} size="text-[0.625rem]" />
          <Line width="45%" />
        </span>
      );
    case "badge":
      return (
        <span className="flex flex-col items-center gap-1">
          <span className="-mx-2.5 -mt-2.5 flex h-6 w-[calc(100%+1.25rem)] justify-center bg-(--card-accent) pt-1">
            <span className="block h-1 w-5 rounded-full bg-(--card-bg)" />
          </span>
          <Photo theme={theme} size="-mt-3 size-6" />
          <Name name={name} size="text-[0.625rem]" />
          <Line width="45%" />
        </span>
      );
    case "split":
      return (
        <span className="flex items-center gap-1.5">
          <Photo theme={theme} size="size-5" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <Name name={name} size="text-[0.5625rem]" />
            <Line width="70%" />
          </span>
        </span>
      );
    case "minimal":
      return (
        <span className="flex flex-col gap-1">
          <Name name={name} size="text-[0.8125rem]" />
          <span className="block h-[3px] w-4 bg-(--card-accent)" />
          <Line width="70%" />
        </span>
      );
    case "profile":
      return (
        <span className="flex flex-col gap-1.5">
          <span className="-mx-2.5 -mt-2.5 mb-0.5 block h-[2px] w-[calc(100%+1.25rem)] bg-(--card-accent)" />
          <span className="flex items-center gap-1.5">
            <Photo theme={theme} size="size-6" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <Name name={name} size="text-[0.5625rem]" />
              <Line width="80%" tone="text" />
              <Line width="55%" />
            </span>
          </span>
          <span className="block h-px w-full bg-(--card-rule)" />
        </span>
      );
    case "editorial":
      return (
        <span className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 border-b border-(--card-text) pb-1">
            <Line width="28%" tone="text" />
            <Line width="22%" className="ml-auto" />
          </span>
          <span className="flex items-start gap-1.5">
            <Name name={name} size="text-[0.875rem]" wrap className="flex-1" />
            <Photo theme={theme} size="size-5" />
          </span>
          <Line width="70%" tone="text" />
        </span>
      );
    case "studio":
      return (
        <span className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5">
            <Photo theme={theme} size="size-4" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Name name={name} size="text-[0.5625rem]" />
              <Line width="60%" />
            </span>
          </span>
          <span className="flex gap-1">
            <span className="block h-2 w-7 rounded-full border border-(--card-border)" />
            <span className="block h-2 w-5 rounded-full border border-(--card-border)" />
          </span>
        </span>
      );
    case "layered":
      return (
        <span className="flex flex-col items-center gap-1">
          <Photo theme={theme} size="size-6 shadow-[0_0_0_1px_var(--card-border)]" />
          <Name name={name} size="text-[0.625rem]" />
          <Line width="45%" />
          <span className="flex gap-1">
            <span className="block h-2 w-7 rounded-full border border-(--card-border) bg-(--card-raised)" />
            <span className="block h-2 w-5 rounded-full border border-(--card-border) bg-(--card-raised)" />
          </span>
        </span>
      );
    case "letterhead":
      return (
        <span className="flex flex-col items-center gap-1">
          <span className="block h-[3px] w-full border-y border-(--card-text)" />
          <Line width="55%" tone="text" className="mt-0.5 h-[2px]" />
          <Photo theme={theme} size="mt-0.5 size-6" />
          <Name name={name} size="text-[0.6875rem]" />
          <span className="flex w-8 items-center gap-0.5">
            <span className="h-px flex-1 bg-(--card-rule-strong)" />
            <span className="size-1 rotate-45 bg-(--card-accent)" />
            <span className="h-px flex-1 bg-(--card-rule-strong)" />
          </span>
        </span>
      );
    case "monogram":
      return (
        <span className="flex flex-col items-center gap-1">
          {theme.avatar.shape !== "hidden" && (
            <span className="flex size-6 items-center justify-center rounded-(--card-avatar-radius) border border-(--card-accent) text-[0.5rem] leading-none text-(--card-accent) [font-family:var(--card-font-heading)]">
              {initials(name)}
            </span>
          )}
          <Name name={name} size="text-[0.875rem]" />
          <span className="flex w-9 items-center gap-1">
            <span className="h-px flex-1 bg-(--card-rule-strong)" />
            <span className="size-0.5 rounded-full bg-(--card-accent)" />
            <span className="h-px flex-1 bg-(--card-rule-strong)" />
          </span>
        </span>
      );
  }
}

function Links({ theme }: { theme: ResolvedTheme }): ReactNode {
  const { style, arrangement, shape } = theme.buttons;
  const radius = BUTTON_RADIUS[shape];
  const panel = theme.layout === "layered";
  let links: ReactNode;
  switch (arrangement) {
    case "rows":
      links = (
        <span className="flex flex-col divide-y divide-(--card-rule)">
          {[78, 64, 70].map((w) => (
            <span key={w} className="flex items-center gap-1 py-1">
              {theme.buttons.icons && <span className="block size-1.5 shrink-0 rounded-full bg-(--card-accent)" />}
              <Line width={`${w}%`} tone="text" />
            </span>
          ))}
        </span>
      );
      break;
    case "compact":
      links = (
        <span className="grid grid-cols-2 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("block h-2.5", radius, MINI_FILL[style])} />
          ))}
        </span>
      );
      break;
    case "grouped":
      links = (
        <span className="flex flex-col gap-1">
          <Line width="25%" />
          <span className="grid grid-cols-2 gap-1">
            {[0, 1].map((i) => (
              <span
                key={i}
                className="flex h-4 items-center gap-0.5 rounded-[3px] border border-(--card-border) bg-(--card-surface) px-0.5"
              >
                <span className={cn("block size-2 shrink-0", radius, MINI_FILL[style])} />
                <Line width="55%" tone="text" />
              </span>
            ))}
          </span>
        </span>
      );
      break;
    case "icon-grid":
      links = (
        <span className="grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("block aspect-square", radius, MINI_FILL[style])} />
          ))}
        </span>
      );
      break;
    default:
      links = (
        <span className="flex flex-col gap-1">
          {[0, 1].map((i) => (
            <span key={i} className={cn("block h-2.5", radius, MINI_FILL[style])} />
          ))}
        </span>
      );
  }
  return panel ? (
    <span className="block rounded-[3px] border border-(--card-border) bg-(--card-raised) p-1">{links}</span>
  ) : (
    links
  );
}

export function CardMiniature({
  theme,
  name,
  className,
}: {
  theme: ResolvedTheme;
  /** Drawn in the theme's name font; a stand-in when the card has no name yet. */
  name?: string;
  className?: string;
}) {
  const label = name?.trim() || "Ana Rivera";
  const radius = BUTTON_RADIUS[theme.buttons.shape];
  const edged = theme.layout === "studio" || theme.layout === "layered";
  return (
    <span
      aria-hidden="true"
      data-miniature={theme.layout}
      style={themeCssVars(theme)}
      className={cn("flex h-36 w-full justify-center overflow-hidden px-4 pt-3.5", className)}
    >
      <span
        className={cn(
          "flex h-fit w-full max-w-[8.5rem] flex-col gap-2 overflow-hidden bg-(--card-surface-fill) p-2.5 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.45)]",
          theme.buttons.shape === "square" ? "rounded-none" : theme.buttons.shape === "pill" ? "rounded-xl" : "rounded-lg",
          edged && "border border-(--card-border)",
        )}
      >
        <Header theme={theme} name={label} />
        <span className="flex gap-1">
          <span className={cn("block h-3 flex-1 bg-(--card-primary)", radius)} />
          <span className={cn("block size-3 shrink-0 border border-(--card-rule)", radius)} />
        </span>
        <Links theme={theme} />
      </span>
    </span>
  );
}

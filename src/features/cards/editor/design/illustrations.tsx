import { EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  CardAvatarShape,
  CardButtonArrangement,
  CardButtonShape,
  CardButtonStyle,
  CardDensity,
  CardLayout,
  CardPattern,
  CardPrimaryFill,
} from "../../model";
import { themeCssVars, type ResolvedTheme } from "../../themes";
import { cardColorVars } from "./themeEdit";

/**
 * Small pictures for the Design tab's choices. All decorative (the option's
 * label carries the meaning), all drawn with SVG or CSS so nothing is fetched.
 * Where a picture shows colour it uses the member's own theme, so "Outline"
 * looks like their outline buttons, not a generic one.
 */

const SVG_CLASS = "h-12 w-16";

/** A stylised card for each layout: photo position, banner, columns. */
export function LayoutPicture({ layout }: { layout: CardLayout }) {
  const card = "fill-white stroke-shpe-navy/40";
  const ink = "fill-shpe-navy";
  const faint = "fill-shpe-navy/35";
  const photo = "fill-shpe-navy/60";
  const button = "fill-shpe-orange";

  switch (layout) {
    case "classic":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" className={card} />
          <circle cx="32" cy="11" r="5" className={photo} />
          <rect x="22" y="19" width="20" height="3" className={ink} />
          <rect x="25" y="24" width="14" height="2" className={faint} />
          <rect x="19" y="30" width="26" height="5" className={button} />
          <rect x="19" y="38" width="26" height="5" className={faint} />
        </svg>
      );
    case "banner":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" className={card} />
          <rect x="15" y="2" width="34" height="10" className="fill-shpe-orange/70" />
          <circle cx="32" cy="13" r="5" className={photo} stroke="white" strokeWidth="1.5" />
          <rect x="22" y="21" width="20" height="3" className={ink} />
          <rect x="25" y="26" width="14" height="2" className={faint} />
          <rect x="19" y="31" width="26" height="5" className={button} />
          <rect x="19" y="39" width="26" height="5" className={faint} />
        </svg>
      );
    case "split":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="2.5" y="5.5" width="59" height="37" className={card} />
          <circle cx="13" cy="15" r="5" className={photo} />
          <rect x="7" y="23" width="18" height="3" className={ink} />
          <rect x="7" y="28" width="13" height="2" className={faint} />
          <rect x="31" y="11" width="25" height="5" className={button} />
          <rect x="31" y="19" width="25" height="5" className={faint} />
          <rect x="31" y="27" width="25" height="5" className={faint} />
        </svg>
      );
    case "minimal":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" className={card} />
          <rect x="19" y="7" width="24" height="4" className={ink} />
          <rect x="19" y="14" width="17" height="2" className={faint} />
          <rect x="19" y="18" width="21" height="2" className={faint} />
          <rect x="19.5" y="27.5" width="25" height="5" className="fill-none stroke-shpe-navy" />
          <rect x="19.5" y="36.5" width="25" height="5" className="fill-none stroke-shpe-navy/50" />
        </svg>
      );
    case "badge":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" className={card} />
          <rect x="15" y="2" width="34" height="9" className="fill-shpe-navy/70" />
          <rect x="28" y="4.5" width="8" height="2.5" rx="1.25" className="fill-white" />
          <circle cx="32" cy="17" r="4.5" className={photo} />
          <rect x="22" y="24" width="20" height="3" className={ink} />
          <rect x="25" y="29" width="14" height="2" className={faint} />
          <rect x="19" y="34" width="26" height="4.5" className={button} />
          <rect x="19" y="40.5" width="26" height="4" className={faint} />
        </svg>
      );
    case "profile":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" className={card} />
          <rect x="15" y="2" width="34" height="1.5" className={button} />
          <rect x="18" y="6.5" width="9" height="9" rx="2" className={photo} />
          <rect x="29" y="7.5" width="16" height="3" className={ink} />
          <rect x="29" y="12" width="11" height="2" className={faint} />
          <rect x="18" y="18.5" width="28" height="0.75" className={faint} />
          <rect x="18" y="22" width="28" height="4.5" className={ink} />
          <rect x="18" y="30" width="28" height="0.75" className={faint} />
          <rect x="18" y="33" width="20" height="2" className={faint} />
          <rect x="18" y="38" width="28" height="0.75" className={faint} />
          <rect x="18" y="41" width="17" height="2" className={faint} />
        </svg>
      );
    case "editorial":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" className={card} />
          <rect x="18" y="5" width="28" height="0.75" className={ink} />
          <rect x="18" y="8.5" width="17" height="4" className={ink} />
          <rect x="18" y="14" width="13" height="4" className={ink} />
          <rect x="38" y="8.5" width="8" height="8" className={photo} />
          <rect x="18" y="21" width="22" height="2" className={faint} />
          <rect x="18" y="26.5" width="28" height="4.5" className={ink} />
          <rect x="18" y="35" width="28" height="0.75" className={faint} />
          <rect x="18" y="38" width="3" height="2" className={faint} />
          <rect x="23" y="38" width="15" height="2" className={ink} />
          <rect x="18" y="42.5" width="3" height="2" className={faint} />
          <rect x="23" y="42.5" width="12" height="2" className={ink} />
        </svg>
      );
    case "studio":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" rx="2" className={card} />
          <rect x="18" y="5" width="6" height="6" rx="1.5" className={photo} />
          <rect x="26" y="5.5" width="14" height="2.5" className={ink} />
          <rect x="26" y="9.5" width="10" height="1.5" className={faint} />
          <rect x="18" y="14" width="9" height="3" rx="1.5" className="fill-none stroke-shpe-navy/40" strokeWidth="0.75" />
          <rect x="29" y="14" width="7" height="3" rx="1.5" className="fill-none stroke-shpe-navy/40" strokeWidth="0.75" />
          <rect x="18" y="20" width="28" height="4.5" rx="1" className={button} />
          <rect x="18" y="28" width="8" height="1.5" className={faint} />
          <rect x="18.25" y="31.25" width="13.5" height="6.5" rx="1" className="fill-none stroke-shpe-navy/40" strokeWidth="0.75" />
          <rect x="33.25" y="31.25" width="13.5" height="6.5" rx="1" className="fill-none stroke-shpe-navy/40" strokeWidth="0.75" />
          <rect x="18.25" y="39.25" width="13.5" height="5.5" rx="1" className="fill-none stroke-shpe-navy/40" strokeWidth="0.75" />
        </svg>
      );
    case "layered":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" rx="2" className="fill-shpe-navy stroke-shpe-navy" />
          <circle cx="32" cy="9" r="4.5" className="fill-white/50" />
          <rect x="23" y="15.5" width="18" height="3" className="fill-white" />
          <rect x="26" y="20.5" width="12" height="2" className="fill-white/50" />
          <rect x="18" y="25" width="28" height="4.5" rx="1" className="fill-shpe-blue" />
          <rect x="18" y="32" width="28" height="12" rx="1.5" className="fill-white/15 stroke-white/30" strokeWidth="0.75" />
          <rect x="21" y="35" width="15" height="2" className="fill-white/70" />
          <rect x="21" y="39.5" width="12" height="2" className="fill-white/70" />
        </svg>
      );
    case "letterhead":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" className={card} />
          <rect x="18" y="4.5" width="28" height="0.75" className={ink} />
          <rect x="18" y="6.25" width="28" height="0.75" className={ink} />
          <rect x="24" y="9.5" width="16" height="1.5" className={ink} />
          <circle cx="32" cy="16.5" r="4" className={cn(photo, "stroke-shpe-orange")} strokeWidth="0.75" />
          <rect x="23" y="23" width="18" height="3" className={ink} />
          <rect x="29" y="28.5" width="2" height="2" transform="rotate(45 30 29.5)" className="fill-shpe-orange" />
          <rect x="18" y="33" width="28" height="4.5" className={ink} />
          <rect x="18.25" y="39.75" width="13.25" height="4" className="fill-none stroke-shpe-navy/50" strokeWidth="0.5" />
          <rect x="32.5" y="39.75" width="13.25" height="4" className="fill-none stroke-shpe-navy/50" strokeWidth="0.5" />
        </svg>
      );
    case "monogram":
      return (
        <svg viewBox="0 0 64 48" className={SVG_CLASS}>
          <rect x="14.5" y="1.5" width="35" height="45" className={card} />
          <circle cx="32" cy="9.5" r="5" className="fill-none stroke-shpe-navy" strokeWidth="0.75" />
          <rect x="22" y="18" width="20" height="4" className={ink} />
          <rect x="24" y="25" width="6" height="0.5" className={faint} />
          <circle cx="32" cy="25.25" r="0.75" className="fill-shpe-orange" />
          <rect x="34" y="25" width="6" height="0.5" className={faint} />
          <rect x="18" y="29.5" width="28" height="4.5" rx="2.25" className={button} />
          <rect x="18" y="37" width="28" height="0.5" className={faint} />
          <rect x="18" y="39.5" width="16" height="2" className={ink} />
          <rect x="18" y="44" width="28" height="0.5" className={faint} />
        </svg>
      );
  }
}

const SHAPE_RADIUS: Record<CardButtonShape, string> = {
  pill: "rounded-full",
  rounded: "rounded-md",
  square: "rounded-none",
};

export function ButtonShapePicture({ shape }: { shape: CardButtonShape }) {
  return <span className={cn("block h-7 w-20 bg-shpe-navy", SHAPE_RADIUS[shape])} />;
}

/** A sample button in the member's own colours, on their card colour. */
export function ButtonStylePicture({
  style,
  theme,
}: {
  style: CardButtonStyle;
  theme: ResolvedTheme;
}) {
  const look: Record<CardButtonStyle, string> = {
    filled: "border-2 bg-(--card-accent) text-(--card-accent-text) border-(--card-accent)",
    outline: "border-2 bg-transparent text-(--card-accent) border-(--card-accent)",
    soft: "border-2 bg-(--card-soft) text-(--card-accent) border-transparent",
    glass: "border-2 bg-(--card-glass) text-(--card-accent) border-(--card-glass-border)",
    hairline: "border bg-transparent text-(--card-text) border-(--card-rule-strong)",
  };
  return (
    <span
      style={cardColorVars(theme)}
      className="flex h-12 w-full items-center justify-center bg-(--card-surface) px-2"
    >
      <span
        className={cn(
          "flex h-7 w-full max-w-24 items-center justify-center text-xs font-semibold",
          SHAPE_RADIUS[theme.buttons.shape],
          look[style],
        )}
      >
        Link
      </span>
    </span>
  );
}

export function ArrangementPicture({ arrangement }: { arrangement: CardButtonArrangement }) {
  switch (arrangement) {
    case "list":
      return (
        <span className="flex w-16 flex-col gap-1">
          <span className="block h-2.5 bg-shpe-navy" />
          <span className="block h-2.5 bg-shpe-navy/50" />
          <span className="block h-2.5 bg-shpe-navy/50" />
        </span>
      );
    case "icon-grid":
      return (
        <span className="grid w-16 grid-cols-3 gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={cn("block h-4", i === 0 ? "bg-shpe-navy" : "bg-shpe-navy/50")} />
          ))}
        </span>
      );
    case "rows":
      return (
        <span className="flex w-16 flex-col divide-y divide-shpe-navy/30 border-y border-shpe-navy/30">
          {[70, 55, 62].map((width) => (
            <span key={width} className="flex items-center gap-1 py-1">
              <span className="block size-1.5 shrink-0 rounded-full bg-shpe-orange" />
              <span className="block h-1 bg-shpe-navy" style={{ width: `${width}%` }} />
            </span>
          ))}
        </span>
      );
    case "compact":
      return (
        <span className="grid w-16 grid-cols-2 gap-1">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="block h-3 border border-shpe-navy/60" />
          ))}
        </span>
      );
    case "grouped":
      return (
        <span className="flex w-16 flex-col gap-1">
          <span className="block h-1 w-5 bg-shpe-navy/50" />
          <span className="grid grid-cols-2 gap-1">
            <span className="block h-3.5 rounded-sm border border-shpe-navy/50" />
            <span className="block h-3.5 rounded-sm border border-shpe-navy/50" />
          </span>
          <span className="block h-1 w-7 bg-shpe-navy/50" />
          <span className="grid grid-cols-2 gap-1">
            <span className="block h-3.5 rounded-sm border border-shpe-navy/50" />
          </span>
        </span>
      );
  }
}

/** Add to Contacts in the member's own accent, or in their text colour. */
export function PrimaryFillPicture({ fill, theme }: { fill: CardPrimaryFill; theme: ResolvedTheme }) {
  return (
    <span
      style={cardColorVars({ ...theme, buttons: { ...theme.buttons, primary: fill } })}
      className="flex h-12 w-full items-center justify-center bg-(--card-surface) px-2"
    >
      <span
        className={cn(
          "flex h-7 w-full max-w-28 items-center justify-center text-xs font-semibold",
          "bg-(--card-primary) text-(--card-primary-text)",
          SHAPE_RADIUS[theme.buttons.shape],
        )}
      >
        Add to Contacts
      </span>
    </span>
  );
}

const AVATAR_RADIUS: Record<Exclude<CardAvatarShape, "hidden">, string> = {
  circle: "rounded-full",
  rounded: "rounded-[24%]",
  square: "rounded-none",
};

export function AvatarShapePicture({ shape }: { shape: CardAvatarShape }) {
  if (shape === "hidden") {
    return (
      <span className="flex size-10 items-center justify-center border-2 border-dashed border-shpe-navy/40">
        <EyeOff className="size-4 text-shpe-navy/60" />
      </span>
    );
  }
  return <span className={cn("block size-10 bg-shpe-navy/60", AVATAR_RADIUS[shape])} />;
}

export function DensityPicture({ density }: { density: CardDensity }) {
  const gap = density === "compact" ? "gap-0.5" : density === "spacious" ? "gap-3" : "gap-2";
  return (
    <span className={cn("flex w-16 flex-col", gap)}>
      <span className="block h-2 bg-shpe-navy" />
      <span className="block h-2 bg-shpe-navy/50" />
      <span className="block h-2 bg-shpe-navy/50" />
    </span>
  );
}

/** The real pattern, drawn by the renderer's own CSS, over the member's page colour. */
export function PatternSwatch({ theme, pattern }: { theme: ResolvedTheme; pattern: CardPattern }) {
  const style = themeCssVars({ ...theme, background: { ...theme.background, type: "pattern", pattern } });
  return <span style={style} className="block h-12 w-full border border-shpe-rule" />;
}

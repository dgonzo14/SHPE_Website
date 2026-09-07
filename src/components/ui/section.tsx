import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Layout primitives for the public site.
 *
 * The member portal is built on a Swiss/International system: radius 0, no
 * shadows, hierarchy carried by size and rule-weight rather than colour. That
 * is the right register for schedules and rosters, which is what the portal is.
 *
 * The public site has a different job — it recruits — and the recipe behind the
 * portal warns in as many words that a strict Helvetica grid "reads as
 * institutional / cold" when a brand needs warmth. So this shares the system's
 * atoms (zero radius, hairline rules, the type scale, uppercase eyebrows, the
 * button language, focus treatment) while allowing the public pages a larger
 * typographic scale and full-bleed photography. That is still Swiss: it is the
 * poster register rather than the timetable register, and it means both halves
 * of the product are recognisably the same system without pretending they have
 * the same purpose.
 *
 * The constraint that shapes all of this: the SHPE palette is fixed and
 * contrast-limited. Orange #E84E1B on white is 3.79:1 and fails AA for body
 * text; navy #1B365D is 12.12:1. Colour therefore cannot carry hierarchy, which
 * is precisely why size and rules do.
 */

type SectionTone = "plain" | "soft" | "navy";

const TONES: Record<SectionTone, string> = {
  plain: "bg-white",
  // A flat tint, not a gradient. Alternating tones are what separate sections
  // here — there are no shadows to do that job.
  soft: "bg-shpe-navy-soft",
  navy: "bg-shpe-navy text-white",
};

const SPACING = {
  // Baseline rhythm. Generous but not arbitrary: each step is a multiple of the
  // 8px grid the portal already uses.
  sm: "py-10 sm:py-12",
  md: "py-14 sm:py-16 lg:py-20",
  lg: "py-16 sm:py-20 lg:py-28",
} as const;

export function Section({
  tone = "plain",
  space = "md",
  bleed = false,
  className,
  children,
  ref,
  ...props
}: HTMLAttributes<HTMLElement> & {
  tone?: SectionTone;
  space?: keyof typeof SPACING;
  /** Skip the inner container when the child manages its own width. */
  bleed?: boolean;
  /**
   * Forwarded so callers can observe the section. The Instagram feed on
   * /members only loads its third-party script once the section scrolls into
   * view, which needs a node to watch. React 19 passes ref as an ordinary
   * prop, so no forwardRef wrapper is required.
   */
  ref?: React.Ref<HTMLElement>;
}) {
  return (
    <section ref={ref} className={cn(TONES[tone], SPACING[space], className)} {...props}>
      {bleed ? children : <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">{children}</div>}
    </section>
  );
}

/**
 * Section heading, matching the portal's PageHeader in scale and structure.
 *
 * The eyebrow is the one piece of pure Vignelli borrowed wholesale: a short
 * uppercase label with wide tracking, sitting above an oversized title. It is
 * how the portal labels every table and card, so reusing it here is most of
 * what makes the two halves feel like one product.
 *
 * Left-aligned by default. Swiss sets body copy ranged left in a single
 * readable measure and never centres it; the old public pages centred 24
 * separate blocks, which is what made them read as a template rather than a
 * designed page.
 */
export function SectionHeader({
  eyebrow,
  title,
  lede,
  align = "start",
  as = "h2",
  id,
  className,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "start" | "center";
  /**
   * Heading level. Defaults to h2 because most uses are sections, but a page
   * needs exactly one h1 and this component renders the page title on four of
   * them — leaving it as h2 silently removed the h1 from /members, /leadership,
   * /sponsorship and /get-plugged-in, which a screen reader user navigating by
   * heading would experience as the page having no title at all.
   */
  as?: "h1" | "h2";
  id?: string;
  className?: string;
  actions?: ReactNode;
}) {
  const centered = align === "center";
  const Heading = as;
  return (
    <div
      className={cn(
        "mb-8 sm:mb-10",
        centered && "mx-auto max-w-3xl text-center",
        actions && !centered && "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          /*
            orange-darker (#A33410), not orange-dark (#C43E12). The eyebrow sits
            on white in some sections and on the navy-soft tint in others;
            measured on the tint, #C43E12 lands at 4.38:1 against a 4.5
            requirement. #A33410 clears it on both grounds, so one token works
            everywhere rather than the label silently failing on alternate
            sections.
          */
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-shpe-orange-darker">
            {eyebrow}
          </p>
        )}
        <Heading
          id={id}
          className="text-[1.75rem] font-bold leading-[1.1] tracking-tight text-shpe-navy sm:text-[2.25rem] lg:text-[2.75rem]"
        >
          {title}
        </Heading>
        {lede && (
          <p
            className={cn(
              "mt-4 max-w-[65ch] text-base leading-relaxed text-gray-700 sm:text-lg",
              centered && "mx-auto",
            )}
          >
            {lede}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/** Body copy held to a readable measure. Swiss sets one column, ranged left. */
export function Prose({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("max-w-[65ch] text-base leading-relaxed text-gray-700 sm:text-lg", className)}
      {...props}
    />
  );
}

/**
 * A hairline rule used as a structural divider.
 *
 * This is the shadow replacement. The old public pages leaned on 26 separate
 * `shadow-lg` declarations to separate content; the portal separates it with
 * 1px of navy at 16% opacity, and so does this.
 */
export function Rule({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn("border-0 border-t border-shpe-rule", className)} {...props} />;
}

/**
 * A titled statement block — mission, vision, and anything else that is one
 * heading over one paragraph.
 *
 * Mission and Vision were byte-for-byte the same card with different props
 * inlined into each file, which is how they drifted: both carried a 2px accent
 * border, but one was light blue and one was orange, so the pair read as two
 * unrelated widgets sitting side by side.
 *
 * The accent survives as a short bar rather than a full border. Colour still
 * distinguishes the two blocks, but it is no longer load-bearing — the heading
 * says "Our Mission" whether or not the bar renders, which matters because
 * SHPE's light blue is 2.97:1 on white and cannot be relied on to communicate
 * anything on its own.
 */
export function StatementCard({
  icon: Icon,
  title,
  id,
  accent = "orange",
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  id?: string;
  accent?: "orange" | "blue";
  children: ReactNode;
}) {
  return (
    <article className="flex h-full min-w-0 flex-col border border-shpe-rule bg-white p-6 sm:p-8">
      <div
        className={cn(
          "mb-6 h-1 w-12",
          accent === "orange" ? "bg-shpe-orange" : "bg-shpe-blue",
        )}
        aria-hidden="true"
      />
      <div className="mb-4 flex items-center gap-3">
        <Icon className="h-6 w-6 shrink-0 text-shpe-navy" aria-hidden />
        <h2 id={id} className="text-xl font-bold tracking-tight text-shpe-navy sm:text-2xl">
          {title}
        </h2>
      </div>
      <p className="max-w-[60ch] text-base leading-relaxed text-gray-700">{children}</p>
    </article>
  );
}

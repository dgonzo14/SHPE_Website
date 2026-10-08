import { BadgeCheck } from "lucide-react";

import type { PublicCardData } from "@/types/database";
import { cn } from "@/lib/utils";
import { useLayoutSpec } from "../layouts";
import { Section } from "./Section";
import { degreeLabel, formatMonthYear, shortClassYear } from "./format";
import { WRAP_ANYWHERE } from "./styles";

/*
 * The text blocks under the header. Each one renders nothing when it has
 * nothing to say, so an empty block and a hidden one look the same. All text
 * is React text: a bio containing "<b>" shows those three characters, never
 * bold.
 */

/**
 * "Currently": the member's status line, e.g. "Seeking Summer 2027
 * internships". Boxed in most layouts; plain where the block already sits on a
 * panel or the design wants no edges; a pull quote in the name font in
 * Editorial.
 */
export function StatusBlock({ text, centered }: { text: string | null; centered: boolean }) {
  const { status } = useLayoutSpec();
  const value = text?.trim();
  if (!value) return null;
  if (status === "quote") {
    return (
      <Section id="status" title="Currently">
        <p
          data-part="status-quote"
          className={cn(
            "border-l-2 border-(--card-text) pl-4 text-[1.375rem] leading-snug text-pretty text-(--card-text)",
            WRAP_ANYWHERE,
          )}
        >
          {/* On a span: BusinessCard sets every <p> in the text font, which a class on the <p> can't outrank. */}
          <span className="[font-family:var(--card-font-heading)]">{value}</span>
        </p>
      </Section>
    );
  }
  return (
    <Section id="status" title="Currently">
      {/* The dot is inline so it stays with the first word however the line is aligned. */}
      <p
        className={cn(
          // Balanced lines suit the narrow box; unboxed text runs the full
          // width, where balancing would leave short, ragged lines.
          status === "box"
            ? "rounded-(--card-button-radius) border border-(--card-rule) px-4 py-3 text-balance"
            : "text-pretty",
          "text-base text-(--card-text)",
          WRAP_ANYWHERE,
          centered && "text-center",
        )}
      >
        <span
          aria-hidden="true"
          className="mr-2.5 inline-block size-2 rounded-full bg-(--card-accent) align-[0.12em]"
        />
        {value}
      </p>
    </Section>
  );
}

/** The bio. Line breaks the member typed are kept; nothing else is interpreted. */
export function AboutBlock({ bio }: { bio: string | null }) {
  const value = bio?.trim();
  if (!value) return null;
  return (
    <Section id="about" title="About">
      <p className={cn("text-base leading-relaxed whitespace-pre-line text-(--card-text)", WRAP_ANYWHERE)}>
        {value}
      </p>
    </Section>
  );
}

/**
 * Major and class year ("Computer Science ’27"), a second major, and the
 * degree. Read live from the profile; the database (or the editor's preview
 * model) has already dropped anything the member chose not to show.
 */
export function EducationBlock({ education }: { education: PublicCardData["education"] }) {
  if (!education) return null;
  const { major, secondary_major: secondary, graduation_year: year, degree_level: degree } = education;
  if (!major && !secondary && !year) return null;

  const main = major
    ? [major, year ? shortClassYear(year) : null].filter(Boolean).join(" ")
    : year
      ? `Class of ${year}`
      : null;
  const details = [secondary ? `Second major: ${secondary}` : null, degreeLabel(degree)].filter(
    (part): part is string => Boolean(part),
  );

  return (
    <Section id="education" title="Education">
      {main && <p className={cn("text-base font-semibold text-(--card-text)", WRAP_ANYWHERE)}>{main}</p>}
      {details.map((detail) => (
        <p key={detail} className={cn("text-sm text-(--card-muted)", WRAP_ANYWHERE)}>
          {detail}
        </p>
      ))}
    </Section>
  );
}

/**
 * Chapter facts: member since, and the National membership badge, which only
 * appears when an officer has verified it. The officer-assigned position is
 * already in the header, so it isn't repeated here.
 */
export function ShpeBlock({ shpe, centered }: { shpe: PublicCardData["shpe"]; centered: boolean }) {
  const since = formatMonthYear(shpe?.member_since);
  const national = Boolean(shpe?.national_member_verified);
  if (!since && !national) return null;
  return (
    <Section id="shpe" title="SHPE">
      {since && <p className="text-base text-(--card-text)">Member since {since}</p>}
      {national && (
        <p
          data-part="national-member"
          className={cn(
            "flex items-center gap-1.5 text-base font-semibold text-(--card-text)",
            centered && "justify-center",
          )}
        >
          <BadgeCheck className="size-5 shrink-0 text-(--card-accent)" />
          <span>
            SHPE National member
            <span className="sr-only">, verified by chapter officers</span>
          </span>
        </p>
      )}
    </Section>
  );
}

/** Skills or languages, as tags in the member's order. */
export function TagsBlock({
  id,
  title,
  items,
  centered,
}: {
  id: "skills" | "languages";
  title: string;
  items: string[];
  centered: boolean;
}) {
  const tags = items.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  if (tags.length === 0) return null;
  return (
    <Section id={id} title={title}>
      <ul role="list" className={cn("flex flex-wrap gap-2", centered && "justify-center")}>
        {tags.map((tag, index) => (
          <li
            key={`${tag}-${index}`}
            className={cn(
              "rounded-(--card-button-radius) border border-(--card-rule) px-3 py-1 text-sm text-(--card-text)",
              WRAP_ANYWHERE,
            )}
          >
            {tag}
          </li>
        ))}
      </ul>
    </Section>
  );
}

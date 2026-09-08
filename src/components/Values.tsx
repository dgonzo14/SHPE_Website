import { Heart, HandHelping, GraduationCap, Shield } from "lucide-react";

import { Section, SectionHeader } from "@/components/ui/section";

const VALUES = [
  {
    icon: Heart,
    title: "Familia",
    description: "We build strong communities and support one another as family",
  },
  {
    icon: HandHelping,
    title: "Service",
    description: "We are committed to serving our community and making a positive impact",
  },
  {
    icon: GraduationCap,
    title: "Education",
    description: "We value learning, growth, and the pursuit of knowledge",
  },
  {
    icon: Shield,
    title: "Resilience",
    description: "We persevere through challenges and emerge stronger together",
  },
] as const;

/**
 * The four chapter values.
 *
 * Previously four cards each with a 2px border in a different colour, a tinted
 * icon chip, and a shadow that grew on hover. Three separate systems doing the
 * same job, and the colours were decorative — nothing distinguished Familia
 * from Service except hue, which is invisible to anyone who cannot separate
 * #E84E1B from #5B9BD5.
 *
 * Now the ordinal carries it. An oversized number at the top-left of each block
 * is the Vignelli move for exactly this situation: it gives four equal items a
 * reading order without inventing four meanings for four colours. The numbers
 * are tabular so they align on the baseline grid across the row.
 */
export function Values() {
  return (
    <Section tone="soft" space="lg" aria-labelledby="values-heading">
      <SectionHeader
        eyebrow="What we stand for"
        title="Our Values"
        id="values-heading"
        lede="Four commitments that shape how the chapter runs, who we make room for, and what we ask of each other."
      />

      <ul className="grid grid-cols-1 gap-px border border-shpe-rule bg-shpe-rule sm:grid-cols-2 lg:grid-cols-4">
        {VALUES.map((value, index) => (
          <li key={value.title} className="min-w-0 bg-white">
            {/*
              The 1px gaps come from `gap-px` over a ruled background, so the
              grid itself draws the dividing lines. It means one continuous
              rule across the row instead of four cards each with their own
              border doubling up at the seams.
            */}
            <article className="flex h-full flex-col p-6 lg:p-7">
              <div className="mb-5 flex items-baseline justify-between gap-3">
                <span
                  className="text-[2.5rem] font-bold leading-none tabular-nums text-shpe-navy/20"
                  aria-hidden="true"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <value.icon className="h-6 w-6 shrink-0 text-shpe-orange-dark" aria-hidden />
              </div>
              <h3 className="text-lg font-bold tracking-tight text-shpe-navy sm:text-xl">
                {value.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-700 sm:text-base">
                {value.description}
              </p>
            </article>
          </li>
        ))}
      </ul>
    </Section>
  );
}

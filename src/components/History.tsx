import { FileText, ExternalLink } from "lucide-react";

import { Section, SectionHeader } from "@/components/ui/section";
import { LinkButton } from "@/components/ui/button";
import { OptimizedPicture } from "./OptimizedPicture";
import { assetUrl } from "../lib/assets";
import con2023Webp from "/images/con2023.webp";
import con2023 from "/images/con2023.jpg";

/**
 * Chapter history, and the two governing documents.
 *
 * The document links were hand-rolled anchors with inline background colours,
 * `hover:scale-105`, a shadow, and — the part that mattered —
 * `focus-visible:outline-white` on a white page, which made the focus ring
 * invisible for anyone tabbing to them. They use the shared LinkButton now, so
 * they inherit the navy 3px focus ring the rest of the product uses and the
 * 44px minimum target the portal already guarantees.
 *
 * The prose is unchanged apart from being split at the paragraph break it
 * always implied: founding, dormancy, revival.
 */
export function History() {
  return (
    <Section tone="soft" space="lg" aria-labelledby="history-heading">
      <SectionHeader
        eyebrow="Since 2016"
        title="Our History"
        id="history-heading"
        lede="Founded, paused by a pandemic, and rebuilt by the students who refused to let it lapse."
      />

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="h-64 overflow-hidden border border-shpe-rule sm:h-80 lg:h-[26rem]">
          <OptimizedPicture
            webp={con2023Webp}
            fallback={con2023}
            alt="WashU SHPE members at the 2023 SHPE National Convention"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>

        <div className="min-w-0">
          <p className="max-w-[62ch] text-base leading-relaxed text-gray-700 sm:text-lg">
            WashU SHPE was founded in Fall 2016 by Dylan Zubata and Michael Pichardo to support
            Hispanic students in STEM and build a strong community at WashU.
          </p>
          <p className="mt-5 max-w-[62ch] text-base leading-relaxed text-gray-700 sm:text-lg">
            After becoming inactive during the COVID-19 pandemic, the chapter was reestablished in
            October 2022 through the leadership of Nicole Lucas, who led the effort to re-register
            with both SHPE National and the university. Today, WashU SHPE continues to grow,
            grounded in resilience, familia, service, and professional development.
          </p>

          <div className="mt-8">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-gray-600">
              Chapter documents
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <LinkButton
                to={assetUrl("SHPE-Student-Chapter-Bylaws.pdf")}
                external
                variant="subtle"
                aria-label="View SHPE Bylaws (opens in a new tab)"
              >
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                View Bylaws
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </LinkButton>
              <LinkButton
                to={assetUrl("SHPE_Constitution.docx")}
                external
                variant="subtle"
                aria-label="View SHPE Constitution (opens in a new tab)"
              >
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                View Constitution
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </LinkButton>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

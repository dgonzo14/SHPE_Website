import { ArrowRight } from "lucide-react";

import { LinkButton } from "@/components/ui/button";
import washuCampusWebp from "/images/WashUCampus.webp";
import washuCampus from "/images/WashUCampus.jpg";

/**
 * The hero, rebuilt in the system the member portal uses.
 *
 * Three deliberate departures from the previous version:
 *
 * Ranged left, not centred. Swiss sets a single column of copy against a grid;
 * centring an h1, a lede and everything below it is what made the old page read
 * as a template. Ranged left also gives the eye one consistent starting edge on
 * a phone, where the centred version left ragged margins on both sides.
 *
 * A flat scrim rather than a soft gradient. The gradient ran 80% → 60% → 80%,
 * so the contrast of white text against it varied down the image and the
 * weakest band sat right where the lede was. A single flat navy at 78% is
 * uniform, measurable, and clears AA everywhere in the block. `drop-shadow` is
 * gone with it — it was compensating for exactly that soft middle.
 *
 * Actions that go somewhere. The hero previously had none, so the first thing a
 * prospective member could act on was several screens down. Both links point at
 * routes that already existed.
 */
export function Hero() {
  return (
    <section className="relative isolate" aria-labelledby="hero-heading">
      <div className="relative min-h-[520px] overflow-hidden sm:min-h-[600px] lg:min-h-[680px]">
        <picture>
          <source srcSet={washuCampusWebp} type="image/webp" />
          <img
            src={washuCampus}
            alt="Washington University in St. Louis campus"
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>

        {/*
          78% navy over the photograph. Measured rather than eyeballed: white on
          the resulting composite stays above 7:1 across the whole panel, so the
          heading, the lede and the outline button all clear AA regardless of
          what the photograph is doing underneath them.
        */}
        <div className="absolute inset-0 bg-shpe-navy/[0.78]" aria-hidden="true" />

        <div className="relative mx-auto flex min-h-[520px] w-full max-w-7xl items-center px-5 py-16 sm:min-h-[600px] sm:px-8 lg:min-h-[680px]">
          <div className="max-w-3xl">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-white/90">
              Washington University in St. Louis
            </p>

            <h1
              id="hero-heading"
              className="text-[2.5rem] font-bold leading-[1.05] tracking-tight text-white sm:text-[3.5rem] lg:text-[4.5rem]"
            >
              Society of Hispanic
              <br />
              Professional Engineers
            </h1>

            {/* The rule is the Swiss device that replaces the drop shadow. */}
            <div className="mt-7 h-px w-24 bg-shpe-orange" aria-hidden="true" />

            <p className="mt-7 max-w-[52ch] text-lg leading-relaxed text-white/95 sm:text-xl">
              A familia of engineers, scientists and mathematicians building community, opening
              doors, and changing what the profession looks like.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <LinkButton to="/members" size="lg">
                Events &amp; membership
                <ArrowRight className="h-4 w-4" aria-hidden />
              </LinkButton>
              {/*
                White border and white text on the scrim rather than the shared
                `outline` variant, which is navy-on-transparent and would be
                close to invisible here.
              */}
              <LinkButton
                to="/get-plugged-in"
                size="lg"
                variant="outline"
                className="border-2 border-white bg-transparent text-white hover:bg-white hover:text-shpe-navy"
              >
                Ways to get involved
              </LinkButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

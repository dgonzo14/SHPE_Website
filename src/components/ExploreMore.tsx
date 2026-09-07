import { Heart, Users, Calendar, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { Section, SectionHeader } from "@/components/ui/section";
import { OptimizedPicture } from "./OptimizedPicture";
import actFairWebp from "/images/actFair.webp";
import actFair from "/images/actFair.png";
import ndcWebp from "/images/NDC.webp";
import ndc from "/images/NDC.png";

const ACTIONS = [
  {
    icon: Heart,
    title: "Donate",
    description: "Support our mission and help empower the Hispanic community in STEM",
    path: "/sponsorship",
  },
  {
    icon: Users,
    title: "Become a Member",
    description: "Join our familia and be part of a supportive community",
    path: "/get-plugged-in",
  },
  {
    icon: Calendar,
    title: "View Events",
    description: "Check out our upcoming workshops, socials, and networking events",
    path: "/members",
  },
] as const;

/**
 * The three ways in, plus two photographs of the chapter doing the thing.
 *
 * Two behavioural fixes came with the restyle, both of which were bugs rather
 * than taste:
 *
 * These were `<button onClick={navigate}>`. They navigate, so they are links —
 * and being buttons meant no middle-click, no cmd-click, no "open in new tab",
 * no status-bar preview, and nothing for a screen reader to announce as a
 * destination. They are `<Link>` now; every path is unchanged.
 *
 * Hover was four inline handlers writing `style.backgroundColor` on enter,
 * leave, focus and blur. That is CSS reimplemented in JavaScript, and it broke
 * on touch, where there is no leave event to restore the colour. It is a
 * `hover:` class now.
 */
export function ExploreMore() {
  return (
    <Section space="lg" aria-labelledby="explore-heading">
      <SectionHeader
        eyebrow="Get involved"
        title="Explore More"
        id="explore-heading"
        lede="Whether you are looking for a community, a career step, or a way to give back — there is a door in."
      />

      <div className="mb-10 grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2">
        {/*
          Presentational. The alt text stays for anyone browsing with images
          off, but these carry no information the surrounding copy does not.
        */}
        <div className="h-64 overflow-hidden border border-shpe-rule sm:h-80">
          <OptimizedPicture
            webp={actFairWebp}
            fallback={actFair}
            alt="Students at the Washington University activities fair"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
        <div className="h-64 overflow-hidden border border-shpe-rule sm:h-80">
          <OptimizedPicture
            webp={ndcWebp}
            fallback={ndc}
            alt="WashU SHPE members running Noche de Ciencias"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-px border border-shpe-rule bg-shpe-rule md:grid-cols-3">
        {ACTIONS.map((action) => (
          <li key={action.title} className="min-w-0 bg-white">
            <Link
              to={action.path}
              className="group flex h-full flex-col p-6 no-link-style transition-colors hover:bg-shpe-navy-soft focus-visible:outline-[3px] focus-visible:-outline-offset-2 focus-visible:outline-shpe-navy sm:p-7"
            >
              <action.icon className="mb-5 h-7 w-7 shrink-0 text-shpe-orange-dark" aria-hidden />
              <h3 className="text-lg font-bold tracking-tight text-shpe-navy sm:text-xl">
                {action.title}
              </h3>
              <p className="mt-2 flex-grow text-sm leading-relaxed text-gray-700 sm:text-base">
                {action.description}
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-shpe-navy">
                {action.title === "Donate" ? "Ways to give" : "Learn more"}
                {/* Moves only on hover, and only 2px — signage rotating into place. */}
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

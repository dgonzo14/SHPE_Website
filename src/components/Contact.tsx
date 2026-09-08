import { Mail, Instagram, Linkedin, Link2 } from "lucide-react";
import { Link } from "react-router-dom";

import { BrandMark } from "@/components/shared/BrandMark";

const SOCIAL_LINKS = [
  {
    icon: Instagram,
    name: "Instagram",
    url: "https://www.instagram.com/washushpe/",
  },
  {
    icon: Linkedin,
    name: "LinkedIn",
    url: "https://www.linkedin.com/company/washu-society-of-hispanic-professional-engineers/posts/?feedView=all",
  },
  {
    icon: Link2,
    name: "Linktree",
    url: "https://linktr.ee/shpewashu?utm_source=linktree_profile_share&ltsid=7314bf18-c8bf-4ad2-bd9d-dc8bd91709cc",
  },
] as const;

const SITE_LINKS = [
  { label: "Members & Events", to: "/members" },
  { label: "Get Plugged In", to: "/get-plugged-in" },
  { label: "Leadership", to: "/leadership" },
  { label: "Sponsorship", to: "/sponsorship" },
] as const;

/**
 * Site footer.
 *
 * Previously three centred blocks: a heading, one orange button, and a row of
 * coloured circles. It carried no navigation, so the bottom of every page was
 * a dead end.
 *
 * Now it does the job a footer does — a second route to everything in the nav,
 * plus contact and social — laid out on the same ruled grid as the rest of the
 * site. Every destination already existed; none are new.
 *
 * The social icons were coloured circles: a blue Instagram, a red LinkedIn
 * (#E42217, which is not a LinkedIn colour), and a blue Linktree. Icon plus
 * visible name now, because a coloured circle is not a label and the colours
 * were wrong anyway.
 */
export function Contact() {
  return (
    <footer className="bg-shpe-navy text-white" role="contentinfo">
      <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div className="lg:col-span-2">
            <BrandMark className="h-8 brightness-0 invert" alt="WashU SHPE" />
            <p className="mt-5 max-w-[45ch] text-sm leading-relaxed text-white/80">
              The Society of Hispanic Professional Engineers at Washington University in St. Louis.
              Empowering the Hispanic community in STEM through mentorship, professional
              development, and service.
            </p>
          </div>

          <nav aria-labelledby="footer-explore">
            <h2
              id="footer-explore"
              className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/70"
            >
              Explore
            </h2>
            <ul className="space-y-3">
              {SITE_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="inline-block py-0.5 text-sm text-white no-link-style hover:underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
              Get in touch
            </h2>
            <a
              href="mailto:shpe@wustl.edu"
              className="inline-flex items-center gap-2 break-all py-0.5 text-sm text-white no-link-style hover:underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden />
              shpe@wustl.edu
            </a>

            <ul className="mt-5 space-y-3">
              {SOCIAL_LINKS.map((social) => (
                <li key={social.name}>
                  <a
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 py-0.5 text-sm text-white no-link-style hover:underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <social.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {social.name}
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* white/20 rather than the light blue: #5B9BD5 on navy is 2.4:1. */}
        <div className="mt-12 border-t border-white/20 pt-8 text-sm text-white/70">
          <p>&copy; 2026 WashU SHPE. All rights reserved.</p>
          <p className="mt-1">Society of Hispanic Professional Engineers</p>
        </div>
      </div>
    </footer>
  );
}

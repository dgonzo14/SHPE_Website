import { Linkedin, Mail } from "lucide-react";
import { Contact } from "../components/Contact";
import { SEOHead } from "../components/SEOHead";
import { Section, SectionHeader } from "@/components/ui/section";
import { assetUrl } from "../lib/assets";
import leadersData from "../data/leaders.json";

interface Leader {
  position: string;
  name: string;
  major: string;
  image?: string;
  email?: string;
  linkedin?: string;
}

export function Leadership() {
  const leaders = leadersData as Leader[];
  const getMailtoHref = (email: string) => `mailto:${email.trim()}`;
  const openEmailClient = (email: string) => {
    window.location.assign(getMailtoHref(email));
  };

  return (
    <main className="min-h-screen bg-white">
      <SEOHead
        title="Our Leadership Team - WashU SHPE"
        description="Meet the dedicated executive board members who lead WashU SHPE. Get to know our President, Vice-President, and other leaders working to support the Hispanic engineering community."
        keywords="SHPE leadership, WashU SHPE board, executive board, SHPE officers, Hispanic student leaders, engineering student leadership"
      />

      <Section space="lg">
        <SectionHeader
          eyebrow="Executive board"
          title="Our Leadership Team"
          as="h1"
          lede="The students who run the chapter — and who to contact about what."
        />

        <section
          className="grid grid-cols-1 gap-px border border-shpe-rule bg-shpe-rule sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Executive board members"
        >
          {leaders.map((leader, index) => (
            <article key={index} className="flex min-w-0 flex-col bg-white">
              <div className="flex h-56 w-full items-center justify-center overflow-hidden bg-shpe-navy-soft sm:h-64">
                {leader.image ? (
                  <img
                    src={assetUrl(leader.image)}
                    alt={`${leader.name}, ${leader.position}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span
                    className="text-5xl font-bold text-shpe-navy/40 sm:text-6xl"
                    aria-hidden="true"
                  >
                    {leader.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              <div className="flex flex-grow flex-col p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-shpe-orange-dark">
                  {leader.position}
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight text-shpe-navy sm:text-2xl">
                  {leader.name}
                </h2>
                <p className="mt-1 text-sm text-gray-700 sm:text-base">{leader.major}</p>

                {/*
                  These used to live in an overlay that was opacity-0 and
                  pointer-events-none until :hover. A phone has no hover, so on
                  every touch device the board's contact details were present in
                  the markup and impossible to reach — the page's main purpose,
                  unavailable to most of its traffic.

                  They are part of the card now. Always visible, always
                  tappable, and in the tab order where they appear.
                */}
                {(leader.email || leader.linkedin) && (
                  <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-shpe-rule pt-4">
                    {leader.email && (
                      <a
                        href={getMailtoHref(leader.email)}
                        onClick={(event) => {
                          event.preventDefault();
                          if (leader.email) openEmailClient(leader.email);
                        }}
                        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-shpe-navy no-link-style hover:underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
                        aria-label={`Email ${leader.name}`}
                      >
                        <Mail className="h-4 w-4 shrink-0" aria-hidden />
                        Email
                      </a>
                    )}
                    {leader.linkedin && (
                      <a
                        href={leader.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-shpe-navy no-link-style hover:underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
                        aria-label={`${leader.name}'s LinkedIn profile (opens in a new tab)`}
                      >
                        <Linkedin className="h-4 w-4 shrink-0" aria-hidden />
                        LinkedIn
                      </a>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      </Section>

      <Contact />
    </main>
  );
}

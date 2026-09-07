import React, { useEffect, useRef } from "react";
import { Contact } from "../components/Contact";
import { Instagram, ExternalLink, Calendar, Trophy } from "lucide-react";
import { MemberPortalCallout } from "../components/MemberPortalCallout";
import { Section, SectionHeader } from "@/components/ui/section";
import { LinkButton } from "@/components/ui/button";
import { PublicEventsSection } from "../features/events/PublicEventsSection";
import { SEOHead } from "../components/SEOHead";

export function Members() {
  const instagramRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = instagramRef.current;
    if (!section) return;

    const loadWidget = () => {
      if (document.querySelector('script[src="https://w.behold.so/widget.js"]')) return;
      const script = document.createElement("script");
      script.type = "module";
      script.src = "https://w.behold.so/widget.js";
      document.head.appendChild(script);
    };

    // Only load the Behold script when the Instagram section scrolls into view.
    // rootMargin="400px" starts the fetch 400 px before it's visible.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadWidget();
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="min-h-screen bg-white">
      <SEOHead
        title="Members & Events - WashU SHPE"
        description="Stay connected with the SHPE familia! View upcoming events, follow us on Instagram, join our Slack workspace, and connect on WUGO. Get plugged into the WashU SHPE community."
        keywords="SHPE events, WashU SHPE members, SHPE calendar, Hispanic engineers events, STEM networking, SHPE Slack, WUGO SHPE, SHPE Instagram"
      />
      <Section space="lg">
        <SectionHeader
          eyebrow="Members & events"
          title="Members &amp; Events"
          as="h1"
          lede="Stay connected with the SHPE familia. Check out our upcoming events, follow us on Instagram, and join the conversation."
        />

        {/*
          The chapter calendar, served from our own database.

          This replaced an embedded Outlook calendar. Officers used to keep two
          schedules in step by hand — one in Outlook for the public, one in the
          portal for check-in — and they inevitably drifted. Now an event is
          created once in the admin portal and appears here, in the member
          portal, and in the check-in flow.

          Anonymous visitors read these rows through a column-restricted grant,
          so nothing shown here depends on the client choosing to hide fields.
        */}
        <section className="mt-4" aria-labelledby="events-heading">
          <div className="border border-shpe-rule bg-white p-6 sm:p-8">
            <div className="mb-2 flex items-center gap-3">
              <Calendar className="h-6 w-6 shrink-0 text-shpe-navy" aria-hidden />
              <h2
                id="events-heading"
                className="text-xl font-bold tracking-tight text-shpe-navy sm:text-2xl"
              >
                Upcoming Events
              </h2>
            </div>
            <p className="mb-6 max-w-[65ch] text-sm leading-relaxed text-gray-700 sm:text-base">
              Workshops, socials, and networking events — open to anyone curious about SHPE. Pick a
              highlighted day to see what is on.
            </p>
            <PublicEventsSection headingId="events-heading" />
          </div>
        </section>

        {/* Bridge into the portal for people who are already members. */}
        <section className="mt-6 sm:mt-8" aria-labelledby="portal-callout-heading">
          <MemberPortalCallout
            headingId="portal-callout-heading"
            title="Already a SHPE WashU member?"
            description="Track events, check in, and see your SHPE points in My SHPE."
            icon={Trophy}
          />
        </section>
      </Section>

      {/* Instagram — the widget script loads only when this scrolls into view. */}
      <Section tone="soft" space="lg" ref={instagramRef} aria-labelledby="instagram-heading">
        <SectionHeader
          eyebrow="@washushpe"
          title="Follow Our Journey"
          id="instagram-heading"
          lede="Event highlights, behind-the-scenes, and what the familia is up to this week."
          actions={
            <LinkButton
              to="https://www.instagram.com/washushpe/"
              external
              aria-label="Follow @washushpe on Instagram (opens in a new tab)"
            >
              <Instagram className="h-4 w-4 shrink-0" aria-hidden />
              Follow @washushpe
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </LinkButton>
          }
        />

        <div className="border border-shpe-rule bg-white p-4">
          {React.createElement("behold-widget", { "feed-id": "gZukTIlscdP6HZISRbbb" })}
        </div>
      </Section>

      <Contact />
    </main>
  );
}
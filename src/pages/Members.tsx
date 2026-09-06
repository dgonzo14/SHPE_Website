import React, { useEffect, useRef } from "react";
import { Contact } from "../components/Contact";
import { Instagram, ExternalLink, Calendar, Trophy } from "lucide-react";
import { MemberPortalCallout } from "../components/MemberPortalCallout";
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Header */}
        <header className="text-center mb-12 sm:mb-16 px-2">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl mb-3 sm:mb-4 text-[#1B365D] leading-tight">
            Members &amp; Events
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-gray-700 max-w-3xl mx-auto">
            Stay connected with the SHPE familia! Check out our upcoming events,
            follow us on Instagram, and join the conversation.
          </p>
        </header>

        {/* Calendar Section */}
        <section className="mb-12 sm:mb-20" aria-labelledby="events-heading">
          <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 border-2 border-[#5B9BD5]">
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
              <div className="p-2 sm:p-3 rounded-lg bg-[#E8F4F8] flex-shrink-0">
                <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-[#5B9BD5]" aria-hidden="true" />
              </div>
              <h2 id="events-heading" className="text-2xl sm:text-3xl text-[#1B365D]">
                Upcoming Events
              </h2>
            </div>
            <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6">
              View our calendar to see all upcoming workshops, socials, and networking events.
            </p>
            <div className="w-full h-[400px] sm:h-[500px] lg:h-[600px] rounded-xl overflow-hidden shadow-md border border-gray-200">
              <iframe
                src="https://outlook.office365.com/owa/calendar/f8241a43c9054867871293ed9595feca@wustl.edu/9f1b50bdd6934c41977034651bbb2e7b2332332838884438037/calendar.html"
                className="w-full h-full border-0"
                title="SHPE Events Calendar"
                aria-label="SHPE Events Calendar - View upcoming events"
                loading="lazy"
              />
            </div>
          </div>
        </section>

        {/*
          Bridge into the portal. The public calendar above stays exactly as it
          was: this adds a way in for people who are already members, it does
          not move anything behind a login.
        */}
        <section className="mb-12 sm:mb-20" aria-labelledby="portal-callout-heading">
          <MemberPortalCallout
            headingId="portal-callout-heading"
            title="Already a SHPE WashU member?"
            description="Track events, check in, and see your SHPE points in My SHPE."
            icon={Trophy}
          />
        </section>

        {/* Instagram Section — widget loaded lazily */}
        <section
          ref={instagramRef}
          className="mb-12 sm:mb-20"
          aria-labelledby="instagram-heading"
        >
          <div className="bg-[#FEF2EE] rounded-2xl p-6 sm:p-8 md:p-12">
            <div className="text-center mb-6 sm:mb-8">
              <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white mb-3 sm:mb-4 shadow-lg">
                <Instagram className="w-6 h-6 sm:w-8 sm:h-8 text-[#E84E1B]" aria-hidden="true" />
              </div>
              <h2 id="instagram-heading" className="text-3xl sm:text-4xl mb-3 sm:mb-4 text-[#1B365D] px-2">
                Follow Our Journey
              </h2>
              <p className="text-base sm:text-lg text-gray-700 mb-4 sm:mb-6 max-w-2xl mx-auto px-2">
                See what we're up to! Follow us on Instagram to stay connected with
                our community, see event highlights, and get behind-the-scenes content.
              </p>
              <a
                href="https://www.instagram.com/washushpe/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 sm:gap-3 rounded-lg px-6 sm:px-8 py-3 sm:py-4 transition-all hover:scale-105 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white font-semibold text-sm sm:text-base min-h-[44px]"
                style={{ backgroundColor: "#E84E1B", color: "#FFFFFF" }}
                aria-label="Follow @washushpe on Instagram (opens in new window)"
              >
                <Instagram
                  className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0"
                  aria-hidden="true"
                  style={{ color: "#FFFFFF" }}
                />
                <span>Follow @washushpe</span>
                <ExternalLink
                  className="w-4 h-4 flex-shrink-0"
                  aria-hidden="true"
                  style={{ color: "#FFFFFF" }}
                />
              </a>
            </div>

            <div className="mt-8 bg-white rounded-xl p-4 shadow-md">
              {React.createElement("behold-widget", { "feed-id": "gZukTIlscdP6HZISRbbb" })}
            </div>
          </div>
        </section>
      </div>
      <Contact />
    </main>
  );
}
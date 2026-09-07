import { Slack, Linkedin, Instagram, ExternalLink, MessageCircle, Users, Target, Globe, Trophy } from "lucide-react";
import { MemberPortalCallout } from "../components/MemberPortalCallout";
import { SEOHead } from "../components/SEOHead";
import { Contact } from "../components/Contact";
import { Section, SectionHeader } from "@/components/ui/section";
import { LinkButton } from "@/components/ui/button";

const WHY = [
  {
    icon: MessageCircle,
    title: "Stay Connected",
    description: "Get instant updates on events, opportunities, and important announcements",
  },
  {
    icon: Users,
    title: "Build Your Network",
    description: "Connect with fellow members, alumni, and industry professionals",
  },
  {
    icon: Target,
    title: "Access Resources",
    description: "Find study materials, career resources, and mentorship opportunities",
  },
] as const;

export function GetPluggedIn() {
  const platforms = [
    {
      icon: Slack,
      name: "Slack",
      title: "Join Us on Slack",
      description: "Connect with members, get real-time updates, and participate in discussions. Our Slack workspace is where the SHPE familia stays connected!",
      action: "Join Workspace",
      url: "https://shpeexecboard.slack.com/join/shared_invite/zt-3mthk5cja-6KJtvK~Oh6w6yeNPPYGg7w#/shared-invite/email",
    },
    {
      icon: Linkedin,
      name: "LinkedIn",
      title: "Follow Us on LinkedIn",
      description: "Stay updated on professional development opportunities, job postings, and connect with our alumni network on LinkedIn.",
      action: "Follow on LinkedIn",
      url: "https://www.linkedin.com/company/washu-society-of-hispanic-professional-engineers/posts/?feedView=all",
    },
    {
      icon: Instagram,
      name: "Instagram",
      title: "Follow Us on Instagram",
      description: "See what we're up to! Follow our Instagram for event photos, stories, and behind-the-scenes content from the SHPE familia.",
      action: "Follow on Instagram",
      url: "https://www.instagram.com/washushpe/",
    },
    {
      icon: Globe,
      name: "WUGO",
      title: "Find Us on WUGO",
      description: "See our official WashU student organization listing on WUGO and register to become a member",
      action: "Open WUGO",
      url: "https://wustl.presence.io/organization/society-of-hispanic-professional-engineers",
    }
  ];

  return (
    <main className="min-h-screen bg-white">
      <SEOHead
        title="Get Plugged In - WashU SHPE"
        description="Stay connected with the WashU SHPE community. Join our Slack workspace, follow us on LinkedIn and Instagram, and get plugged into events, opportunities, and our supportive familia!"
        keywords="SHPE Slack, SHPE LinkedIn, SHPE Instagram, join SHPE, connect with SHPE, Hispanic engineering community, STEM networking"
      />
      <Section space="lg">
        <SectionHeader
          eyebrow="Join the familia"
          title="Get Plugged In"
          as="h1"
          lede="Stay connected with the WashU SHPE community across all our platforms. Join the conversation, get updates, and be part of our familia."
        />

        {/*
          One row per platform on a shared ruled grid, rather than four cards
          each with its own 2px border in its own brand colour. Those borders
          were the only thing distinguishing the rows, and none of the four
          colours cleared AA against white for the button text sitting inside
          them — every action button was white on a mid-tone fill. They use the
          shared button now, which is a single audited pair.
        */}
        <section aria-labelledby="platforms-heading">
          <h2 id="platforms-heading" className="sr-only">
            Social media platforms
          </h2>
          <ul className="grid grid-cols-1 gap-px border border-shpe-rule bg-shpe-rule">
            {platforms.map((platform) => (
              <li key={platform.name} className="min-w-0 bg-white">
                <article className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:gap-7 sm:p-8">
                  <platform.icon
                    className="h-10 w-10 shrink-0 text-shpe-navy sm:h-12 sm:w-12"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xl font-bold tracking-tight text-shpe-navy sm:text-2xl">
                      {platform.title}
                    </h3>
                    <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-gray-700 sm:text-base">
                      {platform.description}
                    </p>
                    <LinkButton
                      to={platform.url}
                      external
                      variant="subtle"
                      className="mt-5"
                      aria-label={`${platform.action} on ${platform.name} (opens in a new tab)`}
                    >
                      {platform.action}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </LinkButton>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8" aria-labelledby="portal-callout-heading">
          <MemberPortalCallout
            headingId="portal-callout-heading"
            title="Already a SHPE WashU member?"
            description="Track events, check in, and see your SHPE points in My SHPE."
            icon={Trophy}
          />
        </section>
      </Section>

      <Section tone="soft" space="lg" aria-labelledby="why-heading">
        <SectionHeader eyebrow="Why bother" title="Why Get Plugged In?" id="why-heading" />

        <ul className="grid grid-cols-1 gap-px border border-shpe-rule bg-shpe-rule md:grid-cols-3">
          {WHY.map((item, index) => (
            <li key={item.title} className="min-w-0 bg-white">
              <article className="flex h-full flex-col p-6 sm:p-7">
                <div className="mb-5 flex items-baseline justify-between gap-3">
                  <span
                    className="text-[2.5rem] font-bold leading-none tabular-nums text-shpe-navy/20"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <item.icon className="h-6 w-6 shrink-0 text-shpe-orange-dark" aria-hidden />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-shpe-navy sm:text-xl">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-700 sm:text-base">
                  {item.description}
                </p>
              </article>
            </li>
          ))}
        </ul>
      </Section>

      <Contact />
    </main>
  );
}

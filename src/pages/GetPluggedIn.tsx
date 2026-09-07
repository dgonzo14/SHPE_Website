import { Slack, Linkedin, Instagram, ExternalLink, MessageCircle, Users, Target, Globe, Trophy } from "lucide-react";
import { MemberPortalCallout } from "../components/MemberPortalCallout";
import { SEOHead } from "../components/SEOHead";
import { Contact } from "../components/Contact";

export function GetPluggedIn() {
  const platforms = [
    {
      icon: Slack,
      name: "Slack",
      title: "Join Us on Slack",
      description: "Connect with members, get real-time updates, and participate in discussions. Our Slack workspace is where the SHPE familia stays connected!",
      action: "Join Workspace",
      url: "https://shpeexecboard.slack.com/join/shared_invite/zt-3mthk5cja-6KJtvK~Oh6w6yeNPPYGg7w#/shared-invite/email",
      color: "#D33A02",
      bgColor: "#FEF2EE"
    },
    {
      icon: Linkedin,
      name: "LinkedIn",
      title: "Follow Us on LinkedIn",
      description: "Stay updated on professional development opportunities, job postings, and connect with our alumni network on LinkedIn.",
      action: "Follow on LinkedIn",
      url: "https://www.linkedin.com/company/washu-society-of-hispanic-professional-engineers/posts/?feedView=all",
      color: "#0070C0",
      bgColor: "#E8F4F8"
    },
    {
      icon: Instagram,
      name: "Instagram",
      title: "Follow Us on Instagram",
      description: "See what we're up to! Follow our Instagram for event photos, stories, and behind-the-scenes content from the SHPE familia.",
      action: "Follow on Instagram",
      url: "https://www.instagram.com/washushpe/",
      color: "#FD652F",
      bgColor: "#FEF2EE"
    },
    {
      icon: Globe,
      name: "WUGO",
      title: "Find Us on WUGO",
      description: "See our official WashU student organization listing on WUGO and register to become a member",
      action: "Open WUGO",
      url: "https://wustl.presence.io/organization/society-of-hispanic-professional-engineers",
      color: "#001F5B",
      bgColor: "#E8ECF2"
    }
  ];

  return (
    <main className="min-h-screen bg-white">
      <SEOHead
        title="Get Plugged In - WashU SHPE"
        description="Stay connected with the WashU SHPE community. Join our Slack workspace, follow us on LinkedIn and Instagram, and get plugged into events, opportunities, and our supportive familia!"
        keywords="SHPE Slack, SHPE LinkedIn, SHPE Instagram, join SHPE, connect with SHPE, Hispanic engineering community, STEM networking"
      />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <header className="text-center mb-12 sm:mb-16 px-2">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl mb-3 sm:mb-4 text-[var(--color-primary-blue)] leading-tight">
            Get Plugged In
          </h1>
          <p className="text-sm sm:text-base text-[var(--color-text-tertiary)] max-w-2xl mx-auto">
            Stay connected with the WashU SHPE community across all our platforms. 
            Join the conversation, get updates, and be part of our familia!
          </p>
        </header>

        {/* Platform Cards */}
        <section className="space-y-6 sm:space-y-8 mb-12 sm:mb-16" aria-labelledby="platforms-heading">
          <h2 id="platforms-heading" className="sr-only">Social Media Platforms</h2>
          <ul className="space-y-6 sm:space-y-8 list-none" role="list">
            {platforms.map((platform) => (
              <li key={platform.name} role="listitem">
                <article
                  className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all p-6 sm:p-8 border-2 focus-within:ring-2 focus-within:ring-[var(--color-primary-blue)] focus-within:ring-offset-2"
                  style={{ borderColor: platform.color }}
                >
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-4 sm:gap-6">
                    <div
                      className="p-4 sm:p-6 rounded-xl flex-shrink-0"
                      style={{ backgroundColor: platform.bgColor }}
                      aria-hidden="true"
                    >
                      <platform.icon
                        className="w-10 h-10 sm:w-12 sm:h-12"
                        style={{ color: platform.color }}
                        aria-hidden="true"
                      />
                    </div>
                    
                    <div className="flex-1">
                      <h3 className="text-2xl sm:text-3xl mb-2 sm:mb-3 text-[var(--color-primary-blue)]">
                        {platform.title}
                      </h3>
                      <p className="text-sm sm:text-base lg:text-lg text-[var(--color-text-secondary)] mb-4 sm:mb-6">
                        {platform.description}
                      </p>
                      
                      <a
                        href={platform.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 sm:gap-3 rounded-lg px-5 sm:px-6 py-2.5 sm:py-3 transition-all hover:scale-105 shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white font-semibold text-sm sm:text-base min-h-[44px]"
                        style={{ backgroundColor: platform.color, color: "#FFFFFF" }}
                        aria-label={`${platform.action} on ${platform.name} (opens in new window)`}
                      >
                        <span>{platform.action}</span>
                        <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" aria-hidden="true" style={{ color: "#FFFFFF" }} />
                      </a>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-12 sm:mb-16" aria-labelledby="portal-callout-heading">
          <MemberPortalCallout
            headingId="portal-callout-heading"
            title="Already part of the familia?"
            description="Access events, points, and your member profile in My SHPE."
            icon={Trophy}
          />
        </section>

        {/* Why Get Plugged In Section */}
        <section className="bg-gray-50 rounded-2xl p-8 sm:p-10 lg:p-12" aria-labelledby="why-heading">
          <h2 id="why-heading" className="text-2xl sm:text-3xl text-center mb-6 sm:mb-8 text-[var(--color-primary-blue)] px-2">
            Why Get Plugged In?
          </h2>
          
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 list-none" role="list">
            <li className="text-center" role="listitem">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full mx-auto mb-3 sm:mb-4 flex items-center justify-center bg-[#FEF2EE]" aria-hidden="true">
                <MessageCircle className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: '#E84E1B' }} aria-hidden="true" />
              </div>
              <h3 className="text-lg sm:text-xl mb-2 text-[var(--color-primary-blue)]">Stay Connected</h3>
              <p className="text-sm sm:text-base text-[var(--color-text-tertiary)]">
                Get instant updates on events, opportunities, and important announcements
              </p>
            </li>
            
            <li className="text-center" role="listitem">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full mx-auto mb-3 sm:mb-4 flex items-center justify-center bg-[#E8F4F8]" aria-hidden="true">
                <Users className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: '#5B9BD5' }} aria-hidden="true" />
              </div>
              <h3 className="text-lg sm:text-xl mb-2 text-[var(--color-primary-blue)]">Build Your Network</h3>
              <p className="text-sm sm:text-base text-[var(--color-text-tertiary)]">
                Connect with fellow members, alumni, and industry professionals
              </p>
            </li>
            
            <li className="text-center" role="listitem">
              <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full mx-auto mb-3 sm:mb-4 flex items-center justify-center bg-[#E8ECF2]" aria-hidden="true">
                <Target className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: '#1B365D' }} aria-hidden="true" />
              </div>
              <h3 className="text-lg sm:text-xl mb-2 text-[var(--color-primary-blue)]">Access Resources</h3>
              <p className="text-sm sm:text-base text-[var(--color-text-tertiary)]">
                Find study materials, career resources, and mentorship opportunities
              </p>
            </li>
          </ul>
        </section>
      </div>
      <Contact />
    </main>
  );
}

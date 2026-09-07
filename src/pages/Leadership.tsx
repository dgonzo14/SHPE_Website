import { Linkedin, Mail } from "lucide-react";
import { Contact } from "../components/Contact";
import { SEOHead } from "../components/SEOHead";
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <header className="text-center mb-12 sm:mb-16 px-2">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl mb-4 sm:mb-6 text-[#1B365D] leading-tight">
            Our Leadership Team
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-gray-700 max-w-3xl mx-auto">
            Meet the dedicated executive board members who lead WashU SHPE and
            work tirelessly to support our community.
          </p>
        </header>

        <section
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8"
          aria-label="Executive board members"
        >
          {leaders.map((leader, index) => (
            <article
              key={index}
              className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 group relative flex flex-col"
            >
              <div className="relative">
                {/* Image Container */}
                <div className="w-full h-56 sm:h-64 bg-gradient-to-br from-[#1B365D] to-[#5B9BD5] flex items-center justify-center overflow-hidden">
                  {leader.image ? (
                    <img
                      src={assetUrl(leader.image)}
                      alt={`${leader.name}, ${leader.position}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="text-white text-5xl sm:text-6xl font-bold">
                      {leader.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Hover Overlay with Contact Buttons */}
                <div className="absolute inset-0 bg-[#1B365D] bg-opacity-95 opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 group-hover:pointer-events-auto group-focus-within:pointer-events-auto transition-opacity duration-300 flex items-center justify-center gap-3 sm:gap-4">
                  {leader.email && (
                    <a
                      href={getMailtoHref(leader.email)}
                      onClick={(event) => {
                        event.preventDefault();
                        if (leader.email) {
                          openEmailClient(leader.email);
                        }
                      }}
                      className="bg-white rounded-full p-3 sm:p-4 hover:scale-110 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white shadow-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label={`Email ${leader.name}`}
                    >
                      <Mail className="w-5 h-5 sm:w-6 sm:h-6 text-[#1B365D]" aria-hidden="true" />
                    </a>
                  )}
                  {leader.linkedin && (
                    <a
                      href={leader.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-white rounded-full p-3 sm:p-4 hover:scale-110 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white shadow-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label={`${leader.name}'s LinkedIn profile (opens in new window)`}
                    >
                      <Linkedin className="w-5 h-5 sm:w-6 sm:h-6 text-[#1B365D]" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>

              {/* Card Content */}
              <div className="p-5 sm:p-6 flex-grow">
                <h2 className="text-base sm:text-lg font-semibold text-[#A83711] mb-1">
                  {leader.position}
                </h2>
                <h3 className="text-xl sm:text-2xl font-bold text-[#1B365D] mb-1 sm:mb-2">
                  {leader.name}
                </h3>
                <p className="text-sm sm:text-base text-gray-700">{leader.major}</p>
              </div>
            </article>
          ))}
        </section>
      </div>
      <Contact />
    </main>
  );
}


import {
      Users,
    GraduationCap,
    Briefcase,
    Home,
    Plane,
    FileText,
    X,
    Utensils,
  } from "lucide-react";
//   import sponsorshipImage from "figma:asset/bf3fd8f2a6806f6dee31c345da62cbf1dcfad006.png";
  import { useState, useEffect, useRef } from "react";
  import { Contact } from "../components/Contact";
  import { SEOHead } from "../components/SEOHead";
  const BASE_URL = import.meta.env.BASE_URL;
  
  export function Sponsorship() {
    const [showDonateModal, setShowDonateModal] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const firstFocusableRef = useRef<HTMLAnchorElement>(null);
    
    // Focus trap and ESC key handling for modal
    useEffect(() => {
      if (showDonateModal) {
        // Focus first element when modal opens
        setTimeout(() => {
          firstFocusableRef.current?.focus();
        }, 100);
        
        // Handle ESC key
        const handleEscape = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            setShowDonateModal(false);
          }
        };
        
        // Handle focus trap
        const handleTab = (e: KeyboardEvent) => {
          if (e.key !== 'Tab') return;
          
          const modal = modalRef.current;
          if (!modal) return;
          
          const focusableElements = modal.querySelectorAll(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
          
          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              e.preventDefault();
              lastElement.focus();
            }
          } else {
            if (document.activeElement === lastElement) {
              e.preventDefault();
              firstElement.focus();
            }
          }
        };
        
        document.addEventListener('keydown', handleEscape);
        document.addEventListener('keydown', handleTab);
        
        return () => {
          document.removeEventListener('keydown', handleEscape);
          document.removeEventListener('keydown', handleTab);
        };
      }
    }, [showDonateModal]);
  
    const impactLevels = [
      {
        amount: "$10",
        icon: Users,
        title: "National Membership",
        description:
          "Provides one student with SHPE national membership benefits",
        color: "#5B9BD5",
      },
      {
        amount: "$25",
        per: "/student",
        icon: Utensils,
        title: "Conference Meal",
        description:
          "Covers one meal for a student during the SHPE Conference",
        color: "#1B365D",
      },
      {
        amount: "$100",
        per: "/event",
        icon: Briefcase,
        title: "On-Campus Workshop",
        description:
          "Funds an on-campus workshop like elevator pitch training or resume reviews — essential for conference readiness",
        color: "#E84E1B",
      },
      {
        amount: "$180",
        per: "/student",
        icon: Home,
        title: "Conference Lodging",
        description:
          "Covers one night of lodging at the conference — safe, accessible housing so students can fully engage",
        color: "#5B9BD5",
      },
      {
        amount: "$250",
        per: "/student",
        icon: Plane,
        title: "Travel to Convention",
        description:
          "Helps a student get to the SHPE National Convention — because talent shouldn't be limited by travel costs",
        color: "#1B365D",
      },
      {
        amount: "$345",
        per: "/student",
        icon: GraduationCap,
        title: "Full Convention Access",
        description:
          "Covers one student's full SHPE National Convention registration — unlocking access to networking, workshops, and career opportunities",
        color: "#E84E1B",
      },
    ];
  
    const sponsorshipTiers = [
      {
        name: "Superhéroe",
        nameEnglish: "(Superhero)",
        price: "$250",
        icon: "S",
      color: "#0070C0",
        benefits: [
          "Announced as sponsor in our newsletter",
          "Invitation to SHPE WashU events",
        ],
      },
      {
        name: "Hermanos",
        nameEnglish: "(Kin)",
        price: "$500",
        icon: "H",
      color: "#FD652F",
        benefits: [
          "Announced as sponsor in our newsletter",
          "Invitation to SHPE WashU events",
          "Accessibility to SHPE member resumes",
        ],
      },
      {
        name: "Padrinos",
        nameEnglish: "(Godparents)",
        price: "$1000",
        icon: "P",
      color: "#D33A02",
        benefits: [
          "Announced as a sponsor in our events and newsletter",
          "Accessibility to SHPE member resumes",
          "One private sponsor led event",
          "Logo promotion: merch, events funded by sponsors, etc.",
        ],
      },
      {
        name: "Estrellas",
        nameEnglish: "(Stars)",
        price: "$1500",
        icon: "E",
        color: "#FFA017",
        benefits: [
          "Announced as an investor in all events, newsletters, and social media",
          "Accessibility to SHPE member resumes",
          "One private sponsor-led event",
          "Opportunity to include job postings in the newsletter",
          "Logo promotion: website, merch, events funded by sponsors, etc.",
        ],
      },
    ];
  
    return (
      <main className="min-h-screen bg-white">
        <SEOHead
          title="Sponsorship Opportunities - WashU SHPE"
          description="Partner with WashU SHPE to empower Hispanic STEM students. Explore sponsorship tiers and see how your contribution funds workshops, conferences, and mentorship programs. Make a difference today!"
          keywords="SHPE sponsorship, corporate partnership, Hispanic engineering sponsorship, STEM funding, SHPE donate, WashU corporate sponsors, engineering scholarships"
        />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          {/* Header Section */}
          <header className="text-center mb-12 sm:mb-16 px-2">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl mb-4 sm:mb-6 text-[var(--color-primary-blue)] leading-tight">
              Explore Sponsorship Opportunities
            </h1>
            <p className="text-2xl sm:text-3xl mb-4 sm:mb-6 text-[var(--color-primary-orange)]">
              Partner With Us
            </p>
            <p className="text-base sm:text-lg lg:text-xl text-[var(--color-text-secondary)] max-w-4xl mx-auto mb-3 sm:mb-4">
              WashU SHPE collaborates with corporate partners to
              bring impactful workshops, mentorship, scholarships,
              and career opportunities to our members.
            </p>
            <p className="text-base sm:text-lg lg:text-xl max-w-3xl mx-auto text-[var(--color-primary-blue)]">
              Thank you to all our sponsors for your generous
              support!
            </p>
          </header>
  
          {/* Impact Visualization Section */}
          <section className="mb-12 sm:mb-20" aria-labelledby="impact-heading">
            <h2 id="impact-heading" className="text-2xl sm:text-3xl lg:text-4xl text-center mb-3 sm:mb-4 text-[var(--color-primary-blue)] px-2">
              How Your Contribution Makes an Impact
            </h2>
            <p className="text-center text-sm sm:text-base text-[var(--color-text-tertiary)] mb-8 sm:mb-12 max-w-3xl mx-auto px-2">
              Every dollar invested in our students creates
              lasting change. Here's how your sponsorship directly
              supports student success:
            </p>
  
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 list-none" role="list">
              {impactLevels.map((level, index) => (
                <li key={index} role="listitem" className="flex">
                  <article
                    className="bg-white rounded-2xl p-6 sm:p-8 shadow-lg border-2 focus-within:ring-2 focus-within:ring-[var(--color-primary-blue)] focus-within:ring-offset-2 flex flex-col w-full"
                    style={{ borderColor: level.color }}
                  >
                    <div
                      className="w-12 h-12 sm:w-16 sm:h-16 rounded-full mx-auto mb-3 sm:mb-4 flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: `${level.color}15`,
                      }}
                      aria-hidden="true"
                    >
                      <level.icon
                        className="w-6 h-6 sm:w-8 sm:h-8"
                        style={{ color: level.color }}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="text-center flex-grow flex flex-col">
                      <div
                        className="text-3xl sm:text-4xl mb-1 font-semibold"
                        style={{ color: level.color }}
                      >
                        {level.amount}
                        {level.per && (
                          <span className="text-lg sm:text-2xl text-gray-600">
                            {level.per}
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg sm:text-xl mb-2 sm:mb-3 text-[var(--color-primary-blue)]">
                        {level.title}
                      </h3>
                      <p className="text-sm sm:text-base text-gray-700 flex-grow">
                        {level.description}
                      </p>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
  
          {/* Sponsorship Tiers Section */}
          <section className="mb-12 sm:mb-20" aria-labelledby="tiers-heading">
            <h2 id="tiers-heading" className="text-2xl sm:text-3xl lg:text-4xl text-center mb-8 sm:mb-12 text-[var(--color-primary-blue)] px-2">
              Sponsorship Tiers
            </h2>
  
            {/* Detailed Tier Cards */}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 list-none" role="list">
              {sponsorshipTiers.map((tier, index) => (
                <li key={index} role="listitem" className="flex">
                  <article
                    className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 border-t-8 hover:shadow-2xl transition-all focus-within:ring-2 focus-within:ring-[var(--color-primary-blue)] focus-within:ring-offset-2 flex flex-col w-full"
                    style={{ borderTopColor: tier.color }}
                  >
                    <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6 flex-shrink-0">
                      <div
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-white text-2xl sm:text-3xl font-bold flex-shrink-0"
                        style={{ backgroundColor: tier.color }}
                        aria-hidden="true"
                      >
                        {tier.icon}
                      </div>
                      <div>
                        <h3
                          className="text-xl sm:text-2xl"
                          style={{ color: "#001F5B" }}
                        >
                          {tier.name} {tier.nameEnglish}
                        </h3>
                        <p
                          className="text-2xl sm:text-3xl font-semibold"
                          style={{ color: tier.color }}
                        >
                          {tier.price}
                        </p>
                      </div>
                    </div>
  
                    <ul className="space-y-2 sm:space-y-3 list-none flex-grow" role="list">
                      {tier.benefits.map(
                        (benefit, benefitIndex) => (
                          <li key={benefitIndex} className="flex items-start gap-2 sm:gap-3" role="listitem">
                            <div
                              className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                              style={{
                                backgroundColor: tier.color,
                              }}
                              aria-hidden="true"
                            />
                            <p className="text-sm sm:text-base text-gray-700">
                              {benefit}
                            </p>
                          </li>
                        ),
                      )}
                    </ul>
                  </article>
                </li>
              ))}
            </ul>
          </section>
  
          {/* Call to Action */}
          <section className="bg-gradient-to-r from-blue-50 to-orange-50 rounded-2xl sm:rounded-3xl p-8 sm:p-12 text-center" aria-labelledby="cta-heading">
            <h2 id="cta-heading" className="text-2xl sm:text-3xl lg:text-4xl mb-4 sm:mb-6 text-[var(--color-primary-blue)] px-2">
              Ready to Make a Difference?
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-[var(--color-text-secondary)] mb-6 sm:mb-8 max-w-2xl mx-auto px-2">
              Join us in empowering the next generation of
              Hispanic STEM leaders. Your partnership creates
              opportunities that transform lives.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <a
                href={`${BASE_URL}/WashU_SHPE_Sponsorship_Package.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg px-6 sm:px-8 py-3 sm:py-4 transition-all hover:scale-105 shadow-lg flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white font-semibold text-sm sm:text-base min-h-[44px]"
                style={{ backgroundColor: "#E84E1B", color: "#FFFFFF" }}
                aria-label="Download Corporate Packet PDF (opens in new window)"
              >
                <FileText className="w-5 h-5 flex-shrink-0" aria-hidden="true" style={{ color: "#FFFFFF" }} />
                <span>Corporate Packet (PDF)</span>
              </a>
              <button
                onClick={() => setShowDonateModal(true)}
                className="rounded-lg px-6 sm:px-8 py-3 sm:py-4 transition-all hover:scale-105 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white font-semibold text-sm sm:text-base min-h-[44px]"
                style={{ backgroundColor: "#1B365D", color: "#FFFFFF" }}
                aria-label="Open donation modal"
              >
                Donate Online
              </button>
            </div>
          </section>
        </div>
  
        {/* Donate Modal */}
        {showDonateModal && (
          <div 
            className="fixed inset-0 bg-[var(--color-overlay)] flex items-center justify-center z-50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-heading"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowDonateModal(false);
              }
            }}
          >
            <div 
              ref={modalRef}
              className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 sm:p-8">
                <div className="flex justify-between items-start sm:items-center mb-4 sm:mb-6 gap-4">
                  <h2
                    id="modal-heading"
                    className="text-2xl sm:text-3xl text-[var(--color-primary-blue)] flex-1"
                  >
                    How to Donate Online
                  </h2>
                  <button
                    ref={closeButtonRef}
                    className="text-gray-500 hover:text-gray-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-blue)] rounded p-2 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
                    onClick={() => setShowDonateModal(false)}
                    aria-label="Close donation modal"
                  >
                    <X className="w-6 h-6" aria-hidden="true" />
                  </button>
                </div>
  
                <div className="space-y-4 sm:space-y-6">
                  <p className="text-[var(--color-text-secondary)] text-base sm:text-lg">
                    Thank you for your generous support! Follow
                    these steps to complete your donation:
                  </p>
  
                  <ol className="bg-blue-50 rounded-lg p-4 sm:p-6 space-y-3 sm:space-y-4 list-none" aria-label="Donation steps">
                    <li className="flex gap-3 sm:gap-4">
                      <div
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white text-base sm:text-lg font-bold"
                        style={{ backgroundColor: "#1B365D" }}
                        aria-hidden="true"
                      >
                        1
                      </div>
                      <div>
                        <h3 className="text-base sm:text-lg mb-1 sm:mb-2 text-[var(--color-primary-blue)] font-semibold">
                          Visit the WashU Donation Portal
                        </h3>
                        <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
                          Click the button at the bottom of this
                          dialog to be redirected to the secure
                          WashU giving portal.
                        </p>
                      </div>
                    </li>
  
                    <li className="flex gap-3 sm:gap-4">
                      <div
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white text-base sm:text-lg font-bold"
                        style={{ backgroundColor: "#E84E1B" }}
                        aria-hidden="true"
                      >
                        2
                      </div>
                      <div>
                        <h3 className="text-base sm:text-lg mb-1 sm:mb-2 text-[var(--color-primary-blue)] font-semibold">
                          Select "I prefer to enter my own
                          designation"
                        </h3>
                        <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
                          On the donation form, choose the option
                          that says{" "}
                          <strong>
                            "I prefer to enter my own designation
                            (specify below)"
                          </strong>
                        </p>
                      </div>
                    </li>
  
                    <li className="flex gap-3 sm:gap-4">
                      <div
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white text-base sm:text-lg font-bold"
                        style={{ backgroundColor: "#5B9BD5" }}
                        aria-hidden="true"
                      >
                        3
                      </div>
                      <div>
                        <h3 className="text-base sm:text-lg mb-1 sm:mb-2 text-[var(--color-primary-blue)] font-semibold">
                          Enter the Designation
                        </h3>
                        <p className="text-sm sm:text-base text-[var(--color-text-secondary)] mb-2 sm:mb-3">
                          In the designation field, type:
                        </p>
                        <div
                          className="bg-white border-2 rounded-lg p-3 sm:p-4 border-[var(--color-primary-blue)]"
                        >
                          <p className="text-sm sm:text-base lg:text-lg">
                            <strong>
                              Society of Hispanic Professional
                              Engineers
                            </strong>{" "}
                            [Your Amount]
                          </p>
                        </div>
                        <p className="text-[var(--color-text-tertiary)] text-xs sm:text-sm mt-2">
                          Example: "Society of Hispanic
                          Professional Engineers $250"
                        </p>
                      </div>
                    </li>
  
                    <li className="flex gap-3 sm:gap-4">
                      <div
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white text-base sm:text-lg font-bold"
                        style={{ backgroundColor: "#1B365D" }}
                        aria-hidden="true"
                      >
                        4
                      </div>
                      <div>
                        <h3 className="text-base sm:text-lg mb-1 sm:mb-2 text-[var(--color-primary-blue)] font-semibold">
                          Complete Your Donation
                        </h3>
                        <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
                          Fill out the remaining information and
                          submit your generous contribution. Your
                          support directly impacts our students!
                        </p>
                      </div>
                    </li>
                  </ol>
  
                  <div className="pt-4 sm:pt-6 flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <a
                      ref={firstFocusableRef}
                      href="https://wustl.advancementform.com/campaign/gifts-wustl-edu/give?sc=GA2024&_gl=1*1iwzsaz*_ga*MTQ0NzM0OTM4My4xNzYxNjg4MDgy*_ga_YVW0WQRFV8*czE3Njc2NDA5MzEkbzIkZzEkdDE3Njc2NDA5NDIkajQ5JGwwJGgw*_ga_644M6QG3YF*czE3Njc2NDA5MzIkbzIkZzEkdDE3Njc2NDA5NDIkajUwJGwwJGgw*_ga_D6PN61M2D3*czE3Njc2NDA5MzIkbzIkZzEkdDE3Njc2NDA5NDIkajUwJGwwJGgw*_ga_97GKM0B0NF*czE3Njc2NDA5MzIkbzIkZzEkdDE3Njc2NDA5NDIkajUwJGwwJGgw"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center rounded-lg px-6 sm:px-8 py-3 sm:py-4 transition-all hover:scale-105 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white font-semibold text-sm sm:text-base min-h-[44px] flex items-center justify-center"
                      style={{ backgroundColor: "#E84E1B", color: "#FFFFFF" }}
                      aria-label="Go to WashU Donation Portal (opens in new window)"
                    >
                      Go to Donation Portal
                    </a>
                    <button
                      onClick={() => setShowDonateModal(false)}
                      className="flex-1 bg-white rounded-lg px-6 sm:px-8 py-3 sm:py-4 transition-all hover:scale-105 shadow-lg border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B365D] font-semibold text-sm sm:text-base min-h-[44px] flex items-center justify-center"
                      style={{ borderColor: "#1B365D", color: "#1B365D" }}
                      aria-label="Close modal"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <Contact />
      </main>
    );
  }
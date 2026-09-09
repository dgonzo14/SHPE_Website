import { Hero } from "../components/Hero";
import { Mission } from "../components/Mission";
import { Vision } from "../components/Vision";
import { Values } from "../components/Values";
import { ExploreMore } from "../components/ExploreMore";
import { History } from "../components/History";
import { Contact } from "../components/Contact";
import { SEOHead } from "../components/SEOHead";
import { Section, SectionHeader } from "@/components/ui/section";
import { OptimizedPicture } from "@/components/OptimizedPicture";
import conImg from "/images/conventionImg.jpeg";
import conImgWebp from "/images/conventionImg.webp";

// NEXT STEPS
// Add favicon
// add subscribe to newsletter option
// update exec board emails photos and linkedin
// why get plugged in change icons
// sponsorship Conference Meal change icon to food
// Get plugged in page add contact
// get plugged in add WUGO link

export function Home() {
  return (
    <>
      <SEOHead
        title="WashU SHPE - Society of Hispanic Professional Engineers | Home"
        description="Welcome to Washington University in St. Louis SHPE. Empowering the Hispanic community in STEM through mentorship, professional development, and community service. Join our familia!"
        keywords="SHPE, WashU, Washington University, Hispanic Engineers, STEM, Engineering, St. Louis, Society of Hispanic Professional Engineers, mentorship, professional development"
      />
      <Hero />

      {/*
        Mission, vision and the convention photograph on one grid.

        Previously this was a bare flex row whose left column was
        `justify-center`, so the two cards floated against a fixed-height image
        and the block's internal alignment changed with the viewport. Now the
        image is a grid child with `h-full`: the row is one rectangle at every
        width, and the cards stretch to meet it instead of hovering inside it.
      */}
      <Section space="lg" aria-labelledby="purpose-heading">
        <SectionHeader
          eyebrow="Who we are"
          title="Why the chapter exists"
          id="purpose-heading"
          lede="SHPE is a national organization with a specific promise. Here is the version of it we are accountable to at WashU."
        />

        <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-2 lg:items-stretch">
          <div className="grid min-w-0 grid-rows-2 gap-5 sm:gap-6">
            <Mission />
            <Vision />
          </div>
          <div className="min-h-[16rem] overflow-hidden border border-shpe-rule lg:min-h-0">
            <OptimizedPicture
              webp={conImgWebp}
              fallback={conImg}
              alt="WashU SHPE members at the 2025 SHPE National Convention"
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      </Section>

      <Values />
      <ExploreMore />
      <History />
      <Contact />
    </>
  );
}

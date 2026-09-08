import { Target } from "lucide-react";

import { StatementCard } from "@/components/ui/section";

export function Mission() {
  return (
    <section aria-labelledby="mission-heading" className="h-full">
      <StatementCard icon={Target} title="Our Mission" id="mission-heading" accent="blue">
        SHPE changes lives by empowering the Hispanic community to realize its fullest potential
        and to impact the world through STEM awareness, access, support, and development.
      </StatementCard>
    </section>
  );
}

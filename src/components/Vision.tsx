import { Eye } from "lucide-react";

import { StatementCard } from "@/components/ui/section";

export function Vision() {
  return (
    <section aria-labelledby="vision-heading" className="h-full">
      <StatementCard icon={Eye} title="Our Vision" id="vision-heading" accent="orange">
        SHPE&rsquo;s vision is a world where Hispanics are highly valued and influential as leading
        innovators, scientists, mathematicians, and engineers.
      </StatementCard>
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Linkedin, Mail, Users } from "lucide-react";

import { Badge, Card, CardBody } from "@/components/ui/primitives";
import { buttonVariants } from "@/components/ui/buttonVariants";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { fetchChapterOfficers } from "@/services/officers";
import { queryKeys } from "@/services/queryKeys";
import { usePageMeta } from "@/hooks/usePageMeta";
import { safeExternalHref } from "@/lib/url";
import type { ChapterOfficer } from "@/types/database";

const CHAPTER_EMAIL = "shpe@wustl.edu";

function officerName(officer: ChapterOfficer): string {
  return `${officer.first_name} ${officer.last_name}`.trim() || "SHPE officer";
}

function OfficerCard({ officer }: { officer: ChapterOfficer }) {
  const name = officerName(officer);
  const email = safeExternalHref(`mailto:${officer.email}`);
  // Stored URLs are checked again at render time; see lib/url.ts.
  const linkedin = safeExternalHref(officer.linkedin_url);
  const details = [
    officer.major,
    officer.graduation_year ? `Class of ${officer.graduation_year}` : null,
  ].filter(Boolean);

  return (
    <Card className="flex h-full flex-col p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-shpe-orange-dark">
        {officer.position}
      </p>
      <h2 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-shpe-navy">
        {name}
        {officer.is_me && <Badge tone="brand">You</Badge>}
      </h2>
      {details.length > 0 && <p className="text-sm text-gray-600">{details.join(" · ")}</p>}

      <div className="mt-4 flex flex-wrap gap-2 pt-1 sm:mt-auto">
        {email && (
          <a
            href={email}
            className={buttonVariants({ variant: "subtle", size: "sm" })}
            aria-label={`Email ${name}, ${officer.position}`}
          >
            <Mail className="h-4 w-4" aria-hidden />
            <span className="break-all">{officer.email}</span>
          </a>
        )}
        {linkedin && (
          <a
            href={linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "subtle", size: "sm" })}
            aria-label={`${name} on LinkedIn (opens in a new tab)`}
          >
            <Linkedin className="h-4 w-4" aria-hidden />
            LinkedIn
          </a>
        )}
      </div>
    </Card>
  );
}

/**
 * The executive board, and how to reach each of them.
 *
 * Who appears here is decided by chapter positions, which an officer sets on a
 * member's page. A position is only a title: it is not what makes someone an
 * officer in the portal, and nothing on this page depends on roles.
 */
export function Officers() {
  usePageMeta({ title: "Meet your officers | My SHPE", noindex: true });

  const officers = useQuery({
    queryKey: queryKeys.officers.board,
    queryFn: fetchChapterOfficers,
  });

  return (
    <>
      <PageHeader
        title="Meet your officers"
        description="The executive board running the chapter this year. Reach out with questions, ideas, or to get involved."
      />

      {officers.isPending ? (
        <>
          <SkeletonList rows={3} />
          <span role="status" className="sr-only">
            Loading officers
          </span>
        </>
      ) : officers.isError ? (
        <ErrorState error={officers.error} onRetry={() => void officers.refetch()} />
      ) : officers.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="The board hasn't been listed yet"
          description={
            <>
              Officers appear here once positions are assigned. Until then, email the
              chapter at <a href={`mailto:${CHAPTER_EMAIL}`}>{CHAPTER_EMAIL}</a>.
            </>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {officers.data.map((officer) => (
            <li key={`${officer.position}-${officer.email}`}>
              <OfficerCard officer={officer} />
            </li>
          ))}
        </ul>
      )}

      <Card className="mt-6">
        <CardBody className="text-sm text-gray-700">
          Not sure who to ask? Email the whole board at{" "}
          <a href={`mailto:${CHAPTER_EMAIL}`} className="font-medium">
            {CHAPTER_EMAIL}
          </a>
          .
        </CardBody>
      </Card>
    </>
  );
}

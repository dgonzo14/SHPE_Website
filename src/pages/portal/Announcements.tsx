import { useQuery } from "@tanstack/react-query";
import { Bell, ExternalLink } from "lucide-react";

import { Badge, Card, CardBody } from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { fetchActiveAnnouncements } from "@/services/content";
import { queryKeys } from "@/services/queryKeys";
import { formatRelative } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { AnnouncementPriority } from "@/types/database";

const PRIORITY_BADGE: Record<AnnouncementPriority, { tone: "neutral" | "warning" | "danger"; label: string }> =
  {
    normal: { tone: "neutral", label: "Announcement" },
    important: { tone: "warning", label: "Important" },
    urgent: { tone: "danger", label: "Urgent" },
  };

export function Announcements() {
  usePageMeta({ title: "Announcements | My SHPE", noindex: true });

  const announcements = useQuery({
    queryKey: queryKeys.announcements.active,
    queryFn: fetchActiveAnnouncements,
  });

  return (
    <>
      <PageHeader title="Announcements" description="Chapter news, in one place." />

      {announcements.isPending ? (
        <>
          <SkeletonList rows={3} />
          <span role="status" className="sr-only">
            Loading announcements
          </span>
        </>
      ) : announcements.isError ? (
        <ErrorState error={announcements.error} onRetry={() => void announcements.refetch()} />
      ) : announcements.data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="New chapter announcements will show up here."
        />
      ) : (
        <ul className="space-y-3">
          {announcements.data.map((announcement) => {
            const badge = PRIORITY_BADGE[announcement.priority];
            return (
              <li key={announcement.id}>
                <Card>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-lg font-semibold text-shpe-navy">
                        {announcement.title}
                      </h2>
                      {/* Priority is always spelled out, never colour alone. */}
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>

                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">
                      {announcement.body}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span>Posted {formatRelative(announcement.published_at)}</span>
                      {announcement.external_url && (
                        <a
                          href={announcement.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-shpe-navy"
                        >
                          Read more
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

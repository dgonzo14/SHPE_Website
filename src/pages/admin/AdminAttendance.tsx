import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";

import { LinkButton } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { fetchEvents } from "@/services/events";
import { queryKeys } from "@/services/queryKeys";
import { formatShortDate, formatTime } from "@/lib/datetime";
import {
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONE,
  eventDisplayStatus,
} from "@/lib/eventStatus";
import { usePageMeta } from "@/hooks/usePageMeta";

/** Pick an event, then work on its roster. */
export function AdminAttendance() {
  usePageMeta({ title: "Attendance | WashU SHPE", noindex: true });

  const filters = { timeframe: "all" as const, statuses: ["published", "completed"], admin: true };

  const events = useQuery({
    queryKey: queryKeys.events.list(filters),
    queryFn: () => fetchEvents({ timeframe: "all", statuses: ["published", "completed"] }),
  });

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Choose an event to review, correct or export its roster."
      />

      {events.isPending ? (
        <SkeletonList rows={5} />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No published events yet"
          description="Publish an event and its attendance roster will appear here."
          action={<LinkButton to="/admin/events/new">Create an event</LinkButton>}
        />
      ) : (
        <ul className="space-y-3">
          {events.data.map((event) => {
            const display = eventDisplayStatus(event);
            return (
              <li key={event.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-shpe-navy">{event.title}</p>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {formatShortDate(event.start_at)} · {formatTime(event.start_at)}
                      {event.category && ` · ${event.category.name}`} · {event.points_value} pts
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={EVENT_STATUS_TONE[display]}>
                      {EVENT_STATUS_LABELS[display]}
                    </Badge>
                    <LinkButton to={`/admin/attendance/${event.id}`} variant="outline" size="sm">
                      Open roster
                    </LinkButton>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

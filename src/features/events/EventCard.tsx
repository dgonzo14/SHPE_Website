import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, MapPin, Trophy } from "lucide-react";

import { Badge, Card } from "@/components/ui/primitives";
import {
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONE,
  eventDisplayStatus,
} from "@/lib/eventStatus";
import { formatShortDate, formatTimeRange } from "@/lib/datetime";
import type { EventWithCategory } from "@/services/events";

/**
 * One event, as it appears in every member-facing list.
 *
 * The whole card is not a link: the title is. That keeps the accessible name of
 * the link meaningful ("Boeing Networking Night") instead of reading out the
 * entire card, and leaves the rest of the card selectable.
 */
export function EventCard({
  event,
  attended = false,
  to,
}: {
  event: EventWithCategory;
  attended?: boolean;
  to?: string;
}) {
  const display = eventDisplayStatus(event);
  const href = to ?? `/portal/events/${event.id}`;

  return (
    <Card className="p-4 transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-shpe-navy">
            <Link to={href} className="no-link-style hover:text-shpe-orange-dark">
              {event.title}
            </Link>
          </h3>
          {event.category && (
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              {event.category.name}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          {attended && (
            <Badge tone="success">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Attended
            </Badge>
          )}
          <Badge tone={EVENT_STATUS_TONE[display]}>{EVENT_STATUS_LABELS[display]}</Badge>
        </div>
      </div>

      <dl className="mt-3 grid gap-1.5 text-sm text-gray-700">
        <div className="flex items-center gap-2">
          <dt className="sr-only">When</dt>
          <CalendarDays className="h-4 w-4 shrink-0 text-shpe-blue" aria-hidden />
          <dd>
            {formatShortDate(event.start_at)} · {formatTimeRange(event.start_at, event.end_at)}
          </dd>
        </div>

        {event.location && (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Where</dt>
            <MapPin className="h-4 w-4 shrink-0 text-shpe-blue" aria-hidden />
            <dd className="truncate">{event.location}</dd>
          </div>
        )}

        {event.points_value > 0 && (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Points</dt>
            <Trophy className="h-4 w-4 shrink-0 text-shpe-gold" aria-hidden />
            <dd className="font-medium text-shpe-navy">
              +{event.points_value} {event.points_value === 1 ? "point" : "points"}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, Download, MapPin, Trophy } from "lucide-react";

import { Button, LinkButton } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { EventCalendar } from "./EventCalendar";
import { fetchPublicEvents, type PublicEvent } from "@/services/publicEvents";
import { isSupabaseConfigured } from "@/lib/supabase";
import { monthLabel, monthRange } from "@/lib/calendar";
import {
  chapterDateKey,
  formatDate,
  formatDateTime,
  formatShortDate,
  formatTimeRange,
  TIMEZONE_LABEL,
} from "@/lib/datetime";
import { downloadIcs, googleCalendarUrl } from "@/lib/ics";
import { useAuth } from "@/auth/useAuth";

/**
 * The public chapter calendar.
 *
 * This is what replaced the embedded Outlook calendar. Officers create events
 * once, in the admin portal, and they appear here, in the member portal, and in
 * the check-in flow — one source of truth instead of two schedules that
 * gradually disagree.
 *
 * Anonymous visitors reach these rows through a column-restricted grant, so
 * everything rendered below is public by construction, not by the client
 * choosing to omit fields.
 */
export function PublicEventsSection({ headingId }: { headingId: string }) {
  const { status } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState({
    year: Number(chapterDateKey(now).slice(0, 4)),
    monthIndex: Number(chapterDateKey(now).slice(5, 7)) - 1,
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<PublicEvent | null>(null);

  const range = useMemo(
    () => monthRange(month.year, month.monthIndex),
    [month.year, month.monthIndex],
  );

  const events = useQuery({
    queryKey: ["public-events", range.from, range.to],
    queryFn: () => fetchPublicEvents(range),
    // The public calendar is read by people who are not signed in; there is no
    // reason to re-fetch it aggressively.
    staleTime: 5 * 60_000,
  });

  const monthEvents = useMemo(() => {
    const all = events.data ?? [];
    const prefix = `${month.year}-${String(month.monthIndex + 1).padStart(2, "0")}`;
    // The fetch is padded a week either side so leading/trailing grid cells are
    // populated; the list below shows only the month being viewed.
    return all.filter((event) => chapterDateKey(event.start_at).startsWith(prefix));
  }, [events.data, month.year, month.monthIndex]);

  const listed = selectedDay
    ? monthEvents.filter((event) => chapterDateKey(event.start_at) === selectedDay)
    : monthEvents;

  const label = monthLabel(month.year, month.monthIndex);

  if (!isSupabaseConfigured) {
    return (
      <Alert tone="info" title="The events calendar isn't connected yet">
        Follow us on Instagram or reach out to <a href="mailto:shpe@wustl.edu">shpe@wustl.edu</a>{" "}
        for what's coming up.
      </Alert>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="h-fit rounded-xl p-4">
        <EventCalendar
          year={month.year}
          monthIndex={month.monthIndex}
          events={events.data ?? []}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onMonthChange={setMonth}
        />
        <p className="mt-3 text-center text-xs text-gray-500">
          All times {TIMEZONE_LABEL} (St. Louis)
        </p>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${headingId}-list`} className="font-semibold text-shpe-navy">
            {selectedDay ? formatDate(`${selectedDay}T12:00:00Z`) : label}
          </h3>
          {selectedDay && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
              Show the whole month
            </Button>
          )}
        </div>

        {events.isPending ? (
          <>
            <SkeletonList rows={3} />
            <span role="status" className="sr-only">
              Loading events
            </span>
          </>
        ) : events.isError ? (
          <ErrorState
            error={events.error}
            onRetry={() => void events.refetch()}
            fallback="We couldn't load the calendar"
          />
        ) : listed.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={
              selectedDay ? "Nothing scheduled that day" : `No events scheduled in ${label}`
            }
            description="Use the arrows above the calendar to look at another month."
          />
        ) : (
          <ul className="space-y-3">
            {listed.map((event) => (
              <li key={event.id}>
                <Card className="rounded-xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-semibold text-shpe-navy">
                        <button
                          type="button"
                          onClick={() => setOpenEvent(event)}
                          className="text-left hover:text-shpe-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
                        >
                          {event.title}
                        </button>
                      </h4>
                      {event.category && (
                        <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                          {event.category.name}
                        </p>
                      )}
                    </div>
                    {/* Status is spelled out, never colour alone. */}
                    {event.status === "cancelled" && <Badge tone="danger">Cancelled</Badge>}
                  </div>

                  <dl className="mt-2 space-y-1 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                      <dt className="sr-only">When</dt>
                      <CalendarDays className="h-4 w-4 shrink-0 text-shpe-blue" aria-hidden />
                      <dd>
                        {formatShortDate(event.start_at)} ·{" "}
                        {formatTimeRange(event.start_at, event.end_at)}
                      </dd>
                    </div>
                    {event.location && (
                      <div className="flex items-center gap-2">
                        <dt className="sr-only">Where</dt>
                        <MapPin className="h-4 w-4 shrink-0 text-shpe-blue" aria-hidden />
                        <dd>{event.location}</dd>
                      </div>
                    )}
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={openEvent !== null}
        onClose={() => setOpenEvent(null)}
        title={openEvent?.title ?? ""}
        description={openEvent?.category?.name}
        footer={
          openEvent && (
            <>
              <LinkButton
                to={googleCalendarUrl({
                  id: openEvent.id,
                  title: openEvent.title,
                  description: openEvent.description,
                  location: openEvent.location,
                  start_at: openEvent.start_at,
                  end_at: openEvent.end_at,
                })}
                external
                variant="outline"
                size="sm"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Google Calendar
              </LinkButton>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadIcs({
                    id: openEvent.id,
                    title: openEvent.title,
                    description: openEvent.description,
                    location: openEvent.location,
                    start_at: openEvent.start_at,
                    end_at: openEvent.end_at,
                  })
                }
              >
                <Download className="h-4 w-4" aria-hidden />
                Download .ics
              </Button>
            </>
          )
        }
      >
        {openEvent && (
          <div className="space-y-4">
            {openEvent.status === "cancelled" && (
              <Alert tone="danger" title="This event was cancelled" />
            )}

            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-semibold text-shpe-navy">When</dt>
                <dd className="text-gray-700">
                  {formatDateTime(openEvent.start_at)} · {TIMEZONE_LABEL}
                </dd>
              </div>
              {openEvent.location && (
                <div>
                  <dt className="font-semibold text-shpe-navy">Where</dt>
                  <dd className="text-gray-700">{openEvent.location}</dd>
                </div>
              )}
              {openEvent.points_value > 0 && (
                <div>
                  <dt className="font-semibold text-shpe-navy">SHPE points</dt>
                  <dd className="flex items-center gap-1.5 text-gray-700">
                    <Trophy className="h-4 w-4 text-shpe-gold" aria-hidden />+
                    {openEvent.points_value} for members who check in
                  </dd>
                </div>
              )}
            </dl>

            {openEvent.description && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">
                {openEvent.description}
              </p>
            )}

            {openEvent.points_value > 0 && status !== "signed-in" && (
              <Alert tone="info">
                Members earn SHPE points by checking in at events.{" "}
                <LinkButton to="/login" variant="ghost" size="sm" className="px-1">
                  Member login
                </LinkButton>
              </Alert>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

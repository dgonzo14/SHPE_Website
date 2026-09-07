import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Download,
  MapPin,
  Trophy,
  User,
} from "lucide-react";

import { Button, LinkButton } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from "@/components/ui/primitives";
import { ErrorState, FullPageLoader, PageHeader } from "@/components/shared/states";
import { fetchEvent, fetchMyAttendedEventIds } from "@/services/events";
import { queryKeys } from "@/services/queryKeys";
import { useCheckIn } from "@/features/attendance/useCheckIn";
import { checkInSchema, type CheckInValues } from "@/lib/validation";
import { checkInErrorMessage, describeError } from "@/lib/errors";
import { formatDateTime, formatTime, formatTimeRange, TIMEZONE_LABEL } from "@/lib/datetime";
import {
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONE,
  eventDisplayStatus,
  isCheckInOpen,
} from "@/lib/eventStatus";
import { downloadIcs, googleCalendarUrl } from "@/lib/ics";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { CheckInSuccess } from "@/types/database";

export function EventDetail() {
  const { eventId = "" } = useParams();
  usePageMeta({ title: "Event | My SHPE", noindex: true });

  const eventQuery = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEvent(eventId),
    enabled: Boolean(eventId),
  });

  const attendedQuery = useQuery({
    queryKey: ["events", "attended", [eventId]],
    queryFn: () => fetchMyAttendedEventIds([eventId]),
    enabled: Boolean(eventId),
  });

  const checkIn = useCheckIn();
  const [success, setSuccess] = useState<CheckInSuccess | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CheckInValues>({
    resolver: zodResolver(checkInSchema),
    defaultValues: { code: "" },
  });

  if (eventQuery.isPending) return <FullPageLoader label="Loading event" />;
  if (eventQuery.isError) {
    return <ErrorState error={eventQuery.error} onRetry={() => void eventQuery.refetch()} />;
  }

  const event = eventQuery.data;
  if (!event) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <h1 className="text-2xl font-bold text-shpe-navy">We couldn't find that event</h1>
        <p className="mt-2 text-gray-600">
          It may have been removed, or the link may be out of date.
        </p>
        <LinkButton to="/portal/events" variant="secondary" className="mt-5">
          Back to events
        </LinkButton>
      </div>
    );
  }

  const display = eventDisplayStatus(event);
  const attended = success != null || (attendedQuery.data?.has(event.id) ?? false);
  const checkInAvailable = isCheckInOpen(event) && !attended;

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      const result = await checkIn.mutateAsync({ code: values.code, eventId: event.id });
      if (result.ok) {
        setSuccess(result);
        reset({ code: "" });
      } else {
        setFailure(checkInErrorMessage(result));
      }
    } catch (error) {
      setFailure(describeError(error, "We couldn't check you in"));
    }
  });

  const calendarEvent = {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    start_at: event.start_at,
    end_at: event.end_at,
  };

  return (
    <>
      <Link
        to="/portal/events"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 no-link-style hover:text-shpe-navy"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All events
      </Link>

      <PageHeader
        title={event.title}
        description={event.category?.name}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {attended && (
              <Badge tone="success">
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                Attended
              </Badge>
            )}
            <Badge tone={EVENT_STATUS_TONE[display]}>{EVENT_STATUS_LABELS[display]}</Badge>
          </div>
        }
      />

      {event.status === "cancelled" && (
        <Alert tone="danger" title="This event was cancelled" className="mb-5">
          No points are awarded and check-in is closed.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardBody className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-2.5">
                  <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-shpe-blue" aria-hidden />
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      When
                    </dt>
                    <dd className="text-sm text-gray-800">
                      {formatDateTime(event.start_at)}
                      <span className="block text-gray-600">
                        {formatTimeRange(event.start_at, event.end_at)} {TIMEZONE_LABEL}
                      </span>
                    </dd>
                  </div>
                </div>

                {event.location && (
                  <div className="flex items-start gap-2.5">
                    <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-shpe-blue" aria-hidden />
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Where
                      </dt>
                      <dd className="text-sm text-gray-800">{event.location}</dd>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2.5">
                  <Trophy className="mt-0.5 h-5 w-5 shrink-0 text-shpe-gold" aria-hidden />
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Points
                    </dt>
                    <dd className="text-sm text-gray-800">
                      {event.points_value > 0
                        ? `+${event.points_value} SHPE points`
                        : "No points for this event"}
                    </dd>
                  </div>
                </div>

                {event.organizer_name && (
                  <div className="flex items-start gap-2.5">
                    <User className="mt-0.5 h-5 w-5 shrink-0 text-shpe-blue" aria-hidden />
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Organiser
                      </dt>
                      <dd className="text-sm text-gray-800">
                        {event.organizer_name}
                        {event.organizer_email && (
                          <a
                            href={`mailto:${event.organizer_email}`}
                            className="block text-shpe-navy"
                          >
                            {event.organizer_email}
                          </a>
                        )}
                      </dd>
                    </div>
                  </div>
                )}
              </dl>

              {event.description && (
                <div className="border-t border-gray-100 pt-4">
                  <h2 className="sr-only">About this event</h2>
                  <p className="max-w-[65ch] whitespace-pre-line break-words text-sm leading-relaxed text-gray-700">
                    {event.description}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add to your calendar</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-wrap gap-2">
              <LinkButton to={googleCalendarUrl(calendarEvent)} external variant="outline" size="sm">
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Google Calendar
              </LinkButton>
              <Button variant="outline" size="sm" onClick={() => downloadIcs(calendarEvent)}>
                <Download className="h-4 w-4" aria-hidden />
                Download .ics
              </Button>
              {event.location && (
                <LinkButton
                  to={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                  external
                  variant="ghost"
                  size="sm"
                >
                  <MapPin className="h-4 w-4" aria-hidden />
                  Get directions
                </LinkButton>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ── Check-in panel ──────────────────────────────────────────── */}
        <div>
          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle>Check in</CardTitle>
            </CardHeader>
            <CardBody>
              {success ? (
                <div role="status" aria-live="polite" className="text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" aria-hidden />
                  <p className="mt-2 font-semibold text-shpe-navy">You're checked in</p>
                  {success.points_awarded > 0 && (
                    <p className="mt-1 text-sm text-gray-700">
                      +{success.points_awarded} points · {success.term_points} total
                    </p>
                  )}
                  <LinkButton to="/portal/points" variant="outline" size="sm" className="mt-4">
                    View my points
                  </LinkButton>
                </div>
              ) : attended ? (
                <div className="text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" aria-hidden />
                  <p className="mt-2 font-semibold text-shpe-navy">Attended</p>
                  {event.points_value > 0 && (
                    <p className="mt-1 text-sm text-gray-700">
                      {event.points_value} points earned
                    </p>
                  )}
                </div>
              ) : checkInAvailable ? (
                <>
                  <form onSubmit={onSubmit} noValidate>
                    <Field label="Event code" required error={errors.code?.message}>
                      {(props) => (
                        <Input
                          {...props}
                          {...register("code")}
                          autoComplete="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          placeholder="NOVA4821"
                          className="text-center text-lg font-bold uppercase tracking-widest"
                        />
                      )}
                    </Field>
                    <Button
                      type="submit"
                      block
                      className="mt-4"
                      loading={isSubmitting || checkIn.isPending}
                    >
                      Check in
                    </Button>
                  </form>
                  <div aria-live="assertive" className="mt-3 empty:mt-0">
                    {failure && (
                      <Alert tone="danger" title={failure.title}>
                        {failure.detail}
                      </Alert>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-600">
                  {display === "upcoming" && event.check_in_opens_at
                    ? `Check-in opens at ${formatTime(event.check_in_opens_at)} on the day of the event.`
                    : display === "ended"
                      ? "Check-in for this event has closed. Ask an officer to add you if you were there."
                      : display === "cancelled"
                        ? "This event was cancelled."
                        : "Check-in isn't open right now."}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

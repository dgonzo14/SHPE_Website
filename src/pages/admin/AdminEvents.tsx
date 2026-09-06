import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, KeyRound, Plus } from "lucide-react";

import { Button, LinkButton } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  Field,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { fetchEvents } from "@/services/events";
import { rotateEventCode } from "@/services/admin";
import { queryKeys } from "@/services/queryKeys";
import { formatShortDate, formatTime } from "@/lib/datetime";
import {
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONE,
  eventDisplayStatus,
} from "@/lib/eventStatus";
import { errorText } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { EventStatus } from "@/types/database";

export function AdminEvents() {
  usePageMeta({ title: "Admin Events | WashU SHPE", noindex: true });

  const toast = useToast();
  const queryClient = useQueryClient();
  const [timeframe, setTimeframe] = useState<"upcoming" | "past" | "all">("upcoming");
  const [status, setStatus] = useState<EventStatus | "">("");
  const [issuedCode, setIssuedCode] = useState<{ title: string; code: string } | null>(null);

  const filters = { timeframe, statuses: status ? [status] : undefined, admin: true };

  const events = useQuery({
    queryKey: queryKeys.events.list(filters),
    queryFn: () => fetchEvents({ timeframe, statuses: status ? [status] : undefined }),
  });

  const rotate = useMutation({
    mutationFn: (input: { eventId: string; title: string }) => rotateEventCode(input.eventId),
    onSuccess: (code, input) => {
      // Shown once, in a dialog. Nothing can read it back afterwards.
      setIssuedCode({ title: input.title, code });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (error) => toast.error("We couldn't generate a code", errorText(error)),
  });

  return (
    <>
      <PageHeader
        title="Events"
        description="Create, publish and manage chapter events."
        actions={
          <LinkButton to="/admin/events/new">
            <Plus className="h-4 w-4" aria-hidden />
            New event
          </LinkButton>
        }
      />

      <Card className="mb-5">
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Timeframe">
            {(props) => (
              <Select
                {...props}
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as typeof timeframe)}
              >
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
                <option value="all">All</option>
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(props) => (
              <Select
                {...props}
                value={status}
                onChange={(e) => setStatus(e.target.value as EventStatus | "")}
              >
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      {events.isPending ? (
        <SkeletonList rows={4} />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No events match these filters"
          description="Create an event to get it on the members' calendar."
          action={<LinkButton to="/admin/events/new">Create an event</LinkButton>}
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block">
            <Table caption="Chapter events with status, date and point value">
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>When</Th>
                  <Th>Status</Th>
                  <Th>Points</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((event) => {
                  const display = eventDisplayStatus(event);
                  return (
                    <tr key={event.id}>
                      <Td>
                        <Link to={`/admin/events/${event.id}`} className="font-medium">
                          {event.title}
                        </Link>
                        {event.category && (
                          <span className="block text-xs text-gray-500">
                            {event.category.name}
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-gray-700">
                        {formatShortDate(event.start_at)}
                        <span className="block text-xs text-gray-500">
                          {formatTime(event.start_at)}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={EVENT_STATUS_TONE[display]}>
                          {EVENT_STATUS_LABELS[display]}
                        </Badge>
                      </Td>
                      <Td className="text-gray-700">{event.points_value}</Td>
                      <Td>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              rotate.mutate({ eventId: event.id, title: event.title })
                            }
                            loading={rotate.isPending && rotate.variables?.eventId === event.id}
                          >
                            <KeyRound className="h-3.5 w-3.5" aria-hidden />
                            Code
                          </Button>
                          <LinkButton
                            to={`/admin/attendance/${event.id}`}
                            variant="ghost"
                            size="sm"
                          >
                            Attendance
                          </LinkButton>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {/* Card layout on phones — a five-column table at 375px is unusable. */}
          <ul className="space-y-3 md:hidden">
            {events.data.map((event) => {
              const display = eventDisplayStatus(event);
              return (
                <li key={event.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link to={`/admin/events/${event.id}`} className="font-semibold">
                        {event.title}
                      </Link>
                      <Badge tone={EVENT_STATUS_TONE[display]}>
                        {EVENT_STATUS_LABELS[display]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {formatShortDate(event.start_at)} · {formatTime(event.start_at)} ·{" "}
                      {event.points_value} pts
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => rotate.mutate({ eventId: event.id, title: event.title })}
                        loading={rotate.isPending && rotate.variables?.eventId === event.id}
                      >
                        <KeyRound className="h-3.5 w-3.5" aria-hidden />
                        Generate code
                      </Button>
                      <LinkButton to={`/admin/attendance/${event.id}`} variant="ghost" size="sm">
                        Attendance
                      </LinkButton>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Dialog
        open={issuedCode !== null}
        onClose={() => setIssuedCode(null)}
        title="Check-in code"
        description={issuedCode?.title}
        size="sm"
        footer={<Button onClick={() => setIssuedCode(null)}>Done</Button>}
      >
        <p
          className="rounded-lg bg-shpe-navy-soft py-6 text-center text-3xl font-bold tracking-[0.2em] text-shpe-navy"
          aria-live="polite"
        >
          {issuedCode?.code}
        </p>
        <Alert tone="warning" className="mt-4">
          Write this down or project it now — only its hash is stored, so this is the one time it
          can be displayed. Generating another code invalidates this one.
        </Alert>
      </Dialog>
    </>
  );
}

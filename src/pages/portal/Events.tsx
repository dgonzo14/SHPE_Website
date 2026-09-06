import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { Card, CardBody, Field, Select } from "@/components/ui/primitives";
import { EventCard } from "@/features/events/EventCard";
import {
  fetchEventCategories,
  fetchEvents,
  fetchMyAttendedEventIds,
} from "@/services/events";
import { queryKeys } from "@/services/queryKeys";
import { useTerms } from "@/hooks/useTerms";
import { cn } from "@/lib/utils";
import { usePageMeta } from "@/hooks/usePageMeta";

type Tab = "upcoming" | "past";

export function Events() {
  usePageMeta({ title: "Events | My SHPE", noindex: true });

  const [tab, setTab] = useState<Tab>("upcoming");
  const [categoryId, setCategoryId] = useState<string>("");
  const [termId, setTermId] = useState<string>("");

  const categories = useQuery({
    queryKey: queryKeys.eventCategories,
    queryFn: fetchEventCategories,
    staleTime: 30 * 60_000,
  });
  const terms = useTerms();

  const filters = {
    timeframe: tab,
    categoryId: categoryId || null,
    termId: termId || null,
    // Members see published, cancelled and completed events — never drafts.
    // RLS enforces the same rule, so this is a UX choice, not the guard.
    statuses: ["published", "cancelled", "completed"] as const,
  };

  const events = useQuery({
    queryKey: queryKeys.events.list(filters),
    queryFn: () => fetchEvents({ ...filters, statuses: [...filters.statuses] }),
  });

  const attended = useQuery({
    queryKey: ["events", "attended", (events.data ?? []).map((e) => e.id)],
    enabled: events.isSuccess && (events.data?.length ?? 0) > 0,
    queryFn: () => fetchMyAttendedEventIds((events.data ?? []).map((e) => e.id)),
  });

  return (
    <>
      <PageHeader
        title="Events"
        description="Everything on the SHPE calendar, and what each one is worth."
      />

      {/* Tabs. Real tab semantics so arrow keys and screen readers behave. */}
      <div
        role="tablist"
        aria-label="Event timeframe"
        className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1"
      >
        {(["upcoming", "past"] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            id={`events-tab-${value}`}
            aria-selected={tab === value}
            aria-controls="events-panel"
            onClick={() => setTab(value)}
            className={cn(
              "min-h-[40px] rounded-md px-4 text-sm font-medium capitalize transition-colors",
              tab === value ? "bg-shpe-navy text-white" : "text-shpe-navy hover:bg-gray-100",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <Card className="mb-5">
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            {(props) => (
              <Select
                {...props}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Term">
            {(props) => (
              <Select {...props} value={termId} onChange={(e) => setTermId(e.target.value)}>
                <option value="">All terms</option>
                {(terms.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      <div
        id="events-panel"
        role="tabpanel"
        aria-labelledby={`events-tab-${tab}`}
        tabIndex={-1}
      >
        {events.isPending ? (
          <>
            <SkeletonList rows={4} />
            <span role="status" className="sr-only">
              Loading events
            </span>
          </>
        ) : events.isError ? (
          <ErrorState error={events.error} onRetry={() => void events.refetch()} />
        ) : (events.data ?? []).length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={
              tab === "upcoming"
                ? "No upcoming SHPE events yet"
                : "No past events match these filters"
            }
            description={
              tab === "upcoming"
                ? "Check back soon for new events, or take a look at the public calendar on the SHPE website."
                : "Try widening the category or term filter."
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {(events.data ?? []).map((event) => (
              <li key={event.id}>
                <EventCard event={event} attended={attended.data?.has(event.id) ?? false} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

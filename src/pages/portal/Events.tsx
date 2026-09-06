import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, LayoutList } from "lucide-react";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Field, Select } from "@/components/ui/primitives";
import { EventCard } from "@/features/events/EventCard";
import { EventCalendar } from "@/features/events/EventCalendar";
import {
  fetchEventCategories,
  fetchEvents,
  fetchMyAttendedEventIds,
} from "@/services/events";
import { queryKeys } from "@/services/queryKeys";
import { useTerms } from "@/hooks/useTerms";
import { monthRange } from "@/lib/calendar";
import { chapterDateKey } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { usePageMeta } from "@/hooks/usePageMeta";

type Tab = "upcoming" | "past";
type ViewMode = "list" | "calendar";

export function Events() {
  usePageMeta({ title: "Events | My SHPE", noindex: true });

  const [tab, setTab] = useState<Tab>("upcoming");
  const [view, setView] = useState<ViewMode>("list");
  const [categoryId, setCategoryId] = useState<string>("");
  const [termId, setTermId] = useState<string>("");

  const todayKey = chapterDateKey(new Date());
  const [month, setMonth] = useState({
    year: Number(todayKey.slice(0, 4)),
    monthIndex: Number(todayKey.slice(5, 7)) - 1,
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: queryKeys.eventCategories,
    queryFn: fetchEventCategories,
    staleTime: 30 * 60_000,
  });
  const terms = useTerms();

  // In calendar mode the window is the month on screen; in list mode it is the
  // upcoming/past split. One query serves both.
  const range = useMemo(
    () => (view === "calendar" ? monthRange(month.year, month.monthIndex) : null),
    [view, month.year, month.monthIndex],
  );

  const filters = {
    timeframe: view === "calendar" ? ("all" as const) : tab,
    range,
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

  /**
   * The calendar fetch is padded a week either side so the leading and trailing
   * grid cells are populated; the list below shows only the month on screen,
   * narrowed further when a day is selected.
   */
  const visibleEvents = useMemo(() => {
    const all = events.data ?? [];
    if (view !== "calendar") return all;

    const prefix = `${month.year}-${String(month.monthIndex + 1).padStart(2, "0")}`;
    const inMonth = all.filter((event) => chapterDateKey(event.start_at).startsWith(prefix));
    return selectedDay
      ? inMonth.filter((event) => chapterDateKey(event.start_at) === selectedDay)
      : inMonth;
  }, [events.data, view, month.year, month.monthIndex, selectedDay]);

  return (
    <>
      <PageHeader
        title="Events"
        description="Everything on the SHPE calendar, and what each one is worth."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant={view === "list" ? "secondary" : "subtle"}
          size="sm"
          onClick={() => setView("list")}
          aria-pressed={view === "list"}
        >
          <LayoutList className="h-4 w-4" aria-hidden />
          List
        </Button>
        <Button
          variant={view === "calendar" ? "secondary" : "subtle"}
          size="sm"
          onClick={() => setView("calendar")}
          aria-pressed={view === "calendar"}
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
          Calendar
        </Button>
      </div>

      {/* Tabs. Real tab semantics so arrow keys and screen readers behave.
          Hidden in calendar mode, where the month itself is the timeframe. */}
      {view === "list" && (
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
      )}

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
              <Select
                {...props}
                value={termId}
                onChange={(e) => setTermId(e.target.value)}
                disabled={view === "calendar"}
              >
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

      {view === "calendar" && (
        <Card className="mb-5">
          <CardBody>
            <EventCalendar
              year={month.year}
              monthIndex={month.monthIndex}
              events={events.data ?? []}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onMonthChange={setMonth}
            />
          </CardBody>
        </Card>
      )}

      <div
        id="events-panel"
        role={view === "list" ? "tabpanel" : undefined}
        aria-labelledby={view === "list" ? `events-tab-${tab}` : undefined}
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
        ) : visibleEvents.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={
              view === "calendar"
                ? selectedDay
                  ? "Nothing scheduled that day"
                  : "No events this month"
                : tab === "upcoming"
                  ? "No upcoming SHPE events yet"
                  : "No past events match these filters"
            }
            description={
              view === "calendar"
                ? "Use the arrows above the calendar to look at another month."
                : tab === "upcoming"
                  ? "Check back soon — new events appear here as officers publish them."
                  : "Try widening the category or term filter."
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {visibleEvents.map((event) => (
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

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  groupByDay,
  monthLabel,
} from "@/lib/calendar";
import { chapterDateKey } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export interface CalendarEventLike {
  id: string;
  title: string;
  start_at: string;
  status: string;
}

/**
 * Month grid for the chapter calendar.
 *
 * Built as a real <table> rather than a div grid: a calendar is tabular data,
 * and a table gives screen readers row/column context ("Thursday, 18") for free
 * that an ARIA grid would have to reimplement.
 *
 * There is exactly one interaction: selecting a day filters the event list that
 * sits below the grid. The cells themselves never try to be a second, smaller
 * list of events — at 375px that is unreadable and untappable, and it would
 * duplicate what the list already says properly.
 */
export function EventCalendar({
  year,
  monthIndex,
  events,
  selectedDay,
  onSelectDay,
  onMonthChange,
}: {
  year: number;
  monthIndex: number;
  events: readonly CalendarEventLike[];
  selectedDay: string | null;
  onSelectDay: (dayKey: string | null) => void;
  onMonthChange: (next: { year: number; monthIndex: number }) => void;
}) {
  const weeks = useMemo(() => buildMonthGrid(year, monthIndex), [year, monthIndex]);
  const byDay = useMemo(
    () => groupByDay(events, (event) => chapterDateKey(event.start_at)),
    [events],
  );
  const todayKey = chapterDateKey(new Date());
  const label = monthLabel(year, monthIndex);

  const step = (delta: number) => {
    const d = new Date(Date.UTC(year, monthIndex + delta, 1));
    onSelectDay(null);
    onMonthChange({ year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => step(-1)}
          aria-label={`Previous month, ${monthLabel(
            new Date(Date.UTC(year, monthIndex - 1, 1)).getUTCFullYear(),
            new Date(Date.UTC(year, monthIndex - 1, 1)).getUTCMonth(),
          )}`}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Button>

        {/* aria-live so paging months is announced, not silent. */}
        <h3 className="text-lg font-semibold text-shpe-navy" aria-live="polite">
          {label}
        </h3>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => step(1)}
          aria-label={`Next month, ${monthLabel(
            new Date(Date.UTC(year, monthIndex + 1, 1)).getUTCFullYear(),
            new Date(Date.UTC(year, monthIndex + 1, 1)).getUTCMonth(),
          )}`}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Button>
      </div>

      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {label}. Days with events are buttons; selecting one filters the list below.
        </caption>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((weekday) => (
              <th
                key={weekday.short}
                scope="col"
                className="pb-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                <span aria-hidden="true">{weekday.short.slice(0, 1)}</span>
                <span className="sr-only">{weekday.long}</span>
                <span className="hidden sm:inline" aria-hidden="true">
                  {weekday.short.slice(1)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].key}>
              {week.map((day) => {
                const dayEvents = byDay.get(day.key) ?? [];
                const isSelected = selectedDay === day.key;
                const isToday = day.key === todayKey;

                if (dayEvents.length === 0) {
                  return (
                    <td key={day.key} className="p-0.5 text-center align-top">
                      <span
                        className={cn(
                          "flex h-11 w-full flex-col items-center justify-center rounded-lg text-sm",
                          day.inMonth ? "text-gray-500" : "text-gray-300",
                          isToday && "font-bold text-shpe-navy ring-1 ring-shpe-blue",
                        )}
                      >
                        {day.day}
                      </span>
                    </td>
                  );
                }

                return (
                  <td key={day.key} className="p-0.5 text-center align-top">
                    <button
                      type="button"
                      onClick={() => onSelectDay(isSelected ? null : day.key)}
                      aria-pressed={isSelected}
                      aria-label={`${day.day} ${label}, ${dayEvents.length} ${
                        dayEvents.length === 1 ? "event" : "events"
                      }`}
                      className={cn(
                        "flex h-11 w-full flex-col items-center justify-center rounded-lg text-sm font-semibold transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shpe-navy",
                        isSelected
                          ? "bg-shpe-navy text-white"
                          : day.inMonth
                            ? "bg-shpe-orange-soft text-shpe-orange-dark hover:bg-shpe-orange hover:text-white"
                            : "bg-gray-100 text-gray-400 hover:bg-gray-200",
                        isToday && !isSelected && "ring-1 ring-shpe-blue",
                      )}
                    >
                      <span aria-hidden="true">{day.day}</span>
                      {/* Count is decorative: the accessible name above already
                          says how many events the day holds. */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 h-1 rounded-full",
                          dayEvents.length > 1 ? "w-3" : "w-1",
                          isSelected ? "bg-white" : "bg-shpe-orange",
                        )}
                      />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useId } from "react";

import { Table, Td, Th } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { CardInsights } from "@/types/database";
import { formatDayLong, formatDayShort, formatWeekday, plural } from "./format";

type Day = CardInsights["daily"][number];

/**
 * Views per day as plain CSS columns: no chart library for one small series.
 *
 * The drawing is decorative to assistive technology (aria-hidden); the same
 * numbers are in a real table under "Show daily numbers", which works for
 * everyone, keyboard users included, and a one-line summary is read with the
 * caption. Columns grow from one baseline with a 2px gap between them, capped
 * at 24px wide, and only animate their height when the member hasn't asked
 * for reduced motion.
 */
export function DailyViewsChart({ daily, days }: { daily: Day[]; days: number }) {
  const captionId = useId();
  const summaryId = useId();
  const max = Math.max(0, ...daily.map((d) => d.views));
  const total = daily.reduce((sum, d) => sum + d.views, 0);
  const busiest = daily.reduce<Day | null>((best, d) => (d.views > (best?.views ?? 0) ? d : best), null);
  const weekly = daily.length <= 7;

  const summary =
    total === 0
      ? `No views in the last ${days} days yet.`
      : `${plural(total, "view")} in the last ${days} days. Busiest day: ${busiest ? `${formatDayLong(busiest.day)}, with ${plural(busiest.views, "view")}` : "none"}.`;

  return (
    <figure aria-labelledby={captionId} aria-describedby={summaryId} className="space-y-3">
      {/* The section heading says this visibly; the caption names the figure. */}
      <figcaption id={captionId} className="sr-only">
        Views per day
      </figcaption>
      <p id={summaryId} className="sr-only">
        {summary}
      </p>

      {total === 0 ? (
        <p className="border border-dashed border-shpe-rule-strong px-4 py-8 text-center text-sm text-gray-600">
          No views in the last {days} days yet. Share your link or QR code and they'll show up here.
        </p>
      ) : (
        <div aria-hidden="true">
          <p className="text-xs tabular-nums text-gray-600">{plural(max, "view")}</p>
          <div className="relative mt-1 flex h-40 items-end gap-[2px] border-b border-t border-b-shpe-rule-strong border-t-shpe-rule">
            {daily.map((d, index) => {
              const share = max > 0 ? d.views / max : 0;
              const align =
                index < daily.length / 3 ? "left-0" : index >= (daily.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2";
              return (
                <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
                  <div
                    data-testid="day-bar"
                    className="w-full max-w-6 bg-shpe-navy group-hover:bg-shpe-orange-dark motion-safe:transition-[height] motion-safe:duration-300"
                    style={{ height: `${share * 100}%`, minHeight: d.views > 0 ? 2 : 0 }}
                  />
                  <span
                    className={cn(
                      "pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap bg-shpe-navy px-2 py-1 text-xs text-white group-hover:block",
                      align,
                    )}
                  >
                    {formatDayShort(d.day)}: {plural(d.views, "view")}
                  </span>
                </div>
              );
            })}
          </div>
          {weekly ? (
            <div className="mt-1 flex gap-[2px] text-xs text-gray-600">
              {daily.map((d) => (
                <span key={d.day} className="min-w-0 flex-1 truncate text-center">
                  {formatWeekday(d.day)}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-1 flex justify-between text-xs text-gray-600">
              <span>{daily[0] ? formatDayShort(daily[0].day) : ""}</span>
              <span>{daily.length > 0 ? formatDayShort(daily[daily.length - 1].day) : ""}</span>
            </div>
          )}
        </div>
      )}

      {daily.length > 0 && (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-shpe-navy underline underline-offset-4 hover:no-underline">
            Show daily numbers
          </summary>
          <div className="mt-2 max-h-80 overflow-y-auto">
            <Table caption={`Views per day, last ${days} days`}>
              <thead>
                <tr>
                  <Th>Day</Th>
                  <Th className="text-right">Views</Th>
                  <Th className="text-right">Contact saves</Th>
                  <Th className="text-right">Shares</Th>
                </tr>
              </thead>
              <tbody>
                {[...daily].reverse().map((d) => (
                  <tr key={d.day}>
                    <Td>{formatDayLong(d.day)}</Td>
                    <Td className="text-right tabular-nums">{d.views}</Td>
                    <Td className="text-right tabular-nums">{d.saves}</Td>
                    <Td className="text-right tabular-nums">{d.shares}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </details>
      )}
    </figure>
  );
}

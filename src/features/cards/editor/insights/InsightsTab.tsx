import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChartColumn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonList, SkeletonStats, StatCard } from "@/components/shared/states";
import { fetchMyCardInsights } from "@/services/cards";
import { queryKeys } from "@/services/queryKeys";
import { cn } from "@/lib/utils";
import type { CardInsights } from "@/types/database";
import { LinkKindIcon } from "../../blocks/LinkKindIcon";
import { linkDisplayLabel } from "../../linkKinds";
import { DesignSection } from "../design/parts";
import { DailyViewsChart } from "./DailyViewsChart";

const RANGES = [7, 30] as const;
type Range = (typeof RANGES)[number];

/**
 * The Insights tab: how the card has been found and used, over the last 7 or
 * 30 days.
 *
 * Counts come from daily counters (get_my_card_insights), never per-visit
 * rows, so there is nothing here about who visited, only how many and how they
 * arrived. The note at the bottom says how views are counted, so a member
 * testing their own card isn't puzzled that the number didn't move.
 */
export function InsightsTab({ hasCard }: { hasCard: boolean }) {
  if (!hasCard) {
    return (
      <EmptyState
        icon={ChartColumn}
        title="No insights yet"
        description="Save and publish your card, then share it. Views, taps, scans and contact saves show up here."
      />
    );
  }
  return <Insights />;
}

function Insights() {
  const [days, setDays] = useState<Range>(30);
  const insights = useQuery({
    queryKey: queryKeys.cards.insights(days),
    queryFn: () => fetchMyCardInsights(days),
    // Keep the last range on screen while the other loads, so the page doesn't
    // collapse to skeletons on every toggle.
    placeholderData: keepPreviousData,
  });

  const rangePicker = (
    <div role="group" aria-label="Time range" className="flex flex-wrap gap-2">
      {RANGES.map((range) => (
        <Button
          key={range}
          variant={days === range ? "secondary" : "subtle"}
          size="sm"
          className="min-h-11"
          aria-pressed={days === range}
          onClick={() => setDays(range)}
        >
          Last {range} days
        </Button>
      ))}
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-semibold text-shpe-navy">Your card's last {days} days</h3>
      {rangePicker}
    </div>
  );

  if (insights.isError && !insights.data) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorState
          error={insights.error}
          fallback="We couldn't load your insights"
          onRetry={() => void insights.refetch()}
        />
      </div>
    );
  }

  if (!insights.data) {
    return (
      <div className="space-y-5">
        {header}
        <SkeletonStats count={6} />
        <SkeletonList rows={2} />
        <span role="status" className="sr-only">
          Loading your insights
        </span>
      </div>
    );
  }

  const data = insights.data;
  const updating = insights.isPlaceholderData;

  return (
    <div className="space-y-6">
      {header}
      <span role="status" className="sr-only">
        {updating ? `Loading the last ${days} days` : ""}
      </span>

      <div aria-busy={updating || undefined} className={cn("space-y-8", updating && "opacity-60")}>
        <Totals totals={data.totals} />

        <DesignSection title="Views per day">
          <DailyViewsChart daily={data.daily} days={data.days} />
        </DesignSection>

        <DesignSection title="Clicks per link" description="Every link on your card, including ones nobody has tapped yet.">
          <LinkClicks links={data.links} days={data.days} />
        </DesignSection>
      </div>

      <p className="text-sm text-gray-600">
        A view counts at most once every 30 minutes for each browser that opens your card, so
        someone reopening it straight away isn't counted twice, and your own visits aren't counted.
        Taps, scans and shared-link visits add up to your views. Days follow Chicago time.
      </p>
    </div>
  );
}

function Totals({ totals }: { totals: CardInsights["totals"] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
      <StatCard label="Views" value={totals.views.toLocaleString("en-US")} hint="All visits to your card" tone="navy" />
      <StatCard label="NFC taps" value={totals.nfc.toLocaleString("en-US")} hint="Views from your chip" tone="orange" />
      <StatCard label="QR scans" value={totals.qr.toLocaleString("en-US")} hint="Views from your QR code" tone="blue" />
      <StatCard
        label="Shared-link visits"
        value={totals.link.toLocaleString("en-US")}
        hint="Views from your link"
        tone="gold"
      />
      <StatCard
        label="Contact saves"
        value={totals.saves.toLocaleString("en-US")}
        hint="Taps on Add to Contacts"
        tone="navy"
      />
      <StatCard label="Shares" value={totals.shares.toLocaleString("en-US")} hint="Visitors who shared your card" tone="orange" />
    </div>
  );
}

function LinkClicks({ links, days }: { links: CardInsights["links"]; days: number }) {
  if (links.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        Your card has no links yet. Add some on the Links tab and their clicks will show up here.
      </p>
    );
  }
  const max = Math.max(1, ...links.map((link) => link.clicks));
  return (
    <Table caption={`Clicks per link, last ${days} days`}>
      <thead>
        <tr>
          <Th>Link</Th>
          <Th className="text-right">Clicks</Th>
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.link_id}>
            <Td>
              <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className="shrink-0 text-shpe-navy">
                  <LinkKindIcon kind={link.kind} className="size-5" />
                </span>
                <span className="min-w-0 truncate font-medium text-shpe-navy">{linkDisplayLabel(link)}</span>
              </span>
            </Td>
            <Td className="w-40 text-right">
              <span className="flex items-center justify-end gap-2">
                <span aria-hidden="true" className="hidden h-2 w-20 bg-shpe-navy-soft sm:block">
                  <span className="block h-full bg-shpe-navy" style={{ width: `${(link.clicks / max) * 100}%` }} />
                </span>
                <span className="w-10 font-semibold tabular-nums text-shpe-navy">{link.clicks.toLocaleString("en-US")}</span>
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

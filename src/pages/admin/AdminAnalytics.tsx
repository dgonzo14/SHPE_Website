import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarDays, ClipboardCheck, Trophy, Users } from "lucide-react";

import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonStats,
  StatCard,
} from "@/components/shared/states";
import { fetchAnalytics } from "@/services/admin";
import { queryKeys } from "@/services/queryKeys";
import { activeTerm } from "@/services/content";
import { useTerms } from "@/hooks/useTerms";
import { formatShortDate } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";

/** Below this, per-event and distribution numbers say more about noise than engagement. */
const MEANINGFUL_SAMPLE = 3;

export function AdminAnalytics() {
  usePageMeta({ title: "Analytics | WashU SHPE", noindex: true });

  const terms = useTerms();
  const [termId, setTermId] = useState<string | null>(null);
  const effectiveTermId =
    termId === null ? (activeTerm(terms.data ?? [])?.id ?? null) : termId || null;
  const termLabel =
    (terms.data ?? []).find((t) => t.id === effectiveTermId)?.name ?? "All time";

  const analytics = useQuery({
    queryKey: queryKeys.admin.analytics(effectiveTermId),
    enabled: terms.isSuccess,
    queryFn: () => fetchAnalytics(effectiveTermId),
  });

  const data = analytics.data;
  const maxCategory = Math.max(
    1,
    ...(data?.attendance_by_category ?? []).map((c) => c.attendee_count),
  );
  const maxBucket = Math.max(1, ...(data?.engagement_buckets ?? []).map((b) => b.member_count));

  return (
    <>
      <PageHeader title="Analytics" description={`Chapter engagement for ${termLabel}.`} />

      <Card className="mb-5">
        <CardBody>
          <Field label="Period">
            {(props) => (
              <Select
                {...props}
                value={effectiveTermId ?? ""}
                onChange={(e) => setTermId(e.target.value)}
              >
                {(terms.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="">All time</option>
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      {analytics.isError ? (
        <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} />
      ) : analytics.isPending || !data ? (
        <>
          <SkeletonStats />
          <span role="status" className="sr-only">
            Loading analytics
          </span>
        </>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Active members"
              value={data.active_members}
              hint={`${data.total_members} accounts`}
              icon={Users}
              tone="navy"
            />
            <StatCard
              label="Events"
              value={data.events_total}
              hint={`${data.events_upcoming} still upcoming`}
              icon={CalendarDays}
              tone="blue"
            />
            <StatCard
              label="Check-ins"
              value={data.attendance_total}
              hint={`Avg ${data.avg_attendance} per past event`}
              icon={ClipboardCheck}
              tone="gold"
            />
            <StatCard
              label="Points awarded"
              value={data.points_awarded}
              hint={termLabel}
              icon={Trophy}
              tone="orange"
            />
          </div>

          {data.attendance_total < MEANINGFUL_SAMPLE && (
            <Alert tone="info" title="Not much data yet">
              With only {data.attendance_total} check-in
              {data.attendance_total === 1 ? "" : "s"} in this period, the breakdowns below are
              too small to read anything into.
            </Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Attendance by category</CardTitle>
              </CardHeader>
              <CardBody>
                {data.attendance_by_category.length === 0 ? (
                  <EmptyState title="No attendance recorded in this period." />
                ) : (
                  <ul className="space-y-3">
                    {data.attendance_by_category.map((row) => (
                      <li key={row.category}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-shpe-navy">{row.category}</span>
                          <span className="text-gray-700">
                            {row.attendee_count} check-in
                            {row.attendee_count === 1 ? "" : "s"}
                            <span className="text-gray-500">
                              {" "}
                              · {row.event_count} {row.event_count === 1 ? "event" : "events"}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-gray-100" aria-hidden>
                          <div
                            className="h-2 rounded-full bg-shpe-blue"
                            style={{
                              width: `${Math.max(4, (row.attendee_count / maxCategory) * 100)}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Engagement distribution</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="mb-3 text-sm text-gray-600">
                  How many members fall in each point range. Deliberately buckets rather than a
                  per-member ranking.
                </p>
                <ul className="space-y-3">
                  {data.engagement_buckets.map((bucket) => (
                    <li key={bucket.label}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-shpe-navy">{bucket.label} points</span>
                        <span className="text-gray-700">
                          {bucket.member_count}{" "}
                          {bucket.member_count === 1 ? "member" : "members"}
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-gray-100" aria-hidden>
                        <div
                          className="h-2 rounded-full bg-shpe-orange"
                          style={{
                            width: `${Math.max(2, (bucket.member_count / maxBucket) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {(
              [
                ["Most attended events", data.most_attended],
                ["Least attended events", data.least_attended],
              ] as const
            ).map(([title, rows]) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle>
                    <span className="inline-flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" aria-hidden />
                      {title}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  {rows.length === 0 ? (
                    <EmptyState title="No completed events in this period." />
                  ) : (
                    <Table caption={`${title} for ${termLabel}`}>
                      <thead>
                        <tr>
                          <Th>Event</Th>
                          <Th>Date</Th>
                          <Th>Attendees</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id}>
                            <Td className="font-medium text-shpe-navy">{row.title}</Td>
                            <Td className="whitespace-nowrap text-gray-700">
                              {formatShortDate(row.start_at)}
                            </Td>
                            <Td className="text-gray-700">{row.attendee_count}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

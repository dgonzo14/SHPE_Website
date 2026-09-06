import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { LinkButton } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Select,
} from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  SkeletonStats,
  StatCard,
} from "@/components/shared/states";
import {
  fetchPointsSummary,
  fetchPointTransactions,
  scopeKey,
} from "@/services/points";
import { queryKeys } from "@/services/queryKeys";
import { useScopeOptions, useTerms } from "@/hooks/useTerms";
import { formatShortDate } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  event_attendance: "Event attendance",
  bonus: "Bonus",
  manual_adjustment: "Manual adjustment",
  correction: "Correction",
  migration: "Imported history",
};

export function Points() {
  usePageMeta({ title: "Points | My SHPE", noindex: true });

  const { user } = useAuth();
  const memberId = user?.id ?? "";
  const terms = useTerms();
  const { options, selectedId, setSelectedId, scope, label } = useScopeOptions(terms.data);
  const key = scopeKey(scope);

  const summary = useQuery({
    queryKey: queryKeys.member.points(memberId, key),
    enabled: Boolean(memberId) && terms.isSuccess,
    queryFn: () => fetchPointsSummary(null, scope),
  });

  const transactions = useQuery({
    queryKey: queryKeys.member.transactions(memberId, key),
    enabled: Boolean(memberId) && terms.isSuccess,
    queryFn: () => fetchPointTransactions(memberId, scope),
  });

  const maxCategoryPoints = Math.max(
    1,
    ...(summary.data?.by_category ?? []).map((c) => Math.abs(c.points)),
  );

  return (
    <>
      <PageHeader title="My SHPE points" description={label} />

      <Card className="mb-5">
        <CardBody>
          <Field label="Show points for">
            {(props) => (
              <Select
                {...props}
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : summary.isPending ? (
        <>
          <SkeletonStats count={3} />
          <span role="status" className="sr-only">
            Loading your points
          </span>
        </>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Total points"
              value={summary.data.total_points}
              hint={label}
              icon={Trophy}
              tone="orange"
            />
            <StatCard
              label="Events attended"
              value={summary.data.events_attended}
              hint={label}
              tone="blue"
            />
            <StatCard
              label="Engagement"
              value={
                summary.data.top_percent ? `Top ${summary.data.top_percent}%` : "—"
              }
              hint={
                summary.data.top_percent
                  ? `Ahead of about ${100 - summary.data.top_percent}% of ${summary.data.ranked_member_count} ranked members`
                  : "Shown once enough members have points this period"
              }
              tone="navy"
            />
          </div>

          {/* ── Category breakdown ─────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Where your points came from</CardTitle>
            </CardHeader>
            <CardBody>
              {summary.data.by_category.length === 0 ? (
                <EmptyState
                  icon={Trophy}
                  title="No points in this period"
                  description="Your SHPE points will appear here after you attend your first eligible event."
                  action={
                    <LinkButton to="/portal/check-in" variant="outline">
                      Check into an event
                    </LinkButton>
                  }
                />
              ) : (
                <ul className="space-y-3">
                  {summary.data.by_category.map((category) => (
                    <li key={category.category}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-shpe-navy">{category.category}</span>
                        <span className="text-gray-700">
                          {category.points} {category.points === 1 ? "point" : "points"}
                          {category.events > 0 && (
                            <span className="text-gray-500">
                              {" "}
                              · {category.events}{" "}
                              {category.events === 1 ? "event" : "events"}
                            </span>
                          )}
                        </span>
                      </div>
                      {/* Decorative bar: the numbers above carry the meaning. */}
                      <div className="mt-1 h-2 w-full rounded-full bg-gray-100" aria-hidden>
                        <div
                          className="h-2 rounded-full bg-shpe-blue"
                          style={{
                            width: `${Math.max(4, (Math.abs(category.points) / maxCategoryPoints) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* ── Ledger ─────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Point history</CardTitle>
            </CardHeader>
            <CardBody>
              {transactions.isPending ? (
                <SkeletonList rows={3} />
              ) : transactions.isError ? (
                <ErrorState
                  error={transactions.error}
                  onRetry={() => void transactions.refetch()}
                />
              ) : transactions.data.length === 0 ? (
                <EmptyState
                  icon={Trophy}
                  title="Nothing here yet"
                  description="Every point you earn or that an officer adjusts shows up here, with the reason."
                />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {transactions.data.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 py-3">
                      <span
                        className={
                          entry.amount >= 0
                            ? "min-w-[3.5rem] shrink-0 font-semibold text-emerald-700"
                            : "min-w-[3.5rem] shrink-0 font-semibold text-red-700"
                        }
                      >
                        {entry.amount >= 0 ? `+${entry.amount}` : entry.amount}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-shpe-navy">
                          {entry.event?.title ?? entry.description ?? "Adjustment"}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {formatShortDate(entry.created_at)}
                          {entry.event?.category?.name && ` · ${entry.event.category.name}`}
                          {entry.transaction_type !== "event_attendance" &&
                            ` · ${TRANSACTION_TYPE_LABELS[entry.transaction_type] ?? entry.transaction_type}`}
                        </span>
                        {entry.event && entry.description && entry.description !== entry.event.title && (
                          <span className="mt-0.5 block text-xs text-gray-600">
                            {entry.description}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

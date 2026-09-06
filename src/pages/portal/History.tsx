import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { History as HistoryIcon, MapPin } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, Field, Select } from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { fetchAttendanceHistory, scopeKey } from "@/services/points";
import { queryKeys } from "@/services/queryKeys";
import { useScopeOptions, useTerms } from "@/hooks/useTerms";
import { formatShortDate } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * History is derived, never duplicated: it is attendance joined to events, so
 * there is no separate table that could drift out of step with the ledger.
 */
export function History() {
  usePageMeta({ title: "History | My SHPE", noindex: true });

  const { user } = useAuth();
  const memberId = user?.id ?? "";
  const terms = useTerms();
  const { options, selectedId, setSelectedId, scope, label } = useScopeOptions(terms.data);
  const [category, setCategory] = useState("");

  const history = useQuery({
    queryKey: queryKeys.member.attendance(memberId, scopeKey(scope)),
    enabled: Boolean(memberId) && terms.isSuccess,
    queryFn: () => fetchAttendanceHistory(memberId, scope),
  });

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const row of history.data ?? []) {
      if (row.event?.category?.name) names.add(row.event.category.name);
    }
    return Array.from(names).sort();
  }, [history.data]);

  const rows = (history.data ?? []).filter(
    (row) => !category || row.event?.category?.name === category,
  );

  return (
    <>
      <PageHeader
        title="Attendance history"
        description="Every SHPE event you've checked into."
      />

      <Card className="mb-5">
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Period">
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
          <Field label="Category">
            {(props) => (
              <Select {...props} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      {history.isPending ? (
        <>
          <SkeletonList rows={4} />
          <span role="status" className="sr-only">
            Loading your history
          </span>
        </>
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="Your event history will appear after your first check-in"
          description={`Nothing recorded for ${label.toLowerCase()} yet.`}
          action={
            <LinkButton to="/portal/check-in" variant="outline">
              Check into an event
            </LinkButton>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-shpe-navy">
                      {row.event ? (
                        <Link
                          to={`/portal/events/${row.event.id}`}
                          className="no-link-style hover:text-shpe-orange-dark"
                        >
                          {row.event.title}
                        </Link>
                      ) : (
                        "Event"
                      )}
                    </h2>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {formatShortDate(row.event?.start_at ?? row.checked_in_at)}
                      {row.event?.category?.name && ` · ${row.event.category.name}`}
                    </p>
                    {row.event?.location && (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">
                        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {row.event.location}
                      </p>
                    )}
                  </div>
                  {(row.event?.points_value ?? 0) > 0 && (
                    <p className="shrink-0 font-semibold text-emerald-700">
                      +{row.event?.points_value} points
                    </p>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

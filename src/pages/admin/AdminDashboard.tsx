import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Trash2 } from "lucide-react";

import { Button, LinkButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/useToast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  SkeletonStats,
  StatCard,
} from "@/components/shared/states";
import {
  auditActionLabel,
  fetchAnalytics,
  fetchAuditLog,
  fetchCheckinAttemptCount,
  fetchRecentAttendance,
  pruneCheckinAttempts,
} from "@/services/admin";
import { memberName } from "@/services/members";
import { queryKeys } from "@/services/queryKeys";
import { activeTerm } from "@/services/content";
import { useTerms } from "@/hooks/useTerms";
import { formatRelative } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";

export function AdminDashboard() {
  usePageMeta({ title: "Admin | WashU SHPE", noindex: true });

  const terms = useTerms();
  const term = activeTerm(terms.data ?? []);
  const termId = term?.id ?? null;

  const analytics = useQuery({
    queryKey: queryKeys.admin.analytics(termId),
    enabled: terms.isSuccess,
    queryFn: () => fetchAnalytics(termId),
  });

  const recent = useQuery({
    queryKey: queryKeys.admin.attendanceFeed,
    queryFn: () => fetchRecentAttendance(8),
  });

  const audit = useQuery({
    queryKey: queryKeys.admin.auditLog({ limit: 8 }),
    queryFn: () => fetchAuditLog({ limit: 8 }),
  });

  return (
    <>
      <PageHeader
        title="Admin overview"
        description={term ? `${term.name} at a glance.` : "Chapter activity at a glance."}
        actions={<LinkButton to="/admin/events/new">Create event</LinkButton>}
      />

      {analytics.isError ? (
        <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} />
      ) : analytics.isPending ? (
        <>
          <SkeletonStats />
          <span role="status" className="sr-only">
            Loading chapter statistics
          </span>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active members"
            value={analytics.data.active_members}
            hint={`${analytics.data.total_members} total accounts`}
            tone="navy"
          />
          <StatCard
            label="Upcoming events"
            value={analytics.data.events_upcoming}
            hint={`${analytics.data.events_total} this term`}
            tone="blue"
          />
          <StatCard
            label="Average attendance"
            value={analytics.data.avg_attendance}
            hint="Per past event this term"
            tone="gold"
          />
          <StatCard
            label="Points awarded"
            value={analytics.data.points_awarded}
            hint={`${analytics.data.attendance_total} check-ins`}
            tone="orange"
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="admin-recent-checkins">
          <Card className="h-full">
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle id="admin-recent-checkins">Recent check-ins</CardTitle>
              <Link to="/admin/attendance" className="inline-flex min-h-[24px] items-center text-sm font-medium">
                Attendance
              </Link>
            </CardHeader>
            <CardBody>
              {recent.isPending ? (
                <SkeletonList rows={3} />
              ) : recent.isError ? (
                <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
              ) : recent.data.length === 0 ? (
                <EmptyState
                  icon={ClipboardCheck}
                  title="No check-ins yet"
                  description="Once a member checks into an event it shows up here."
                />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recent.data.map((row) => (
                    <li key={row.id} className="py-2.5 text-sm">
                      <p className="font-medium text-shpe-navy">
                        {row.member ? memberName(row.member) : "Unknown member"}
                      </p>
                      <p className="text-gray-600">
                        {row.event?.title ?? "Event"} · {formatRelative(row.checked_in_at)}
                        {row.check_in_method !== "code" && ` · ${row.check_in_method}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </section>

        <section aria-labelledby="admin-recent-actions">
          <Card className="h-full">
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle id="admin-recent-actions">Recent administrative activity</CardTitle>
              <Link to="/admin/audit-log" className="inline-flex min-h-[24px] items-center text-sm font-medium">
                Audit log
              </Link>
            </CardHeader>
            <CardBody>
              {audit.isPending ? (
                <SkeletonList rows={3} />
              ) : audit.isError ? (
                <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
              ) : audit.data.length === 0 ? (
                <EmptyState
                  title="Nothing logged yet"
                  description="Role changes, point corrections and code rotations are recorded here."
                />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {audit.data.map((entry) => (
                    <li key={entry.id} className="py-2.5 text-sm">
                      <p className="font-medium text-shpe-navy">
                        {auditActionLabel(entry.action)}
                      </p>
                      <p className="text-gray-600">
                        {entry.actor ? memberName(entry.actor) : "System"} ·{" "}
                        {formatRelative(entry.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </section>
      </div>

      <MaintenanceCard />
    </>
  );
}

/**
 * Retention for the check-in attempt log.
 *
 * Every failed check-in guess writes a row here, so the table is influenced by
 * whoever is typing codes rather than by chapter activity. The migration tries
 * to schedule a weekly prune through pg_cron, but that extension is off by
 * default on Supabase and is off on this project, so the schedule silently did
 * nothing. This button is what actually makes the retention real.
 */
function MaintenanceCard() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const attempts = useQuery({
    queryKey: ["admin", "checkin-attempt-count"],
    queryFn: fetchCheckinAttemptCount,
    staleTime: 60_000,
  });

  const prune = useMutation({
    mutationFn: () => pruneCheckinAttempts(90),
    onSuccess: (deleted) => {
      toast.success(
        deleted === 0
          ? "Nothing to remove — no attempts older than 90 days"
          : `Removed ${deleted} check-in ${deleted === 1 ? "attempt" : "attempts"}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "checkin-attempt-count"] });
    },
    onError: () => toast.error("We couldn't clear the check-in log"),
  });

  return (
    <section aria-labelledby="admin-maintenance" className="mt-6">
      <Card>
        <CardHeader>
          <CardTitle id="admin-maintenance">Maintenance</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[60ch] text-sm text-gray-700">
            The check-in attempt log currently holds{" "}
            <span className="font-semibold tabular-nums">
              {attempts.isPending ? "…" : attempts.data?.toLocaleString()}
            </span>{" "}
            {attempts.data === 1 ? "row" : "rows"}. Clearing entries older than 90 days keeps
            the database within its free-tier limit; recent attempts are kept so officers can
            still investigate a run of failed check-ins.
          </p>
          <Button
            variant="outline"
            onClick={() => prune.mutate()}
            loading={prune.isPending}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Clear entries older than 90 days
          </Button>
        </CardBody>
      </Card>
    </section>
  );
}

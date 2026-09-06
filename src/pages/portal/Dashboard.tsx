import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  MapPin,
  QrCode,
  Trophy,
} from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { LinkButton } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  SkeletonStats,
  StatCard,
} from "@/components/shared/states";
import { fetchDashboard } from "@/services/points";
import { queryKeys } from "@/services/queryKeys";
import { useTerms } from "@/hooks/useTerms";
import { activeTerm } from "@/services/content";
import { formatRelative, formatShortDate, formatTimeRange } from "@/lib/datetime";
import { eventDisplayStatus, EVENT_STATUS_LABELS, EVENT_STATUS_TONE } from "@/lib/eventStatus";
import { usePageMeta } from "@/hooks/usePageMeta";

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Dashboard() {
  usePageMeta({ title: "My SHPE | WashU SHPE", noindex: true });

  const { profile } = useAuth();
  const termsQuery = useTerms();
  const currentTerm = activeTerm(termsQuery.data ?? []);
  const termId = currentTerm?.id ?? null;

  const dashboard = useQuery({
    queryKey: queryKeys.member.dashboard(termId),
    // Waits for the term list so it never asks for "the current term" before
    // knowing what that is.
    enabled: termsQuery.isSuccess,
    queryFn: () => fetchDashboard(termId),
  });

  const firstName = profile?.first_name?.trim();

  if (dashboard.isError) {
    return (
      <>
        <PageHeader title="My SHPE" />
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      </>
    );
  }

  const data = dashboard.data;
  const loading = dashboard.isPending || termsQuery.isPending;

  return (
    <>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        description={
          data?.term ? `Here's where you stand for ${data.term.name}.` : "Here's where you stand."
        }
        actions={
          <LinkButton to="/portal/check-in" size="lg">
            <QrCode className="h-4 w-4" aria-hidden />
            Check into an event
          </LinkButton>
        }
      />

      {loading ? (
        <div className="space-y-6">
          <SkeletonStats count={3} />
          <SkeletonList rows={2} />
          <span role="status" className="sr-only">
            Loading your dashboard
          </span>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* ── Points summary ─────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label={data.term ? data.term.name : "All time"}
              value={`${data.points.total_points} pts`}
              hint={
                data.points.top_percent
                  ? `Top ${data.points.top_percent}% of ranked members`
                  : "Attend an event to start earning"
              }
              icon={Trophy}
              tone="orange"
            />
            <StatCard
              label="Events attended"
              value={data.points.events_attended}
              hint={data.term ? `This ${data.term.name.split(" ")[0].toLowerCase()}` : undefined}
              icon={CalendarDays}
              tone="blue"
            />
            <StatCard
              label="Membership"
              value={
                <span className="capitalize">{data.profile.membership_status}</span>
              }
              hint={`Member since ${formatShortDate(data.profile.member_since)}`}
              icon={CheckCircle2}
              tone="navy"
            />
          </div>

          {/* ── Announcements ──────────────────────────────────────────── */}
          {data.announcements.length > 0 && (
            <section aria-labelledby="dash-announcements">
              <Card>
                <CardHeader className="flex items-center justify-between gap-2">
                  <CardTitle id="dash-announcements">
                    <span className="inline-flex items-center gap-2">
                      <Bell className="h-4 w-4" aria-hidden />
                      Announcements
                    </span>
                  </CardTitle>
                  <Link to="/portal/announcements" className="text-sm font-medium">
                    See all
                  </Link>
                </CardHeader>
                <CardBody className="space-y-3">
                  {data.announcements.map((a) => (
                    <Alert
                      key={a.id}
                      tone={
                        a.priority === "urgent"
                          ? "danger"
                          : a.priority === "important"
                            ? "warning"
                            : "info"
                      }
                      title={a.title}
                    >
                      <p className="whitespace-pre-line">{a.body}</p>
                      {a.external_url && (
                        <a
                          href={a.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block font-medium underline"
                        >
                          Read more
                        </a>
                      )}
                    </Alert>
                  ))}
                </CardBody>
              </Card>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ── Next event ───────────────────────────────────────────── */}
            <section aria-labelledby="dash-next-event">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle id="dash-next-event">Next event</CardTitle>
                </CardHeader>
                <CardBody>
                  {data.next_event ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-lg font-semibold text-shpe-navy">
                            {data.next_event.title}
                          </p>
                          {data.next_event.category && (
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                              {data.next_event.category}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {data.next_event.attended && (
                            <Badge tone="success">
                              <CheckCircle2 className="h-3 w-3" aria-hidden />
                              Attended
                            </Badge>
                          )}
                          <Badge tone={EVENT_STATUS_TONE[eventDisplayStatus(data.next_event)]}>
                            {EVENT_STATUS_LABELS[eventDisplayStatus(data.next_event)]}
                          </Badge>
                        </div>
                      </div>

                      <dl className="space-y-1.5 text-sm text-gray-700">
                        <div className="flex items-center gap-2">
                          <dt className="sr-only">When</dt>
                          <CalendarDays className="h-4 w-4 text-shpe-blue" aria-hidden />
                          <dd>
                            {formatShortDate(data.next_event.start_at)} ·{" "}
                            {formatTimeRange(data.next_event.start_at, data.next_event.end_at)}
                          </dd>
                        </div>
                        {data.next_event.location && (
                          <div className="flex items-center gap-2">
                            <dt className="sr-only">Where</dt>
                            <MapPin className="h-4 w-4 text-shpe-blue" aria-hidden />
                            <dd>{data.next_event.location}</dd>
                          </div>
                        )}
                        {data.next_event.points_value > 0 && (
                          <div className="flex items-center gap-2">
                            <dt className="sr-only">Points</dt>
                            <Trophy className="h-4 w-4 text-shpe-gold" aria-hidden />
                            <dd className="font-medium text-shpe-navy">
                              +{data.next_event.points_value} points
                            </dd>
                          </div>
                        )}
                      </dl>

                      <LinkButton to={`/portal/events/${data.next_event.id}`} variant="outline">
                        View event
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </LinkButton>
                    </div>
                  ) : (
                    <EmptyState
                      icon={CalendarDays}
                      title="No upcoming SHPE events yet"
                      description="Check back soon — new events are posted here as officers publish them."
                      action={
                        <LinkButton to="/portal/events" variant="outline">
                          Browse all events
                        </LinkButton>
                      }
                    />
                  )}
                </CardBody>
              </Card>
            </section>

            {/* ── Recent activity ──────────────────────────────────────── */}
            <section aria-labelledby="dash-recent">
              <Card className="h-full">
                <CardHeader className="flex items-center justify-between gap-2">
                  <CardTitle id="dash-recent">Recent activity</CardTitle>
                  <Link to="/portal/history" className="text-sm font-medium">
                    Full history
                  </Link>
                </CardHeader>
                <CardBody>
                  {data.recent_points.length === 0 ? (
                    <EmptyState
                      icon={Trophy}
                      title="No points yet"
                      description="Your SHPE points will appear here after you check into your first eligible event."
                      action={
                        <LinkButton to="/portal/check-in" variant="outline">
                          Check in
                        </LinkButton>
                      }
                    />
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {data.recent_points.map((entry) => (
                        <li key={entry.id} className="flex items-start gap-3 py-2.5">
                          <span
                            className={
                              entry.amount >= 0
                                ? "min-w-[3.25rem] shrink-0 font-semibold text-emerald-700"
                                : "min-w-[3.25rem] shrink-0 font-semibold text-red-700"
                            }
                          >
                            {entry.amount >= 0 ? `+${entry.amount}` : entry.amount}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-shpe-navy">
                              {entry.title}
                            </span>
                            <span className="block text-xs text-gray-500">
                              {entry.category ?? "Adjustment"} ·{" "}
                              {formatRelative(entry.created_at)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </section>
          </div>

          {/* ── Membership progress (only when the chapter enables it) ──── */}
          {data.membership && (
            <section aria-labelledby="dash-membership">
              <Card>
                <CardHeader>
                  <CardTitle id="dash-membership">
                    Active member requirements — {data.membership.completed} of{" "}
                    {data.membership.total} complete
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  <ul className="space-y-2">
                    {data.membership.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 text-sm">
                        <span aria-hidden className="text-lg leading-none">
                          {item.complete ? "✓" : "○"}
                        </span>
                        <span className="flex-1 text-gray-800">{item.label}</span>
                        <span className="text-gray-600">
                          {item.current} / {item.target}
                          <span className="sr-only">
                            {item.complete ? " — complete" : " — not yet complete"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/portal/membership" className="mt-3 inline-block text-sm font-medium">
                    See membership details
                  </Link>
                </CardBody>
              </Card>
            </section>
          )}
        </div>
      ) : null}
    </>
  );
}

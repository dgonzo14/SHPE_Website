import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ShieldCheck } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  type BadgeTone,
} from "@/components/ui/primitives";
import { ErrorState, PageHeader, SkeletonList } from "@/components/shared/states";
import { fetchDashboard } from "@/services/points";
import { queryKeys } from "@/services/queryKeys";
import { activeTerm } from "@/services/content";
import { useTerms } from "@/hooks/useTerms";
import { formatDate } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { MembershipStatus, NationalMemberStatus } from "@/types/database";

const STATUS_TONE: Record<MembershipStatus, BadgeTone> = {
  active: "success",
  pending: "warning",
  inactive: "neutral",
  alumni: "info",
  suspended: "danger",
};

const NATIONAL_LABEL: Record<NationalMemberStatus, string> = {
  not_provided: "Not provided",
  // Deliberate wording: an unverified claim is never displayed as "verified".
  self_reported: "Self-reported — not yet confirmed",
  verified: "Verified by an officer",
};

export function Membership() {
  usePageMeta({ title: "Membership | My SHPE", noindex: true });

  const { profile } = useAuth();
  const terms = useTerms();
  const termId = activeTerm(terms.data ?? [])?.id ?? null;

  const dashboard = useQuery({
    queryKey: queryKeys.member.dashboard(termId),
    enabled: terms.isSuccess,
    queryFn: () => fetchDashboard(termId),
  });

  return (
    <>
      <PageHeader
        title="SHPE WashU membership"
        description="Your standing with the chapter and with SHPE National."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Chapter membership</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-gray-700">
                <ShieldCheck className="h-4 w-4 text-shpe-blue" aria-hidden />
                Status
              </span>
              {profile ? (
                <Badge tone={STATUS_TONE[profile.membership_status] ?? "neutral"}>
                  <span className="capitalize">{profile.membership_status}</span>
                </Badge>
              ) : (
                <span className="text-sm text-gray-500">—</span>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-700">Member since</span>
              <span className="text-sm font-medium text-shpe-navy">
                {profile ? formatDate(profile.member_since) : "—"}
              </span>
            </div>

            {profile && profile.membership_status !== "active" && (
              <Alert tone="warning" title="Check-in is limited to active members">
                You can still browse events and see your history. Contact a SHPE officer if you
                believe this is incorrect.
              </Alert>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SHPE National</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-gray-700">
                <BadgeCheck className="h-4 w-4 text-shpe-blue" aria-hidden />
                Membership
              </span>
              <span className="text-sm font-medium text-shpe-navy">
                {profile ? NATIONAL_LABEL[profile.shpe_national_member] : "—"}
              </span>
            </div>

            {profile?.shpe_national_member_id && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-700">Member ID</span>
                <span className="text-sm font-medium text-shpe-navy">
                  {profile.shpe_national_member_id}
                </span>
              </div>
            )}

            {profile?.shpe_national_member === "self_reported" && (
              <p className="text-sm text-gray-600">
                An officer confirms National membership against the SHPE roster. Until then this
                stays marked as self-reported — there is no automated check.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Requirements, only if the chapter has configured them ───────── */}
      <div className="mt-5">
        {dashboard.isPending ? (
          <SkeletonList rows={1} />
        ) : dashboard.isError ? (
          <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        ) : dashboard.data.membership ? (
          <Card>
            <CardHeader>
              <CardTitle>
                Active member requirements — {dashboard.data.membership.completed} of{" "}
                {dashboard.data.membership.total} complete
              </CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="space-y-3">
                {dashboard.data.membership.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <span aria-hidden className="text-lg leading-none">
                      {item.complete ? "✓" : "○"}
                    </span>
                    <span className="flex-1 text-sm text-gray-800">{item.label}</span>
                    <span className="text-sm text-gray-600">
                      {item.current} / {item.target}
                      <span className="sr-only">
                        {item.complete ? " — complete" : " — not yet complete"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : (
          <Alert tone="info" title="No membership requirements are set">
            WashU SHPE hasn't defined formal active-member requirements in the portal yet. When
            chapter leadership decides on them, an admin can turn them on and they'll be tracked
            here automatically.
          </Alert>
        )}
      </div>
    </>
  );
}

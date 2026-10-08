import { Eye, EyeOff, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ErrorState, PageHeader, SkeletonList } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { PointsLeaderboard } from "@/features/leaderboard/PointsLeaderboard";
import {
  useLeaderboard,
  useRefreshLeaderboard,
  useSetLeaderboardEnabled,
} from "@/features/leaderboard/useLeaderboard";
import { isLeaderboardBoard } from "@/services/leaderboard";
import { errorText } from "@/lib/errors";
import { formatDateTime, TIMEZONE_LABEL } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * The officer side of the leaderboard: whether members can see it, when it was
 * last rebuilt, and a preview of exactly what they would see.
 *
 * Officer-only because the RPCs say so, not because of this file: both call
 * require_officer() before doing anything, and a member who asks for the board
 * while it is hidden gets the switch position and no rows.
 */
export function AdminLeaderboard() {
  usePageMeta({ title: "Leaderboard | WashU SHPE", noindex: true });

  const toast = useToast();
  // Officers always get the board back, hidden or not, so this one query
  // answers both "is it on" and "how old is it". It shares its cache with the
  // preview's default scope below.
  const status = useLeaderboard("term");
  const setEnabled = useSetLeaderboardEnabled();
  const refresh = useRefreshLeaderboard();

  const toggle = async (next: boolean) => {
    try {
      await setEnabled.mutateAsync(next);
      toast.success(
        next ? "Leaderboard is visible to members" : "Leaderboard is hidden from members",
      );
    } catch (error) {
      toast.error("We couldn't change that", errorText(error));
    }
  };

  const rebuild = async () => {
    try {
      await refresh.mutateAsync();
      toast.success("Leaderboard rebuilt", "It now matches the points ledger.");
    } catch (error) {
      toast.error("We couldn't rebuild the leaderboard", errorText(error));
    }
  };

  const board = isLeaderboardBoard(status.data) ? status.data : null;

  return (
    <>
      <PageHeader
        title="Points leaderboard"
        description="What members see under Leaderboard in My SHPE. Rankings are rebuilt once a day."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Visibility ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Visibility</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {status.isPending ? (
              <SkeletonList rows={1} />
            ) : status.isError ? (
              <ErrorState error={status.error} onRetry={() => void status.refetch()} />
            ) : board ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700">Members can see it</span>
                  {board.enabled ? (
                    <Badge tone="success">Visible</Badge>
                  ) : (
                    <Badge tone="warning">Hidden</Badge>
                  )}
                </div>

                <p className="text-sm text-gray-600">
                  {board.enabled
                    ? "Members see the top 25 by name and points. Only active members with points are ranked, and pending accounts can't see it at all."
                    : "Members see a note that it's hidden, and the Leaderboard link is removed from their menu. Officers can still preview it below."}
                </p>

                <Button
                  variant={board.enabled ? "outline" : "primary"}
                  block
                  loading={setEnabled.isPending}
                  onClick={() => void toggle(!board.enabled)}
                >
                  {board.enabled ? (
                    <>
                      <EyeOff className="h-4 w-4" aria-hidden />
                      Hide from members
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" aria-hidden />
                      Show to members
                    </>
                  )}
                </Button>
              </>
            ) : null}
          </CardBody>
        </Card>

        {/* ── Updates ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Updates</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {status.isPending ? (
              <SkeletonList rows={1} />
            ) : board ? (
              <>
                {/* Stacked: the timestamp is long enough to wrap mid-phrase
                    beside its label in a half-width card. */}
                <div>
                  <p className="text-sm text-gray-700">Last rebuilt</p>
                  <p className="text-sm font-medium text-shpe-navy">
                    {formatDateTime(board.refreshed_at)} {TIMEZONE_LABEL}
                  </p>
                </div>

                <p className="text-sm text-gray-600">
                  The board is a daily snapshot, not a live count. It rebuilds overnight, or the
                  first time anyone opens it after midnight. Rebuild it now if you've just
                  corrected attendance or points and don't want to wait until tomorrow.
                </p>

                <Button
                  variant="outline"
                  block
                  loading={refresh.isPending}
                  onClick={() => void rebuild()}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Rebuild now
                </Button>
              </>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* ── Preview ────────────────────────────────────────────────────── */}
      <section aria-labelledby="leaderboard-preview" className="mt-8">
        <h2 id="leaderboard-preview" className="mb-4 text-xl font-bold text-shpe-navy">
          Preview
        </h2>
        <PointsLeaderboard showHiddenNotice={false} />
      </section>
    </>
  );
}

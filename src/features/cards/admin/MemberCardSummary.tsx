import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, IdCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ErrorState, SkeletonList } from "@/components/shared/states";
import { useAppConfig } from "@/hooks/useAppConfig";
import type { ProfileRow } from "@/types/database";
import { hasCard, isCardLive } from "./adminCardRows";
import { CardStatusBadges, ChipStatus } from "./CardStatus";
import { CreateCardDialog } from "./CreateCardDialog";
import { OldHandles } from "./OldHandles";
import { ReleaseHandleDialog, type ReleaseTarget } from "./ReleaseHandleDialog";
import { useAdminCards } from "./useAdminCards";

/**
 * The business card part of a member's detail page: status, handle, chip, and
 * Create card when they have none.
 *
 * Read from the same admin list as Admin → Business Cards rather than a
 * per-member RPC. It's one small row per member, the two screens share the
 * cache, and it means a card created here shows up there without a refetch
 * of its own.
 */
export function MemberCardSummary({
  member,
}: {
  member: Pick<ProfileRow, "id" | "first_name" | "last_name" | "email" | "membership_status">;
}) {
  const cards = useAdminCards();
  const config = useAppConfig();
  const [createOpen, setCreateOpen] = useState(false);
  const [releaseFor, setReleaseFor] = useState<ReleaseTarget | null>(null);
  // Stable: Dialog re-runs its focus handling whenever onClose changes identity.
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const closeRelease = useCallback(() => setReleaseFor(null), []);

  const row = cards.data?.rows.find((r) => r.member_id === member.id) ?? null;
  const enabled = config.data?.cards_enabled === true;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Business card</CardTitle>
        <Link
          to={`/admin/cards?q=${encodeURIComponent(member.email)}`}
          className="inline-flex min-h-[24px] items-center text-sm font-medium"
        >
          Open in Business Cards
        </Link>
      </CardHeader>
      <CardBody>
        {cards.isPending ? (
          <SkeletonList rows={1} />
        ) : cards.isError ? (
          <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />
        ) : !row ? (
          <Alert tone="info">
            {member.membership_status === "pending"
              ? "Cards are for approved members. Approve their account first."
              : "This member isn't in the business card list yet. Reload the page to check again."}
          </Alert>
        ) : !hasCard(row) ? (
          <div className="space-y-3">
            <CardStatusBadges row={row} />
            <p className="text-sm text-gray-600">
              They haven't opened My Card, and no officer has made one for them. A card you create
              has their name and the school only; they add everything else.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <IdCard className="h-4 w-4" aria-hidden />
              Create card
            </Button>
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-gray-500">Status</dt>
            <dd>
              <CardStatusBadges row={row} />
            </dd>

            <dt className="text-gray-500">Handle</dt>
            <dd className="min-w-0">
              {isCardLive(row, enabled) ? (
                // A router Link, not an external anchor, so a sub-path deploy's
                // base path is kept; target opens it beside this page.
                <Link
                  to={`/card/${encodeURIComponent(row.handle)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[24px] items-center gap-1 break-all font-mono"
                >
                  {row.handle}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">(opens the live card in a new tab)</span>
                </Link>
              ) : (
                <span className="break-all font-mono text-gray-800">{row.handle}</span>
              )}
              <OldHandles
                row={row}
                onRelease={(handle) => setReleaseFor({ row, handle })}
                className="mt-1"
              />
            </dd>

            <dt className="text-gray-500">Chip</dt>
            <dd>
              <ChipStatus row={row} />
            </dd>

            <dt className="text-gray-500">Position</dt>
            <dd className="text-gray-800">{row.position ?? "None"}</dd>

            <dt className="text-gray-500">Views (30 days)</dt>
            <dd className="tabular-nums text-gray-800">{row.views_30d}</dd>
          </dl>
        )}
      </CardBody>

      <CreateCardDialog
        member={createOpen && row ? row : null}
        onClose={closeCreate}
      />
      <ReleaseHandleDialog target={releaseFor} onClose={closeRelease} />
    </Card>
  );
}

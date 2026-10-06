import { useState } from "react";
import { EyeOff, Medal } from "lucide-react";

import { LinkButton } from "@/components/ui/button";
import {
  Alert,
  Badge,
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
  SkeletonList,
  SkeletonStats,
  StatCard,
} from "@/components/shared/states";
import { useLeaderboard } from "@/features/leaderboard/useLeaderboard";
import { isLeaderboardBoard } from "@/services/leaderboard";
import { formatDateTime, TIMEZONE_LABEL } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { LeaderboardBoard, LeaderboardEntry, LeaderboardScope } from "@/types/database";

const SCOPE_OPTIONS: { value: LeaderboardScope; label: string }[] = [
  { value: "term", label: "This term" },
  { value: "academic_year", label: "This academic year" },
  { value: "all_time", label: "All time" },
];

function boardTitle(board: LeaderboardBoard): string {
  if (board.scope === "term") return board.term_name ?? "This term";
  if (board.scope === "academic_year") {
    return board.academic_year ? `${board.academic_year} academic year` : "This academic year";
  }
  return "All time";
}

function EntryRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <tr className={cn(entry.is_me && "bg-shpe-orange-soft")}>
      <Td className="w-16 font-bold tabular-nums text-shpe-navy">{entry.rank}</Td>
      <Td className="font-medium text-shpe-navy">
        <span className="inline-flex flex-wrap items-center gap-2">
          {entry.display_name}
          {entry.is_me && <Badge tone="brand">You</Badge>}
        </span>
      </Td>
      <Td className="text-right font-semibold tabular-nums text-shpe-navy">
        {entry.total_points}
      </Td>
      <Td className="hidden text-right tabular-nums text-gray-700 sm:table-cell">
        {entry.events_attended}
      </Td>
    </tr>
  );
}

/**
 * The chapter's points leaderboard: one board per scope, the caller's own place
 * called out, and an honest note about how old the numbers are.
 *
 * Shared by the member page and the officer preview. Everything about who may
 * see it is decided by get_points_leaderboard(); this only renders the answer.
 * A member asking while it is hidden gets `{ enabled: false }` and nothing else,
 * so there is no board here to accidentally show them.
 */
export function PointsLeaderboard({
  showHiddenNotice = true,
}: {
  /** The member page explains an officer preview; the admin page already says it. */
  showHiddenNotice?: boolean;
}) {
  const [scope, setScope] = useState<LeaderboardScope>("term");
  const leaderboard = useLeaderboard(scope);

  const scopePicker = (
    <Card className="mb-5">
      <CardBody>
        <Field label="Show the board for">
          {(props) => (
            <Select
              {...props}
              value={scope}
              onChange={(e) => setScope(e.target.value as LeaderboardScope)}
            >
              {SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </CardBody>
    </Card>
  );

  if (leaderboard.isError) {
    return (
      <>
        {scopePicker}
        <ErrorState error={leaderboard.error} onRetry={() => void leaderboard.refetch()} />
      </>
    );
  }

  if (leaderboard.isPending) {
    return (
      <>
        {scopePicker}
        <div className="space-y-6">
          <SkeletonStats count={3} />
          <SkeletonList rows={5} />
          <span role="status" className="sr-only">
            Loading the leaderboard
          </span>
        </div>
      </>
    );
  }

  const data = leaderboard.data;

  if (!isLeaderboardBoard(data)) {
    return (
      <EmptyState
        icon={EyeOff}
        title="The leaderboard is hidden right now"
        description="Chapter officers choose when to show it. Your own points are always on My Points."
        action={
          <LinkButton to="/portal/points" variant="outline">
            See my points
          </LinkButton>
        }
      />
    );
  }

  const meOnBoard = data.entries.some((entry) => entry.is_me);

  return (
    <>
      {showHiddenNotice && !data.enabled && (
        <Alert tone="warning" title="Hidden from members" className="mb-5">
          Only officers can see this board right now. Turn it on from Admin › Leaderboard.
        </Alert>
      )}

      {scopePicker}

      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Your place"
            value={data.me ? `#${data.me.rank}` : "—"}
            hint={
              data.me
                ? `Of ${data.ranked_member_count} ranked ${data.ranked_member_count === 1 ? "member" : "members"}`
                : "Earn points at an event to get on the board"
            }
            tone="orange"
          />
          <StatCard
            label="Your points"
            value={data.me?.total_points ?? 0}
            hint={boardTitle(data)}
            tone="blue"
          />
          <StatCard
            label="Ranked members"
            value={data.ranked_member_count}
            hint="Active members with points"
            tone="navy"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{boardTitle(data)}</CardTitle>
          </CardHeader>
          <CardBody>
            {data.entries.length === 0 ? (
              <EmptyState
                icon={Medal}
                title="Nobody is on the board yet"
                description="It fills in as members earn SHPE points at events. Check back tomorrow."
              />
            ) : (
              <Table caption={`Points leaderboard, ${boardTitle(data)}`}>
                <thead>
                  <tr>
                    <Th className="w-16">Rank</Th>
                    <Th>Member</Th>
                    <Th className="text-right">Points</Th>
                    <Th className="hidden text-right sm:table-cell">Events</Th>
                  </tr>
                </thead>
                <tbody>
                  {/* Index, not name: two members can share a name and a rank. */}
                  {data.entries.map((entry, index) => (
                    <EntryRow key={index} entry={entry} />
                  ))}
                  {/* Below the cut-off: the member sees their own place without
                      the rest of the bottom of the board being shown to everyone. */}
                  {data.me && !meOnBoard && (
                    <>
                      <tr aria-hidden="true">
                        <Td colSpan={4} className="h-8 text-center text-gray-500 md:h-8">
                          ⋯
                        </Td>
                      </tr>
                      <EntryRow entry={data.me} />
                    </>
                  )}
                </tbody>
              </Table>
            )}

            <p className="mt-4 text-sm text-gray-600">
              Top {data.top_n} shown. Updated once a day — last on{" "}
              {formatDateTime(data.refreshed_at)} {TIMEZONE_LABEL}. Points you earn today appear
              tomorrow; My Points is always up to date.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

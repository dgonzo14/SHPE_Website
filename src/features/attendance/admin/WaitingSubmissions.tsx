import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge, Card, Table, Td, Th } from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import {
  deleteAttendanceSubmission,
  deleteWaitingSubmissionsBefore,
  type WaitingSubmission,
} from "@/services/attendanceForm";
import { formatDateTime, formatTime } from "@/lib/datetime";
import { errorText } from "@/lib/errors";
import type { EventRow } from "@/types/database";
import { submissionName } from "./labels";
import { LinkSubmissionDialog } from "./LinkSubmissionDialog";
import {
  useAttendanceLink,
  useInvalidateEventAttendance,
  useWaitingSubmissions,
} from "./useAttendanceForm";

/** "1 response", "12 responses". */
function responses(count: number): string {
  return `${count} ${count === 1 ? "response" : "responses"}`;
}

/**
 * Waiting responses that came through the form before the link was last
 * replaced, i.e. through a link that no longer works.
 *
 * The same test the database applies when deleting them (form responses only,
 * submitted before the replacement), so the count on the button is the count
 * that goes. A link that has never been replaced was made before anything
 * could come through it, so nothing qualifies and the button stays away.
 */
function fromReplacedLink(
  rows: readonly WaitingSubmission[],
  linkUpdatedAt: string | null | undefined,
): WaitingSubmission[] {
  if (!linkUpdatedAt) return [];
  const replacedAt = Date.parse(linkUpdatedAt);
  if (Number.isNaN(replacedAt)) return [];
  return rows.filter((row) => row.added_by === null && Date.parse(row.submitted_at) < replacedAt);
}

/**
 * Attendance form responses whose email isn't on any account yet.
 *
 * Most of these sort themselves out: a database trigger checks the person in,
 * points included, the moment an account is created with that email. What an
 * officer does here is the rest. Someone who used a personal address but has
 * an account under their school one is linked by hand; spam is deleted.
 *
 * Deleting is only offered for waiting responses because only those can be
 * deleted. A response already on someone's record is attendance, and comes
 * off the roster the usual way, which also reverses the points.
 *
 * After a leaked link is replaced, whatever was scripted through it is still
 * here, possibly hundreds of rows. Deleting those one by one isn't realistic,
 * so the responses from before the replacement can go in one audited step.
 * Responses an officer typed in are marked, and are never part of that.
 */
export function WaitingSubmissions({
  event,
  checkedInIds,
  className,
}: {
  event: Pick<EventRow, "id" | "title">;
  /** Members already on the roster, so the link dialog can say so. */
  checkedInIds?: ReadonlySet<string>;
  className?: string;
}) {
  const toast = useToast();
  const headingId = useId();
  const waiting = useWaitingSubmissions(event.id);
  const link = useAttendanceLink(event.id);
  const invalidate = useInvalidateEventAttendance(event.id);
  const [linking, setLinking] = useState<WaitingSubmission | null>(null);
  const [deleting, setDeleting] = useState<WaitingSubmission | null>(null);
  // The cut-off the officer is being asked to confirm, taken from the link
  // when the confirmation opens; null while it's closed.
  const [clearBefore, setClearBefore] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (submission: WaitingSubmission) => deleteAttendanceSubmission(submission.id),
    onSuccess: (_data, submission) => {
      setDeleting(null);
      toast.success(
        "Response deleted",
        `${submissionName(submission)} won't be added to the roster, even if an account is created with that email.`,
      );
    },
    onError: (error) => {
      setDeleting(null);
      toast.error("We couldn't delete that response", errorText(error));
    },
    // Also on failure: "that response no longer exists" means another officer
    // got there first, and refetching takes the stale row away.
    onSettled: invalidate,
  });

  const rows = waiting.data ?? [];
  const replacedAt = link.data?.has_link ? link.data.updated_at : null;
  const oldLinkRows = fromReplacedLink(rows, replacedAt);
  const toClear = fromReplacedLink(rows, clearBefore);

  const clear = useMutation({
    // Sent as the replacement time the page showed when the officer opened
    // the confirmation, rather than looked up again by the database or read
    // from the link at the click. The link is re-read every minute, so a
    // further replacement by another officer while the dialog is open would
    // otherwise widen the deletion to responses from the link in between
    // (real people, likely), under a count that changed as they read it.
    mutationFn: (before: string) => deleteWaitingSubmissionsBefore(event.id, before),
    onSuccess: (deleted) => {
      setClearBefore(null);
      if (deleted === 0) {
        toast.info(
          "Nothing left to delete",
          "Those responses were already deleted or matched to accounts, maybe by another officer.",
        );
      } else {
        toast.success(
          `Deleted ${responses(deleted)} from the replaced link`,
          "They won't be added to the roster, even if an account is created with one of those emails.",
        );
      }
    },
    onError: (error) => {
      setClearBefore(null);
      toast.error("We couldn't delete those responses", errorText(error));
    },
    onSettled: invalidate,
  });

  return (
    <section aria-labelledby={headingId} className={className}>
      <div className="mb-3">
        <h2 id={headingId} className="text-[1.25rem] font-medium leading-tight text-shpe-navy">
          Waiting for an account
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm text-gray-600">
          These people used the attendance form, or were added by name, with an email that isn't
          on any SHPE account yet. They're added to the roster, points included, as soon as an
          account is created with that email. If one of them already has an account under a
          different address, link them to it.
        </p>
      </div>

      {oldLinkRows.length > 0 && replacedAt && (
        <div className="mb-4 flex flex-col gap-3 border border-shpe-rule bg-shpe-navy-soft/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[60ch] text-sm text-gray-700">
            {oldLinkRows.length} of these came through the old link, before it was replaced on{" "}
            {formatDateTime(replacedAt)}. If it was replaced because it leaked, you can clear them
            all at once.
          </p>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => setClearBefore(replacedAt)}
            className="shrink-0"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete {responses(oldLinkRows.length)} from the replaced link
          </Button>
        </div>
      )}

      {waiting.isPending ? (
        <SkeletonList rows={2} />
      ) : waiting.isError ? (
        <ErrorState
          error={waiting.error}
          fallback="We couldn't load the waiting responses"
          onRetry={() => void waiting.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nobody is waiting"
          description="Anyone who uses the form with an email that isn't on an account yet will show up here until they make one."
        />
      ) : (
        <>
          <Card className="hidden md:block">
            <Table caption={`Attendance form responses for ${event.title} waiting for an account`}>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Submitted</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Td className="font-medium text-shpe-navy">
                      {submissionName(row)}
                      {row.added_by !== null && <AddedByOfficer className="ml-2" />}
                    </Td>
                    <Td className="break-all text-gray-700">{row.email}</Td>
                    <Td className="whitespace-nowrap text-gray-700">
                      <time dateTime={row.submitted_at} title={formatDateTime(row.submitted_at)}>
                        {formatTime(row.submitted_at)}
                      </time>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <RowActions
                        row={row}
                        onLink={() => setLinking(row)}
                        onDelete={() => setDeleting(row)}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Card className="p-4">
                  <p className="font-semibold text-shpe-navy">{submissionName(row)}</p>
                  {row.added_by !== null && <AddedByOfficer className="mt-1" />}
                  <p className="break-all text-sm text-gray-600">{row.email}</p>
                  <p className="mt-1 text-sm text-gray-600">
                    Submitted{" "}
                    <time dateTime={row.submitted_at}>{formatTime(row.submitted_at)}</time>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <RowActions
                      row={row}
                      onLink={() => setLinking(row)}
                      onDelete={() => setDeleting(row)}
                    />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {linking && (
        <LinkSubmissionDialog
          key={linking.id}
          eventId={event.id}
          submission={linking}
          checkedInIds={checkedInIds}
          onClose={() => setLinking(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        loading={remove.isPending}
        title="Delete this response?"
        description={
          deleting ? (
            <>
              {submissionName(deleting)} (<span className="break-all">{deleting.email}</span>) won't
              be added to the roster, now or when an account is created with that email. Use this
              for spam and mistakes. If they did attend, link them to a member instead.
            </>
          ) : undefined
        }
        confirmLabel="Delete response"
      />

      <ConfirmDialog
        open={clearBefore !== null}
        onClose={() => setClearBefore(null)}
        onConfirm={() => clearBefore && clear.mutate(clearBefore)}
        loading={clear.isPending}
        title={`Delete ${responses(toClear.length)} from the replaced link?`}
        description={
          <>
            <p>
              {toClear.length === 1
                ? "This response came"
                : `These ${toClear.length} responses came`}{" "}
              through the old link before it was replaced. If the old link leaked, this clears
              whatever was scripted through it.
            </p>
            <p className="mt-2">
              Anyone real among them who has no account yet is removed too. They'd need to fill in
              the form again with the new link, or you can add them by name and email.
            </p>
            <p className="mt-2">
              Responses officers typed in, and anyone already on the roster, are kept.
            </p>
          </>
        }
        confirmLabel={`Delete ${responses(toClear.length)}`}
      />
    </section>
  );
}

/**
 * Marks a response an officer entered by name and email, rather than one that
 * came through the form. Those are vouched for, so clearing the replaced
 * link's responses leaves them alone, and the badge says why they stay.
 */
function AddedByOfficer({ className }: { className?: string }) {
  return (
    <Badge tone="info" className={className}>
      Added by an officer
    </Badge>
  );
}

/**
 * The two actions on a row. Each row has the same visible labels, so the
 * person's name is added for screen readers, after the visible text so the
 * spoken name still starts with what's on the button.
 */
function RowActions({
  row,
  onLink,
  onDelete,
}: {
  row: WaitingSubmission;
  onLink: () => void;
  onDelete: () => void;
}) {
  const name = submissionName(row);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onLink}>
        Link to member<span className="sr-only">: {name}</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={onDelete}>
        Delete<span className="sr-only"> response from {name}</span>
      </Button>
    </>
  );
}

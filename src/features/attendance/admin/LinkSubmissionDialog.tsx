import { useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Field, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { linkAttendanceSubmission, type WaitingSubmission } from "@/services/attendanceForm";
import { fetchMembers, memberName, type MemberListRow } from "@/services/members";
import { queryKeys } from "@/services/queryKeys";
import { checkInErrorMessage, errorText } from "@/lib/errors";
import { MEMBERSHIP_STATUSES } from "@/lib/validation";
import { submissionName } from "./labels";
import { useInvalidateEventAttendance } from "./useAttendanceForm";

const STATUS_LABELS = new Map<string, string>(MEMBERSHIP_STATUSES.map((s) => [s.value, s.label]));

/**
 * Puts a waiting form response on a member's record by hand: for the person
 * who typed a personal address into the form but has an account under their
 * school one.
 *
 * The search covers every membership status, not only active members. The
 * form exists to record people before they're members, so the account an
 * officer is looking for is often still pending approval, and the database
 * links a pending account like any other.
 *
 * Mounted only while open, keyed by the response, so each response starts
 * with a fresh search (its last name) and nothing selected.
 */
export function LinkSubmissionDialog({
  eventId,
  submission,
  checkedInIds,
  onClose,
}: {
  eventId: string;
  submission: WaitingSubmission;
  /** Members already on this event's roster, so the list can say so. */
  checkedInIds?: ReadonlySet<string>;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateEventAttendance(eventId);
  const [search, setSearch] = useState(submission.last_name);
  const [selectedId, setSelectedId] = useState("");
  const person = submissionName(submission);

  const filters = { search, status: "all" as const };
  const members = useQuery({
    queryKey: queryKeys.admin.members(filters),
    queryFn: () => fetchMembers(filters),
    // Keeps the list in place while the next keystroke's search loads,
    // rather than flashing an empty select between every letter.
    placeholderData: keepPreviousData,
  });

  const options = members.data ?? [];
  // Looked up in the current results, so a member who has scrolled out of the
  // search can't be linked by a stale selection the select no longer shows.
  const selected = options.find((m) => m.id === selectedId) ?? null;

  const link = useMutation({
    mutationFn: (member: MemberListRow) => linkAttendanceSubmission(submission.id, member.id),
    onSuccess: (result, member) => {
      // Titled by the member, not "<person> is linked to <member>": usually
      // they're the same person under two addresses, and the name twice over
      // reads like a mistake.
      const name = memberName(member);
      if (result.ok) {
        toast.success(
          `Response linked to ${name}`,
          result.points_awarded > 0
            ? `They're on the roster with +${result.points_awarded} points.`
            : "They're on the roster.",
        );
        onClose();
      } else if (result.code === "ALREADY_CHECKED_IN") {
        // Not a failure: the response is on their record now and stops
        // waiting. The member was simply on the roster already (they used the
        // code as well, say), so there were no points left to award.
        toast.success(
          `Response linked to ${name}`,
          `${name} was already on the roster, so no extra points were awarded.`,
        );
        onClose();
      } else {
        const { title, detail } = checkInErrorMessage(result);
        toast.error(title, detail);
      }
    },
    onError: (error) => toast.error("We couldn't link that response", errorText(error)),
    // Also on failure: the usual cause is a stale row (another officer linked
    // or deleted it first), and refetching takes it off the list.
    onSettled: invalidate,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Link to a member"
      description={
        <>
          {person} used the form as <span className="break-all font-medium">{submission.email}</span>.
          Choose their account and the response goes on it with this event's points, as if the
          emails had matched.
        </>
      }
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={link.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => selected && link.mutate(selected)}
            loading={link.isPending}
            disabled={!selected}
          >
            Link response
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Search members" hint="By name, email or major. Includes accounts still pending approval.">
          {(props) => (
            <Input
              {...props}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Start typing a name"
            />
          )}
        </Field>

        <Field label="Member">
          {(props) => (
            <Select {...props} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">Choose a member</option>
              {options.map((m) => {
                const notes = [
                  m.membership_status !== "active"
                    ? (STATUS_LABELS.get(m.membership_status) ?? m.membership_status).toLowerCase()
                    : null,
                  checkedInIds?.has(m.id) ? "already checked in" : null,
                ].filter(Boolean);
                return (
                  <option key={m.id} value={m.id}>
                    {memberName(m)} — {m.email}
                    {notes.length > 0 ? ` (${notes.join(", ")})` : ""}
                  </option>
                );
              })}
            </Select>
          )}
        </Field>

        {members.isError && (
          <Alert tone="danger" title="We couldn't search members">
            {errorText(members.error)}
          </Alert>
        )}
        {members.isSuccess && !members.isPlaceholderData && options.length === 0 && (
          <Alert tone="info">
            No members match that search. If they haven't made an account yet, leave the response
            waiting: it's added when they do.
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

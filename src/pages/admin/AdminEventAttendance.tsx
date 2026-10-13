import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Download, UserPen, UserPlus } from "lucide-react";

import { Button, LinkButton } from "@/components/ui/button";
import {
  Alert,
  Card,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  FullPageLoader,
  PageHeader,
  StatCard,
} from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { fetchEvent, fetchEventAttendance } from "@/services/events";
import { fetchMembers, memberName } from "@/services/members";
import { addAttendance, removeAttendance } from "@/services/admin";
import { queryKeys } from "@/services/queryKeys";
import { csvFilename, downloadCsv } from "@/lib/csv";
import { formatShortDate, formatTime } from "@/lib/datetime";
import { checkInErrorMessage, errorText } from "@/lib/errors";
import { removeAttendanceSchema, type RemoveAttendanceValues } from "@/lib/validation";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { EventAttendee } from "@/services/events";
import { AddByNameDialog } from "@/features/attendance/admin/AddByNameDialog";
import { AttendanceLinkCard } from "@/features/attendance/admin/AttendanceLinkCard";
import { WaitingSubmissions } from "@/features/attendance/admin/WaitingSubmissions";
import { attendanceCsv } from "@/features/attendance/admin/attendanceCsv";
import { rosterIsLive } from "@/features/attendance/admin/attendanceWindow";
import { checkInMethodLabel } from "@/features/attendance/admin/labels";
import {
  LIVE_REFRESH_MS,
  useAttendanceLink,
  useInvalidateEventAttendance,
  useWaitingSubmissions,
} from "@/features/attendance/admin/useAttendanceForm";
import { useNow } from "@/features/attendance/admin/useNow";

export function AdminEventAttendance() {
  const { eventId = "" } = useParams();
  usePageMeta({ title: "Event Attendance | WashU SHPE", noindex: true });

  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [addByNameOpen, setAddByNameOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState("");
  const [removing, setRemoving] = useState<EventAttendee | null>(null);

  const event = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEvent(eventId),
    enabled: Boolean(eventId),
  });

  /*
   * During the check-in window people arrive on the roster and the waiting
   * list by themselves (the code, the form), and an officer at the door
   * watches this page to see who's in. So while the window is open, and
   * briefly after, both refresh every LIVE_REFRESH_MS; react-query skips the
   * interval while the tab is hidden (refetchIntervalInBackground is off by
   * default), so a page left in a background tab costs nothing. Outside the
   * window nothing changes unless an officer changes it, and every action
   * here refreshes what it touched, so there is nothing to poll for. The clock
   * ticks so polling starts and stops on time without a reload.
   */
  const now = useNow();
  const live = event.data ? rosterIsLive(event.data, now) : false;

  const attendance = useQuery({
    queryKey: queryKeys.events.attendance(eventId),
    queryFn: () => fetchEventAttendance(eventId),
    enabled: Boolean(eventId),
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });

  // Shared with the components below through the same query keys, so these
  // are the same requests, not extra ones. The page reads them for the count,
  // the CSV and whether the waiting section is worth showing. This is the
  // waiting list's one polling observer; the link card is the link's.
  const attendanceLink = useAttendanceLink(eventId);
  const waiting = useWaitingSubmissions(eventId, { live });

  const members = useQuery({
    queryKey: queryKeys.admin.members({ search: memberSearch, status: "active" }),
    queryFn: () => fetchMembers({ search: memberSearch, status: "active" }),
    enabled: addOpen,
  });

  const alreadyIn = useMemo(
    () => new Set((attendance.data ?? []).map((a) => a.member_id)),
    [attendance.data],
  );

  const invalidate = useInvalidateEventAttendance(eventId);

  /** From the Add attendee dialog, for the person it turns out has no account. */
  const switchToAddByName = () => {
    setAddOpen(false);
    setAddByNameOpen(true);
  };

  const add = useMutation({
    mutationFn: (memberId: string) => addAttendance(eventId, memberId),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(
          "Attendance added",
          result.points_awarded > 0 ? `+${result.points_awarded} points awarded.` : undefined,
        );
        setAddOpen(false);
        setSelectedMember("");
        invalidate();
      } else {
        const { title, detail } = checkInErrorMessage(result);
        toast.error(title, detail);
      }
    },
    onError: (error) => toast.error("We couldn't add that member", errorText(error)),
  });

  const removeForm = useForm<RemoveAttendanceValues>({
    resolver: zodResolver(removeAttendanceSchema),
    defaultValues: { reason: "" },
  });

  const remove = useMutation({
    mutationFn: (input: { attendanceId: string; reason: string }) =>
      removeAttendance(input.attendanceId, input.reason),
    onSuccess: (result) => {
      toast.success(
        "Attendance removed",
        result.reversed_points !== 0
          ? `${result.reversed_points} points reversed with a correction entry.`
          : undefined,
      );
      setRemoving(null);
      removeForm.reset({ reason: "" });
      invalidate();
    },
    onError: (error) => toast.error("We couldn't remove that record", errorText(error)),
  });

  if (event.isPending) return <FullPageLoader label="Loading event" />;
  if (event.isError) return <ErrorState error={event.error} onRetry={() => void event.refetch()} />;
  if (!event.data) {
    return (
      <EmptyState
        title="We couldn't find that event"
        action={<LinkButton to="/admin/attendance">Back to attendance</LinkButton>}
      />
    );
  }

  const rows = attendance.data ?? [];
  const waitingRows = waiting.data ?? [];
  // Shown once the form is in use for this event: with no link and nobody
  // waiting it would only be an empty box, and the card above explains the
  // form already.
  const showWaiting = waitingRows.length > 0 || attendanceLink.data?.has_link === true;
  // The export is the record of who came, so it waits for the roster and for
  // the waiting list. The two load separately, and exporting with one still
  // in flight (or failed) would hand over a file that quietly leaves out
  // everyone on the other. The waiting list alone may fail without blocking
  // the roster; the officer is told the file is short instead.
  const exportReady = attendance.isSuccess && !waiting.isPending;
  const waitingMissing = waiting.isError && waiting.data === undefined;

  const exportCsv = () => {
    if (!event.data || !exportReady) return;
    downloadCsv(
      csvFilename(event.data.title, "attendance", formatShortDate(event.data.start_at)),
      attendanceCsv(event.data, rows, waitingRows),
    );
    if (waitingMissing) {
      toast.error(
        "Some responses aren't in the export",
        "The form responses waiting for an account didn't load. Reload the page and export again to include them.",
      );
    }
  };

  return (
    <>
      <Link
        to="/admin/attendance"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 no-link-style hover:text-shpe-navy"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All events
      </Link>

      <PageHeader
        title={event.data.title}
        description={`${formatShortDate(event.data.start_at)} · ${formatTime(event.data.start_at)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Add attendee
            </Button>
            <Button variant="outline" onClick={() => setAddByNameOpen(true)}>
              <UserPen className="h-4 w-4" aria-hidden />
              Add by name and email
            </Button>
            <Button
              variant="subtle"
              onClick={exportCsv}
              disabled={!exportReady || rows.length + waitingRows.length === 0}
            >
              <Download className="h-4 w-4" aria-hidden />
              Export CSV
            </Button>
            <LinkButton to={`/admin/events/${eventId}`} variant="ghost">
              Edit event
            </LinkButton>
          </>
        }
      />

      <AttendanceLinkCard event={event.data} className="mb-5" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Checked in" value={rows.length} />
        <StatCard
          label="Waiting for an account"
          value={waiting.isSuccess ? waitingRows.length : "—"}
          hint={waitingRows.length > 0 ? "Added once they make an account" : undefined}
          tone="gold"
        />
        <StatCard label="Points each" value={event.data.points_value} />
        <StatCard
          label="Capacity"
          value={event.data.capacity ?? "—"}
          hint={event.data.capacity ? `${rows.length} of ${event.data.capacity}` : "Not limited"}
        />
      </div>

      {attendance.isPending ? (
        <FullPageLoader label="Loading attendance" />
      ) : attendance.isError ? (
        <ErrorState error={attendance.error} onRetry={() => void attendance.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nobody has checked in yet"
          description="Members appear here as they enter the event code or fill in the attendance form. You can also add someone yourself: a member from their account, or anyone by name and email."
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                Add attendee
              </Button>
              <Button variant="outline" onClick={() => setAddByNameOpen(true)}>
                Add by name and email
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <Card className="hidden md:block">
            <Table caption={`Members who checked into ${event.data.title}`}>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Email</Th>
                  <Th>Checked in</Th>
                  <Th>Method</Th>
                  <Th>Points</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Td className="font-medium text-shpe-navy">
                      {row.member ? (
                        <Link to={`/admin/members/${row.member_id}`}>
                          {memberName(row.member)}
                        </Link>
                      ) : (
                        "Unknown member"
                      )}
                    </Td>
                    <Td className="text-gray-700">{row.member?.email}</Td>
                    <Td className="whitespace-nowrap text-gray-700">
                      {formatTime(row.checked_in_at)}
                    </Td>
                    <Td className="text-gray-700">{checkInMethodLabel(row.check_in_method)}</Td>
                    <Td className="text-gray-700">{event.data?.points_value}</Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(row)}>
                        Remove
                      </Button>
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
                  <p className="font-semibold text-shpe-navy">
                    {row.member ? memberName(row.member) : "Unknown member"}
                  </p>
                  <p className="text-sm text-gray-600">{row.member?.email}</p>
                  <p className="mt-1 text-sm text-gray-600">
                    {formatTime(row.checked_in_at)} · {checkInMethodLabel(row.check_in_method)}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setRemoving(row)}
                  >
                    Remove
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {showWaiting && (
        <WaitingSubmissions event={event.data} checkedInIds={alreadyIn} className="mt-8" />
      )}

      {/* ── Add attendee ─────────────────────────────────────────────── */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add an attendee"
        description="Adds the member and awards this event's points, exactly as a code check-in would."
        footer={
          <>
            <Button variant="subtle" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedMember && add.mutate(selectedMember)}
              loading={add.isPending}
              disabled={!selectedMember}
            >
              Add attendee
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Search members" hint="By name, email or major">
            {(props) => (
              <Input
                {...props}
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Start typing a name"
              />
            )}
          </Field>

          <Field label="Member">
            {(props) => (
              <Select
                {...props}
                value={selectedMember}
                onChange={(e) => setSelectedMember(e.target.value)}
              >
                <option value="">Choose a member</option>
                {(members.data ?? [])
                  .filter((m) => !alreadyIn.has(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {memberName(m)} — {m.email}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          {members.isSuccess && members.data.filter((m) => !alreadyIn.has(m.id)).length === 0 && (
            <Alert tone="info">
              No matching active members who aren't already checked in.
            </Alert>
          )}

          {/* Where an officer looking for a newcomer ends up, so the way to
              add someone without an account is offered right here too. */}
          <p className="text-sm text-gray-600">
            No account yet?{" "}
            <Button variant="ghost" size="sm" className="px-1" onClick={switchToAddByName}>
              Add them by name and email
            </Button>
          </p>
        </div>
      </Dialog>

      {/* ── Add by name and email ────────────────────────────────────── */}
      {addByNameOpen && (
        <AddByNameDialog eventId={eventId} onClose={() => setAddByNameOpen(false)} />
      )}

      {/* ── Remove attendance ────────────────────────────────────────── */}
      <Dialog
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
          removeForm.reset({ reason: "" });
        }}
        title="Remove attendance"
        description={
          removing?.member
            ? `Remove ${memberName(removing.member)}'s attendance for ${event.data.title}? This also posts a correction that reverses the associated points, so their total stays accurate.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button
              variant="subtle"
              onClick={() => {
                setRemoving(null);
                removeForm.reset({ reason: "" });
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={removeForm.handleSubmit((values) => {
                if (removing) {
                  remove.mutate({ attendanceId: removing.id, reason: values.reason });
                }
              })}
            >
              Remove attendance
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          required
          hint="Recorded in the audit log alongside your name."
          error={removeForm.formState.errors.reason?.message}
        >
          {(props) => (
            <Input
              {...props}
              {...removeForm.register("reason")}
              placeholder="Checked in by mistake"
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}

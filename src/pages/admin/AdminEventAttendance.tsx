import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Download, UserPlus } from "lucide-react";

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
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv";
import { formatDateTime, formatShortDate, formatTime } from "@/lib/datetime";
import { checkInErrorMessage, errorText } from "@/lib/errors";
import { removeAttendanceSchema, type RemoveAttendanceValues } from "@/lib/validation";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { EventAttendee } from "@/services/events";

export function AdminEventAttendance() {
  const { eventId = "" } = useParams();
  usePageMeta({ title: "Event Attendance | WashU SHPE", noindex: true });

  const toast = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState("");
  const [removing, setRemoving] = useState<EventAttendee | null>(null);

  const event = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEvent(eventId),
    enabled: Boolean(eventId),
  });

  const attendance = useQuery({
    queryKey: queryKeys.events.attendance(eventId),
    queryFn: () => fetchEventAttendance(eventId),
    enabled: Boolean(eventId),
  });

  const members = useQuery({
    queryKey: queryKeys.admin.members({ search: memberSearch, status: "active" }),
    queryFn: () => fetchMembers({ search: memberSearch, status: "active" }),
    enabled: addOpen,
  });

  const alreadyIn = useMemo(
    () => new Set((attendance.data ?? []).map((a) => a.member_id)),
    [attendance.data],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.events.attendance(eventId) });
    void queryClient.invalidateQueries({ queryKey: ["member"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.attendanceFeed });
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

  const exportCsv = () => {
    const csv = toCsv(rows, [
      { header: "Member name", value: (r) => (r.member ? memberName(r.member) : "") },
      { header: "Email", value: (r) => r.member?.email ?? "" },
      { header: "Major", value: (r) => r.member?.major ?? "" },
      { header: "Graduation year", value: (r) => r.member?.graduation_year ?? "" },
      { header: "Event", value: () => event.data?.title ?? "" },
      { header: "Category", value: () => event.data?.category?.name ?? "" },
      { header: "Checked in at", value: (r) => formatDateTime(r.checked_in_at) },
      { header: "Check-in method", value: (r) => r.check_in_method },
      { header: "Points awarded", value: () => event.data?.points_value ?? 0 },
    ]);
    downloadCsv(
      csvFilename(event.data?.title, "attendance", formatShortDate(event.data?.start_at)),
      csv,
    );
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
            <Button variant="subtle" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" aria-hidden />
              Export CSV
            </Button>
            <LinkButton to={`/admin/events/${eventId}`} variant="ghost">
              Edit event
            </LinkButton>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Checked in" value={rows.length} />
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
          description="Members appear here as they enter the event code. You can also add someone manually."
          action={
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              Add attendee
            </Button>
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
                    <Td className="capitalize text-gray-700">{row.check_in_method}</Td>
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
                    {formatTime(row.checked_in_at)} · {row.check_in_method}
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
        </div>
      </Dialog>

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

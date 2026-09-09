import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Trash2 } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  FullPageLoader,
  PageHeader,
  StatCard,
} from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import {
  deleteMember,
  fetchProfile,
  fetchRoles,
  memberName,
  setMemberRole,
  setMembershipStatus,
  setNationalStatus,
} from "@/services/members";
import { adjustPoints } from "@/services/admin";
import {
  fetchAttendanceHistory,
  fetchPointsSummary,
  fetchPointTransactions,
  scopeKey,
} from "@/services/points";
import { queryKeys } from "@/services/queryKeys";
import { activeTerm } from "@/services/content";
import { useScopeOptions, useTerms } from "@/hooks/useTerms";
import { formatDate, formatShortDate } from "@/lib/datetime";
import { errorText } from "@/lib/errors";
import {
  MEMBERSHIP_STATUSES,
  NATIONAL_MEMBER_STATUSES,
  pointAdjustmentSchema,
  type PointAdjustmentValues,
} from "@/lib/validation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cn } from "@/lib/utils";
import type {
  AppRole,
  MembershipStatus,
  NationalMemberStatus,
} from "@/types/database";

type Tab = "attendance" | "points" | "admin";

export function AdminMemberDetail() {
  const { memberId = "" } = useParams();
  usePageMeta({ title: "Member | WashU SHPE", noindex: true });

  const { isAdmin, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const terms = useTerms();
  const { options, selectedId, setSelectedId, scope, label } = useScopeOptions(terms.data);
  const [tab, setTab] = useState<Tab>("attendance");
  const [pendingRole, setPendingRole] = useState<{ role: AppRole; grant: boolean } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Typed back by the admin to arm the delete. Deliberately not a checkbox: the
  // point is to make them read which account they are about to destroy.
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const navigate = useNavigate();

  const profile = useQuery({
    queryKey: queryKeys.member.profile(memberId),
    queryFn: () => fetchProfile(memberId),
    enabled: Boolean(memberId),
  });

  const roles = useQuery({
    queryKey: queryKeys.member.roles(memberId),
    queryFn: () => fetchRoles(memberId),
    enabled: Boolean(memberId),
  });

  const summary = useQuery({
    queryKey: queryKeys.member.points(memberId, scopeKey(scope)),
    queryFn: () => fetchPointsSummary(memberId, scope),
    enabled: Boolean(memberId) && terms.isSuccess,
  });

  const attendance = useQuery({
    queryKey: queryKeys.member.attendance(memberId, scopeKey(scope)),
    queryFn: () => fetchAttendanceHistory(memberId, scope),
    enabled: Boolean(memberId) && terms.isSuccess && tab === "attendance",
  });

  const ledger = useQuery({
    queryKey: queryKeys.member.transactions(memberId, scopeKey(scope)),
    queryFn: () => fetchPointTransactions(memberId, scope),
    enabled: Boolean(memberId) && terms.isSuccess && tab === "points",
  });

  const refreshMember = () => {
    void queryClient.invalidateQueries({ queryKey: ["member"] });
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: MembershipStatus) => setMembershipStatus(memberId, status),
    onSuccess: () => {
      toast.success("Membership status updated");
      refreshMember();
    },
    onError: (error) => toast.error("We couldn't update the status", errorText(error)),
  });

  const nationalMutation = useMutation({
    mutationFn: (status: NationalMemberStatus) => setNationalStatus(memberId, status),
    onSuccess: () => {
      toast.success("SHPE National status updated");
      refreshMember();
    },
    onError: (error) => toast.error("We couldn't update that", errorText(error)),
  });

  const roleMutation = useMutation({
    mutationFn: (input: { role: AppRole; grant: boolean }) =>
      setMemberRole(memberId, input.role, input.grant),
    onSuccess: (_data, input) => {
      toast.success(input.grant ? `${input.role} role granted` : `${input.role} role removed`);
      setPendingRole(null);
      refreshMember();
    },
    onError: (error) => {
      setPendingRole(null);
      toast.error("We couldn't change that role", errorText(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMember(memberId),
    onSuccess: (result) => {
      /*
       * Reported rather than a bare "deleted", because the cascade is the part
       * an admin cannot see coming: removing a member who attended events
       * lowers those events' attendance counts retroactively.
       */
      const lost = [
        result.attendance_removed > 0 && `${result.attendance_removed} attendance records`,
        result.point_transactions_removed > 0 &&
          `${result.point_transactions_removed} point entries`,
      ].filter(Boolean) as string[];

      toast.success(
        `${result.email} deleted`,
        lost.length > 0 ? `Also removed ${lost.join(" and ")}.` : undefined,
      );
      setDeleteOpen(false);
      refreshMember();
      navigate("/admin/members", { replace: true });
    },
    onError: (error) => toast.error("We couldn't delete this member", errorText(error)),
  });

  const adjustForm = useForm<PointAdjustmentValues>({
    resolver: zodResolver(pointAdjustmentSchema),
    defaultValues: { amount: 0, reason: "" },
  });

  const adjust = useMutation({
    mutationFn: (values: PointAdjustmentValues) =>
      adjustPoints({
        memberId,
        amount: values.amount,
        reason: values.reason,
        termId: activeTerm(terms.data ?? [])?.id ?? null,
      }),
    onSuccess: (result) => {
      toast.success(
        "Points adjusted",
        `${result.previous_total} → ${result.new_total} for the current term.`,
      );
      adjustForm.reset({ amount: 0, reason: "" });
      refreshMember();
    },
    onError: (error) => toast.error("We couldn't adjust points", errorText(error)),
  });

  if (profile.isPending) return <FullPageLoader label="Loading member" />;
  if (profile.isError) {
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  }
  if (!profile.data) {
    return <EmptyState title="We couldn't find that member" />;
  }

  const member = profile.data;
  const memberRoles = roles.data ?? [];
  const isSelf = user?.id === memberId;

  return (
    <>
      <Link
        to="/admin/members"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 no-link-style hover:text-shpe-navy"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All members
      </Link>

      <PageHeader
        title={memberName(member)}
        description={
          [member.major, member.graduation_year && `Class of ${member.graduation_year}`]
            .filter(Boolean)
            .join(" · ") || member.email
        }
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={member.membership_status === "active" ? "success" : "neutral"}>
              <span className="capitalize">{member.membership_status}</span>
            </Badge>
            {memberRoles
              .filter((r) => r !== "member")
              .map((r) => (
                <Badge key={r} tone="brand">
                  <span className="capitalize">{r}</span>
                </Badge>
              ))}
          </div>
        }
      />

      <Card className="mb-5">
        <CardBody>
          <Field label="Period">
            {(props) => (
              <Select
                {...props}
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Points" value={summary.data?.total_points ?? "—"} hint={label} />
        <StatCard label="Events" value={summary.data?.events_attended ?? "—"} hint={label} />
        <StatCard label="Member since" value={formatDate(member.member_since)} />
      </div>

      {/* Tabs keep the initial view readable instead of dumping every record. */}
      <div
        role="tablist"
        aria-label="Member records"
        className="mb-4 inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-1"
      >
        {(
          [
            ["attendance", "Attendance"],
            ["points", "Point ledger"],
            ["admin", "Administration"],
          ] as [Tab, string][]
        ).map(([value, labelText]) => (
          <button
            key={value}
            role="tab"
            type="button"
            id={`member-tab-${value}`}
            aria-selected={tab === value}
            aria-controls="member-panel"
            onClick={() => setTab(value)}
            className={cn(
              "min-h-[40px] rounded-md px-4 text-sm font-medium transition-colors",
              tab === value ? "bg-shpe-navy text-white" : "text-shpe-navy hover:bg-gray-100",
            )}
          >
            {labelText}
          </button>
        ))}
      </div>

      <div id="member-panel" role="tabpanel" aria-labelledby={`member-tab-${tab}`} tabIndex={-1}>
        {tab === "attendance" && (
          <Card>
            <CardBody>
              {attendance.isPending ? (
                <FullPageLoader label="Loading attendance" />
              ) : attendance.data?.length === 0 ? (
                <EmptyState title="No attendance in this period" />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {(attendance.data ?? []).map((row) => (
                    <li key={row.id} className="flex items-start justify-between gap-3 py-3">
                      <span className="min-w-0">
                        <span className="block font-medium text-shpe-navy">
                          {row.event?.title ?? "Event"}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {formatShortDate(row.event?.start_at ?? row.checked_in_at)}
                          {row.event?.category?.name && ` · ${row.event.category.name}`}
                          {` · ${row.check_in_method}`}
                        </span>
                      </span>
                      {(row.event?.points_value ?? 0) > 0 && (
                        <span className="shrink-0 font-semibold text-emerald-700">
                          +{row.event?.points_value}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        )}

        {tab === "points" && (
          <Card>
            <CardBody>
              {ledger.isPending ? (
                <FullPageLoader label="Loading ledger" />
              ) : ledger.data?.length === 0 ? (
                <EmptyState title="No point transactions in this period" />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {(ledger.data ?? []).map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 py-3">
                      <span
                        className={cn(
                          "min-w-[3.5rem] shrink-0 font-semibold",
                          entry.amount >= 0 ? "text-emerald-700" : "text-red-700",
                        )}
                      >
                        {entry.amount >= 0 ? `+${entry.amount}` : entry.amount}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-shpe-navy">
                          {entry.event?.title ?? entry.description ?? "Adjustment"}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {formatShortDate(entry.created_at)} ·{" "}
                          {entry.transaction_type.replace(/_/g, " ")}
                        </span>
                        {entry.event && entry.description && (
                          <span className="mt-0.5 block text-xs text-gray-600">
                            {entry.description}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        )}

        {tab === "admin" && (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Membership</CardTitle>
              </CardHeader>
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Chapter status"
                  hint="History is always preserved — this only affects what they can do next."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={member.membership_status}
                      disabled={statusMutation.isPending}
                      onChange={(e) =>
                        statusMutation.mutate(e.target.value as MembershipStatus)
                      }
                    >
                      {MEMBERSHIP_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field
                  label="SHPE National"
                  hint="Verify against the National roster before selecting Verified."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={member.shpe_national_member}
                      disabled={nationalMutation.isPending}
                      onChange={(e) =>
                        nationalMutation.mutate(e.target.value as NationalMemberStatus)
                      }
                    >
                      {NATIONAL_MEMBER_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Roles</CardTitle>
              </CardHeader>
              <CardBody>
                {!isAdmin ? (
                  <Alert tone="info">
                    Only chapter admins can change roles. Ask an admin if this member needs
                    officer access.
                  </Alert>
                ) : (
                  <ul className="space-y-2">
                    {(["officer", "admin"] as AppRole[]).map((role) => {
                      const has = memberRoles.includes(role);
                      const blockSelfDemotion = isSelf && role === "admin" && has;
                      return (
                        <li
                          key={role}
                          className="flex flex-wrap items-center justify-between gap-3"
                        >
                          <span className="text-sm">
                            <span className="font-medium capitalize text-shpe-navy">{role}</span>
                            <span className="block text-xs text-gray-500">
                              {role === "officer"
                                ? "Manage events, attendance, points, announcements and resources."
                                : "Everything an officer can do, plus role management and settings."}
                            </span>
                          </span>
                          <Button
                            variant={has ? "outline" : "primary"}
                            size="sm"
                            disabled={blockSelfDemotion}
                            onClick={() => setPendingRole({ role, grant: !has })}
                          >
                            {has ? "Remove" : "Grant"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {isSelf && isAdmin && (
                  <p className="mt-3 text-xs text-gray-500">
                    You can't remove your own admin role — that would lock the chapter out of its
                    own portal.
                  </p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Adjust points</CardTitle>
              </CardHeader>
              <CardBody>
                <form
                  onSubmit={adjustForm.handleSubmit((values) => adjust.mutate(values))}
                  className="space-y-4"
                  noValidate
                >
                  <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                    <Field
                      label="Adjustment"
                      required
                      hint="Negative to deduct"
                      error={adjustForm.formState.errors.amount?.message}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          {...adjustForm.register("amount", { valueAsNumber: true })}
                          type="number"
                          inputMode="numeric"
                        />
                      )}
                    </Field>
                    <Field
                      label="Reason"
                      required
                      hint="Recorded in the audit log with your name and the time."
                      error={adjustForm.formState.errors.reason?.message}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          {...adjustForm.register("reason")}
                          placeholder="Volunteer bonus"
                        />
                      )}
                    </Field>
                  </div>
                  <Button type="submit" loading={adjust.isPending}>
                    Save adjustment
                  </Button>
                  <p className="text-xs text-gray-500">
                    Adjustments are new ledger entries applied to the current term. Existing
                    history is never edited.
                  </p>
                </form>
              </CardBody>
            </Card>

            {/*
              Admin only, and hidden from the admin's own page. The database
              refuses both cases anyway -- admin_delete_member() calls
              require_admin() and rejects self-deletion -- so this is about not
              offering a button that can only fail.
            */}
            {isAdmin && member.id !== user?.id && (
              <Card className="border-red-200">
                <CardHeader>
                  <CardTitle className="text-red-700">Delete this member</CardTitle>
                </CardHeader>
                <CardBody>
                  <p className="text-sm text-gray-700">
                    Permanently removes {memberName(member)}, their attendance history and their
                    point ledger. <strong>This cannot be undone.</strong>
                  </p>
                  <p className="mt-2 text-sm text-gray-600">
                    To remove someone who has left the chapter, set their status to{" "}
                    <strong>Alumni</strong> or <strong>Inactive</strong> above instead — that keeps
                    their record intact. Deleting is for duplicates and junk signups.
                  </p>
                  <Button
                    variant="danger"
                    className="mt-4"
                    onClick={() => {
                      setDeleteConfirm("");
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Delete member
                  </Button>
                </CardBody>
              </Card>
            )}
          </div>
        )}
      </div>

      {/*
        The base Dialog rather than ConfirmDialog: this needs the confirm button
        disabled until the email is typed back, and ConfirmDialog's button is
        always live.
      */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        size="sm"
        title="Delete this member permanently?"
        description={
          <>
            This removes {memberName(member)}, {attendance.data?.length ?? 0} attendance record
            {(attendance.data?.length ?? 0) === 1 ? "" : "s"} and their point history. Events they
            attended will show lower attendance counts afterwards. This cannot be undone.
          </>
        }
        footer={
          <>
            <Button
              variant="subtle"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              // Armed only by an exact match, so a mistyped or half-read address
              // cannot delete the wrong person.
              disabled={deleteConfirm.trim().toLowerCase() !== member.email.toLowerCase()}
              onClick={() => deleteMutation.mutate()}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <Field label={`Type ${member.email} to confirm`}>
          {(props) => (
            <Input
              {...props}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={member.email}
            />
          )}
        </Field>
      </Dialog>

      <ConfirmDialog
        open={pendingRole !== null}
        onClose={() => setPendingRole(null)}
        onConfirm={() => pendingRole && roleMutation.mutate(pendingRole)}
        loading={roleMutation.isPending}
        destructive={!pendingRole?.grant}
        confirmLabel={pendingRole?.grant ? "Grant role" : "Remove role"}
        title={pendingRole?.grant ? "Grant this role?" : "Remove this role?"}
        description={
          pendingRole
            ? pendingRole.grant
              ? `${memberName(member)} will be able to ${
                  pendingRole.role === "admin"
                    ? "manage roles and chapter settings, in addition to all officer tools"
                    : "create events, manage attendance and adjust points"
                }. This is recorded in the audit log.`
              : `${memberName(member)} will immediately lose ${pendingRole.role} access. This is recorded in the audit log.`
            : undefined
        }
      />
    </>
  );
}

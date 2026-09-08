import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { KeyRound, ShieldAlert, UserCheck } from "lucide-react";

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
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, PageHeader, SkeletonList } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import {
  useJoinCodeStatus,
  useSetJoinCode,
  useSetJoinCodeEnabled,
} from "@/features/membership/useJoinCode";
import { fetchMembers, memberName, setMembershipStatus } from "@/services/members";
import { queryKeys } from "@/services/queryKeys";
import { setJoinCodeSchema, type SetJoinCodeValues } from "@/lib/validation";
import { errorText } from "@/lib/errors";
import { formatDateTime } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";

const PENDING_FILTERS = { status: "pending" as const };

/**
 * The officer side of joining: set the code, turn it on and off, approve the
 * people the code didn't reach.
 *
 * Everything here is officer-only, and not because of this file. Each RPC calls
 * require_officer() before it does anything, the secret table has no grants and
 * no policies, and a member who fetches this bundle and calls the functions
 * directly gets an exception rather than a join code. This screen is the
 * convenient way in, not the control.
 */
export function AdminJoinCode() {
  usePageMeta({ title: "Join Code | WashU SHPE", noindex: true });

  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useJoinCodeStatus();
  const setCode = useSetJoinCode();
  const setEnabled = useSetJoinCodeEnabled();

  /*
   * The code the officer just set, kept in memory so it can be read out at the
   * meeting.
   *
   * The database stores a salted hash and nothing else, so this is the only
   * moment the plaintext exists anywhere. Deliberately not persisted: if this
   * screen is reloaded the code is gone for good and a new one has to be set,
   * which is the correct trade for not keeping a recoverable copy of it.
   */
  const [justSet, setJustSet] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SetJoinCodeValues>({
    resolver: zodResolver(setJoinCodeSchema),
    defaultValues: { code: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await setCode.mutateAsync({ code: values.code, enabled: true });
      setJustSet(values.code.trim().toUpperCase());
      reset({ code: "" });
      toast.success("Join code set", "It's active now — read it out at the meeting.");
    } catch (error) {
      toast.error("We couldn't set the join code", errorText(error));
    }
  });

  const toggle = async (next: boolean) => {
    try {
      await setEnabled.mutateAsync(next);
      toast.success(next ? "Join code turned on" : "Join code turned off");
    } catch (error) {
      toast.error("We couldn't change that", errorText(error));
    }
  };

  /* ── Pending approvals ──────────────────────────────────────────────── */

  const pending = useQuery({
    queryKey: queryKeys.admin.members(PENDING_FILTERS),
    queryFn: () => fetchMembers(PENDING_FILTERS),
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      setMembershipStatus(id, approve ? "active" : "inactive"),
    onSuccess: (_data, { approve }) => {
      toast.success(approve ? "Member approved" : "Request declined");
      void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.joinCode });
    },
    onError: (error) => toast.error("We couldn't update that member", errorText(error)),
  });

  const rows = pending.data ?? [];

  return (
    <>
      <PageHeader
        title="Join code & approvals"
        description="How new members activate their account without an email confirmation."
      />

      <Alert tone="info" title="Why this exists" className="mb-5">
        Confirmation emails to <strong>@wustl.edu</strong> are removed from the mailbox after
        delivery, and the confirmation link is blocked on campus wifi. Email confirmation is
        therefore off: new accounts start as <strong>pending</strong> and become active by
        entering this code or by being approved below.
      </Alert>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Status + on/off ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Current status</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {status.isPending ? (
              <SkeletonList rows={1} />
            ) : status.isError ? (
              <ErrorState error={status.error} onRetry={() => void status.refetch()} />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700">Join code</span>
                  {!status.data.configured ? (
                    <Badge tone="neutral">Not set</Badge>
                  ) : status.data.enabled ? (
                    <Badge tone="success">On</Badge>
                  ) : (
                    <Badge tone="warning">Off</Badge>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700">Last changed</span>
                  <span className="text-sm font-medium text-shpe-navy">
                    {status.data.rotated_at ? formatDateTime(status.data.rotated_at) : "—"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700">Failed attempts (24h)</span>
                  <span className="text-sm font-medium text-shpe-navy">
                    {status.data.failed_attempts_24h}
                  </span>
                </div>

                {/*
                  Two different messages, because "turn it back on" is the right
                  action in one case and the wrong one in the other. If the code
                  switched itself off it was being guessed at, and re-enabling
                  the same code just resumes the attack — the fix is a new one.
                */}
                {status.data.auto_disabled ? (
                  <Alert tone="danger" title="The join code turned itself off">
                    <span className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        It was guessed at enough times to trip the chapter-wide limit. Set a{" "}
                        <strong>new</strong> code rather than switching this one back on. Members
                        can still be approved by hand below.
                      </span>
                    </span>
                  </Alert>
                ) : (
                  status.data.failed_attempts_24h >= 25 && (
                    <Alert tone="warning" title="Unusual number of failed attempts">
                      <span className="flex items-start gap-2">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        Attempts are rate limited chapter-wide, so this is for awareness — but
                        consider setting a new code if you didn't expect it.
                      </span>
                    </Alert>
                  )
                )}

                {status.data.configured && (
                  <Button
                    // Never the primary action after an auto-disable: setting a
                    // new code is, and this one is still there for an officer
                    // who has decided otherwise.
                    variant={
                      !status.data.enabled && !status.data.auto_disabled ? "primary" : "outline"
                    }
                    block
                    loading={setEnabled.isPending}
                    onClick={() => void toggle(!status.data.enabled)}
                  >
                    {status.data.enabled
                      ? "Turn the join code off"
                      : status.data.auto_disabled
                        ? "Turn this code back on anyway"
                        : "Turn the join code on"}
                  </Button>
                )}

                {status.data.configured && status.data.enabled && (
                  <p className="text-sm text-gray-600">
                    Turn it off after the meeting. Members already activated stay active.
                  </p>
                )}
              </>
            )}
          </CardBody>
        </Card>

        {/* ── Set a new code ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Set the join code</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={onSubmit} noValidate>
              <Field
                label="New join code"
                required
                hint="Spaces, dashes and capitalisation don't matter. Setting a code replaces the old one."
                error={errors.code?.message}
              >
                {(props) => (
                  <Input
                    {...props}
                    {...register("code")}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="SHPE2026"
                    className="text-center text-xl font-bold uppercase tracking-[0.25em]"
                  />
                )}
              </Field>

              <Button
                type="submit"
                block
                className="mt-4"
                loading={isSubmitting || setCode.isPending}
              >
                <KeyRound className="h-4 w-4" aria-hidden />
                Set code and turn it on
              </Button>
            </form>

            {justSet && (
              <div className="mt-5 border border-shpe-rule bg-shpe-navy-soft p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-shpe-navy">
                  Read this out
                </p>
                <p className="mt-2 text-3xl font-bold tracking-[0.25em] text-shpe-navy">
                  {justSet}
                </p>
                <p className="mt-3 text-sm text-gray-700">
                  Write it down now. It's stored as a hash, so nobody — including this page — can
                  show it to you again after you leave.
                </p>
              </div>
            )}

            {!justSet && status.data?.configured && (
              <p className="mt-4 text-sm text-gray-600">
                The current code can't be displayed: only a salted hash of it is stored. If you've
                forgotten it, set a new one.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Pending approvals ──────────────────────────────────────────── */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>
            Waiting for approval
            {rows.length > 0 && (
              <Badge tone="warning" className="ml-2">
                {rows.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardBody>
          {pending.isPending ? (
            <SkeletonList rows={3} />
          ) : pending.isError ? (
            <ErrorState error={pending.error} onRetry={() => void pending.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title="Nobody is waiting"
              description="New sign-ups appear here until they enter the join code or you approve them."
            />
          ) : (
            <Table caption="Members whose accounts are pending approval">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Class</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((member) => (
                  <tr key={member.id}>
                    <Td className="font-medium text-shpe-navy">
                      <Link to={`/admin/members/${member.id}`}>{memberName(member)}</Link>
                    </Td>
                    <Td className="text-gray-700">{member.email}</Td>
                    <Td className="text-gray-700">{member.graduation_year ?? "—"}</Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          loading={
                            decide.isPending &&
                            decide.variables?.id === member.id &&
                            decide.variables.approve
                          }
                          onClick={() => decide.mutate({ id: member.id, approve: true })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          loading={
                            decide.isPending &&
                            decide.variables?.id === member.id &&
                            !decide.variables.approve
                          }
                          onClick={() => decide.mutate({ id: member.id, approve: false })}
                        >
                          Decline
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}

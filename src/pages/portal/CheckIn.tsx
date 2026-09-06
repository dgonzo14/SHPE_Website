import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Trophy } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button, LinkButton } from "@/components/ui/button";
import { Alert, Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { PageHeader } from "@/components/shared/states";
import { useCheckIn } from "@/features/attendance/useCheckIn";
import { checkInSchema, type CheckInValues } from "@/lib/validation";
import { checkInErrorMessage, describeError } from "@/lib/errors";
import type { CheckInSuccess } from "@/types/database";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * The page this whole system exists for.
 *
 * Design constraints, in order: it has to work on a phone held in one hand in a
 * crowded room; it must never award points twice; and when something goes wrong
 * it must say what to do next, not just that it failed.
 */
export function CheckIn() {
  usePageMeta({ title: "Check In | My SHPE", noindex: true });

  const { profile } = useAuth();
  const checkIn = useCheckIn();
  const [success, setSuccess] = useState<CheckInSuccess | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CheckInValues>({
    resolver: zodResolver(checkInSchema),
    defaultValues: { code: "" },
  });

  const membershipBlocked = profile != null && profile.membership_status !== "active";

  const onSubmit = handleSubmit(async (values) => {
    setSuccess(null);
    setFailure(null);
    try {
      const result = await checkIn.mutateAsync({ code: values.code });
      if (result.ok) {
        setSuccess(result);
        reset({ code: "" });
      } else {
        setFailure(checkInErrorMessage(result));
      }
    } catch (error) {
      setFailure(describeError(error, "We couldn't check you in"));
    }
  });

  if (success) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardBody className="p-6 text-center sm:p-8">
            <div
              className="flex flex-col items-center"
              role="status"
              aria-live="polite"
            >
              <span className="rounded-full bg-emerald-50 p-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
              </span>
              <h2 className="mt-4 text-2xl font-bold text-shpe-navy">You're checked in</h2>
              <p className="mt-1 text-gray-700">{success.event_title}</p>

              {success.points_awarded > 0 ? (
                <p className="mt-5 inline-flex items-center gap-2 rounded-lg bg-shpe-orange-soft px-4 py-2 text-lg font-bold text-shpe-orange-dark">
                  <Trophy className="h-5 w-5" aria-hidden />+{success.points_awarded} SHPE points
                </p>
              ) : (
                <p className="mt-5 text-sm text-gray-600">
                  This event doesn't award points, but your attendance is recorded.
                </p>
              )}

              <p className="mt-3 text-sm text-gray-600">
                Your total is now <strong>{success.term_points}</strong> points.
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <LinkButton to="/portal/points" variant="secondary">
                View my points
              </LinkButton>
              <LinkButton to="/portal" variant="outline">
                Back to dashboard
              </LinkButton>
            </div>

            <Button
              variant="ghost"
              className="mt-3"
              onClick={() => {
                setSuccess(null);
                setFailure(null);
              }}
            >
              Check into another event
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="Check into an event"
        description="Enter the code shown at the event."
      />

      {membershipBlocked && (
        <Alert tone="warning" title="Check-in is limited to active members" className="mb-4">
          Your membership is currently{" "}
          <strong className="capitalize">{profile?.membership_status}</strong>. Contact a SHPE
          officer if you believe this is incorrect.
        </Alert>
      )}

      <Card>
        <CardBody className="p-5 sm:p-6">
          <form onSubmit={onSubmit} noValidate>
            <Field
              label="Event code"
              required
              hint="Spaces, dashes and capitalisation don't matter."
              error={errors.code?.message}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register("code")}
                  // Codes are letters + digits, so the plain text keyboard with
                  // autocorrect off beats a numeric pad here.
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  enterKeyHint="go"
                  placeholder="NOVA4821"
                  className="text-center text-2xl font-bold uppercase tracking-[0.3em]"
                />
              )}
            </Field>

            <Button
              type="submit"
              block
              size="lg"
              className="mt-5"
              // Disabled while in flight: the single most likely way to attempt a
              // double check-in is an impatient second tap.
              loading={isSubmitting || checkIn.isPending}
            >
              Check in
            </Button>
          </form>

          {/*
            aria-live so the outcome is announced. Rendered after the form and
            kept in the DOM order a screen reader will reach next.
          */}
          <div aria-live="assertive" className="mt-4 empty:mt-0">
            {failure && (
              <Alert tone="danger" title={failure.title}>
                {failure.detail}
              </Alert>
            )}
          </div>
        </CardBody>
      </Card>

      <p className="mt-4 text-center text-sm text-gray-600">
        Don't have a code?{" "}
        <LinkButton to="/portal/events" variant="ghost" size="sm">
          Browse events
        </LinkButton>
      </p>
    </div>
  );
}

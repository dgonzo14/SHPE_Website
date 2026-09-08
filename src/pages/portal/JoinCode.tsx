import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Clock } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button, LinkButton } from "@/components/ui/button";
import { Alert, Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { PageHeader } from "@/components/shared/states";
import { useRedeemJoinCode } from "@/features/membership/useJoinCode";
import { joinCodeSchema, type JoinCodeValues } from "@/lib/validation";
import { REDEEM_MESSAGES } from "@/services/joinCode";
import { describeError } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * How a new member actually becomes active.
 *
 * Email confirmation is off, because confirmation mail to @wustl.edu is pulled
 * out of the mailbox after delivery and the link is blocked on campus wifi.
 * Both were reproduced; neither is fixable from this codebase. So registration
 * leaves the account 'pending' and this page is the way out of it: enter the
 * code an officer reads out at the meeting, or wait for an officer to approve
 * the account by hand.
 *
 * Deliberately not a dead end. A pending member can already browse events, see
 * announcements and read resources — only check-in is gated — so this page
 * offers the fallback and a way back to the portal rather than trapping them.
 */
export function JoinCode() {
  usePageMeta({ title: "Join the chapter | My SHPE", noindex: true });

  const { profile } = useAuth();
  const redeem = useRedeemJoinCode();
  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null);
  const [activated, setActivated] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<JoinCodeValues>({
    resolver: zodResolver(joinCodeSchema),
    defaultValues: { code: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      const result = await redeem.mutateAsync(values.code);
      if (result.ok) {
        setActivated(true);
        reset({ code: "" });
      } else {
        setFailure(REDEEM_MESSAGES[result.code] ?? { title: "We couldn't verify that code" });
      }
    } catch (error) {
      setFailure(describeError(error, "We couldn't verify that code"));
    }
  });

  /*
   * Two ways to reach the success state: this page just activated them, or they
   * arrived already active (an officer approved them, or they bookmarked this
   * URL). Both get the same screen — being told "you're already a member" by a
   * page you were sent to in order to become one is a confusing way to succeed.
   */
  const isActive = activated || profile?.membership_status === "active";

  if (isActive) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardBody className="p-6 text-center sm:p-8">
            <div className="flex flex-col items-center" role="status" aria-live="polite">
              <span className="rounded-full bg-emerald-50 p-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
              </span>
              <h2 className="mt-4 text-2xl font-bold text-shpe-navy">
                You're an active member
              </h2>
              <p className="mt-2 text-gray-700">
                You can check into events and start earning SHPE points.
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <LinkButton to="/portal/check-in">Check into an event</LinkButton>
              <LinkButton to="/portal" variant="outline">
                Go to my dashboard
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="Join the chapter"
        description="Enter the code from the meeting to activate your membership."
      />

      <Card>
        <CardBody className="p-5 sm:p-6">
          <form onSubmit={onSubmit} noValidate>
            <Field
              label="Join code"
              required
              hint="Spaces, dashes and capitalisation don't matter."
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
                  enterKeyHint="go"
                  placeholder="SHPE2026"
                  className="text-center text-2xl font-bold uppercase tracking-[0.3em]"
                />
              )}
            </Field>

            <Button
              type="submit"
              block
              size="lg"
              className="mt-5"
              loading={isSubmitting || redeem.isPending}
            >
              Activate my membership
            </Button>
          </form>

          <div aria-live="assertive" className="mt-4 empty:mt-0">
            {failure && (
              <Alert tone="danger" title={failure.title}>
                {failure.detail}
              </Alert>
            )}
          </div>
        </CardBody>
      </Card>

      {/*
        The fallback, stated plainly. Attempts are throttled server-side, so a
        member who has locked themselves out for a few minutes needs to know
        there is another way in before they start refreshing the page.
      */}
      <Card className="mt-5">
        <CardBody className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-shpe-navy">
            <Clock className="h-4 w-4 text-shpe-blue" aria-hidden />
            Don't have a code?
          </h2>
          <p className="mt-2 text-sm text-gray-700">
            An officer can approve your account directly — find one at the meeting or email{" "}
            <a href="mailto:shpe@wustl.edu">shpe@wustl.edu</a>. Until then you can still browse
            events, announcements and resources; only event check-in needs an active membership.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <LinkButton to="/portal/events" variant="secondary" size="sm">
              Browse events
            </LinkButton>
            <LinkButton to="/portal" variant="ghost" size="sm">
              Back to dashboard
            </LinkButton>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

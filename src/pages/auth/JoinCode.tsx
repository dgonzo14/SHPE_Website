import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, KeyRound } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button, LinkButton } from "@/components/ui/button";
import { Alert, Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { useRedeemJoinCode } from "@/features/membership/useJoinCode";
import { joinCodeSchema, type JoinCodeValues } from "@/lib/validation";
import { REDEEM_MESSAGES } from "@/services/joinCode";
import { describeError } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * The step between signing in and the portal.
 *
 * Email confirmation is off — confirmation mail to @wustl.edu is removed from
 * the mailbox after delivery and the link is blocked on campus wifi, both
 * reproduced — so registering proves nothing about who someone is. A new
 * account is 'pending' and stops here until it is admitted, either by the code
 * an officer reads out or by an officer approving it.
 *
 * Rendered in AuthLayout rather than the portal shell on purpose. Showing the
 * portal navigation to someone who cannot use any of it invites them to click
 * through eight dead links; this page is a door, so it looks like one.
 */
export function JoinCode() {
  usePageMeta({ title: "Join the chapter | WashU SHPE", noindex: true });

  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redeem = useRedeemJoinCode();

  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null);
  const [activated, setActivated] = useState(false);

  // Where they were headed when the guard intercepted them.
  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  const {
    register,
    handleSubmit,
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
      } else {
        setFailure(REDEEM_MESSAGES[result.code] ?? { title: "We couldn't verify that code" });
      }
    } catch (error) {
      setFailure(describeError(error, "We couldn't verify that code"));
    }
  });

  /*
   * Anyone not pending has no business on this page — an officer approved them
   * while they sat here, or they typed the URL. Send them on rather than
   * offering a code to someone who is already in.
   *
   * `activated` suppresses this for the one render after a successful
   * redemption, so the success card is actually seen instead of being replaced
   * by an instant redirect.
   */
  if (!activated && profile && profile.membership_status !== "pending") {
    return <Navigate to={destination ?? "/portal"} replace />;
  }

  if (activated) {
    return (
      <Card>
        <CardBody className="p-6 text-center sm:p-8">
          <div className="flex flex-col items-center" role="status" aria-live="polite">
            <span className="rounded-full bg-emerald-50 p-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
            </span>
            <h1 className="mt-4 text-2xl font-bold text-shpe-navy">You're in</h1>
            <p className="mt-2 text-gray-700">
              Your membership is active. You can check into events and start earning SHPE points.
            </p>
          </div>
          <Button
            block
            size="lg"
            className="mt-6"
            onClick={() => navigate(destination ?? "/portal", { replace: true })}
          >
            Go to My SHPE
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardBody className="p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-shpe-navy">One more step</h1>
          <p className="mt-2 text-sm text-gray-600">
            {profile?.first_name ? `Thanks for signing up, ${profile.first_name}. ` : ""}
            Enter the join code from the meeting to activate your membership.
          </p>

          <form onSubmit={onSubmit} className="mt-6" noValidate>
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
              <KeyRound className="h-4 w-4" aria-hidden />
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
        The fallback stated plainly. Attempts are throttled, so someone who has
        just locked themselves out needs to know there is another way in before
        they start reloading the page.
      */}
      <Card className="mt-5">
        <CardBody className="p-5">
          <h2 className="text-sm font-semibold text-shpe-navy">Don't have a code?</h2>
          <p className="mt-2 text-sm text-gray-700">
            An officer can approve your account instead — find one at the meeting, or email{" "}
            <a href="mailto:shpe@wustl.edu">shpe@wustl.edu</a> from your WashU address. Once
            you're approved, sign in again and you'll go straight through.
          </p>
        </CardBody>
      </Card>

      {/* Never a dead end: this is the only page a pending account can reach. */}
      <div className="mt-5 flex flex-col items-center gap-2 text-center">
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
        <LinkButton to="/" variant="ghost" size="sm">
          Back to the WashU SHPE website
        </LinkButton>
      </div>
    </>
  );
}

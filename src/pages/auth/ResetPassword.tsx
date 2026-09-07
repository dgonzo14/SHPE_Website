import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { FullPageLoader } from "@/components/shared/states";
import { resetPasswordSchema, type ResetPasswordValues } from "@/lib/validation";
import { describeError } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * Landing page for the emailed reset link.
 *
 * Supabase exchanges the code in the URL for a short-lived session before this
 * renders, so "am I allowed to set a new password?" reduces to "is there a
 * session?". There is no token handling here — the official client owns that.
 */
export function ResetPassword() {
  usePageMeta({ title: "Set a New Password | WashU SHPE", noindex: true });

  const { status, updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Supabase needs a moment to exchange the code in the URL for a session, so
  // "no session" is only conclusive after that grace period has elapsed.
  const [gracePeriodOver, setGracePeriodOver] = useState(false);
  const settled = status !== "loading" || gracePeriodOver;

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setGracePeriodOver(true), 1500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await updatePassword(values.password);
      setDone(true);
      // End the recovery session so the new password is actually exercised at
      // the next sign-in rather than silently skipped.
      await signOut();
      window.setTimeout(
        () =>
          navigate("/login", {
            replace: true,
            state: { notice: "Your password is updated. Sign in with your new password." },
          }),
        1200,
      );
    } catch (error) {
      const { title, detail } = describeError(error, "We couldn't update your password");
      setFormError(detail ? `${title}. ${detail}` : title);
    }
  });

  if (status === "loading" && !settled) {
    return <FullPageLoader label="Checking your reset link" />;
  }

  if (status !== "signed-in" && !done) {
    return (
      <Card>
        <CardBody className="p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-shpe-navy">This reset link isn't valid</h1>
          <Alert tone="warning" className="mt-5">
            Reset links expire and can only be used once. Request a new one and try again.
          </Alert>
          <Link
            to="/forgot-password"
            className="mt-5 inline-block text-sm font-semibold text-shpe-orange-dark"
          >
            Send a new reset link
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-shpe-navy">Choose a new password</h1>

        {done ? (
          <Alert tone="success" title="Password updated" className="mt-5">
            Taking you to the sign-in page…
          </Alert>
        ) : (
          <>
            {formError && (
              <Alert tone="danger" className="mt-5">
                {formError}
              </Alert>
            )}

            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <Field
                label="New password"
                required
                hint="At least 8 characters."
                error={errors.password?.message}
              >
                {(props) => (
                  <Input {...props} {...register("password")} type="password" autoComplete="new-password" />
                )}
              </Field>
              <Field label="Confirm new password" required error={errors.confirm_password?.message}>
                {(props) => (
                  <Input
                    {...props}
                    {...register("confirm_password")}
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </Field>
              <Button type="submit" block size="lg" loading={isSubmitting}>
                Update password
              </Button>
            </form>
          </>
        )}
      </CardBody>
    </Card>
  );
}

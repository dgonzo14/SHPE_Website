import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/validation";
import { describeError } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

export function ForgotPassword() {
  usePageMeta({ title: "Reset Password | WashU SHPE", noindex: true });

  const { requestPasswordReset } = useAuth();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await requestPasswordReset(values.email);
      setSent(true);
    } catch (error) {
      const { title, detail } = describeError(error, "We couldn't send that email");
      setFormError(detail ? `${title}. ${detail}` : title);
    }
  });

  return (
    <Card>
      <CardBody className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-shpe-navy">Reset your password</h1>

        {sent ? (
          <>
            {/*
              Deliberately does not confirm whether the address has an account:
              that would turn this form into a way to enumerate members.
            */}
            <Alert tone="success" title="Check your email" className="mt-5">
              If that address has a SHPE account, a reset link is on its way. The link expires
              after a short while, so use it soon.
            </Alert>
            <Link to="/login" className="mt-5 inline-block text-sm font-medium text-shpe-navy">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-600">
              Enter your email and we'll send you a link to set a new one.
            </p>

            {formError && (
              <Alert tone="danger" className="mt-5">
                {formError}
              </Alert>
            )}

            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <Field label="Email" required error={errors.email?.message}>
                {(props) => (
                  <Input
                    {...props}
                    {...register("email")}
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    placeholder="you@wustl.edu"
                  />
                )}
              </Field>

              <Button type="submit" block size="lg" loading={isSubmitting}>
                Send reset link
              </Button>
            </form>

            <p className="mt-5 text-sm">
              <Link to="/login" className="font-medium text-shpe-navy">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

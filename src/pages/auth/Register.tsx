import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Card,
  CardBody,
  Checkbox,
  Field,
  Input,
  Select,
} from "@/components/ui/primitives";
import {
  DEGREE_LEVELS,
  emailDomainIssue,
  registerSchema,
  type RegisterValues,
} from "@/lib/validation";
import { ALLOWED_EMAIL_DOMAINS } from "@/lib/config";
import { describeError } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

export function Register() {
  usePageMeta({ title: "Create Account | WashU SHPE", noindex: true });

  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  // True once the sign-up has been rate limited at least once and is waiting.
  const [queued, setQueued] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      password: "",
      confirm_password: "",
      major: "",
      secondary_major: "",
      graduation_year: new Date().getFullYear() + 1,
      degree_level: "undergraduate",
      shpe_national_member: false,
      shpe_national_member_id: "",
      linkedin_url: "",
    },
  });

  const claimsNationalMembership = useWatch({ control, name: "shpe_national_member" });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setQueued(false);
    try {
      // Everyone at a meeting shares one campus IP and therefore one rate
      // limit, so signUp() waits the limiter out rather than failing. That can
      // take tens of seconds; setQueued turns the silent spinner into an
      // explanation so nobody assumes it broke and refreshes into a fresh
      // rejection.
      const { needsEmailConfirmation } = await signUp(values, {
        onRetry: () => setQueued(true),
      });

      if (needsEmailConfirmation) {
        navigate("/login", {
          replace: true,
          state: {
            notice: "Almost there — check your email for a confirmation link, then sign in.",
          },
        });
        return;
      }

      /*
       * Confirmation is off, so signUp returned a session and they are already
       * signed in. Sending them to /login would bounce off
       * RedirectIfAuthenticated and land on the dashboard behind a "you're not
       * active yet" banner. Go straight to the thing they need to do instead.
       */
      navigate("/portal/join", { replace: true });
    } catch (error) {
      const { title, detail } = describeError(error, "We couldn't create your account");
      setFormError(detail ? `${title}. ${detail}` : title);
    } finally {
      setQueued(false);
    }
  });

  /*
   * Advisory, never blocking. The schema no longer rejects an off-domain
   * address because the browser cannot see manual_email_allowlist -- the
   * escape hatch officers use to onboard someone whose address does not fit
   * the standard domain. The database decides; this only warns early, and
   * says who to ask when the address is deliberate.
   */
  const typedEmail = useWatch({ control, name: "email" }) ?? "";
  const domainHint =
    emailDomainIssue(typedEmail) ??
    (ALLOWED_EMAIL_DOMAINS.length > 0
      ? `Use your ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" or ")} address.`
      : undefined);

  return (
    <Card>
      <CardBody className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-shpe-navy">Join the member portal</h1>
        <p className="mt-2 text-sm text-gray-600">
          Track events, check in, and see your SHPE points in one place.
        </p>

        {formError && (
          <Alert tone="danger" className="mt-5">
            {formError}
          </Alert>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required error={errors.first_name?.message}>
              {(props) => (
                <Input {...props} {...register("first_name")} autoComplete="given-name" />
              )}
            </Field>
            <Field label="Last name" required error={errors.last_name?.message}>
              {(props) => (
                <Input {...props} {...register("last_name")} autoComplete="family-name" />
              )}
            </Field>
          </div>

          <Field label="WashU email" required hint={domainHint} error={errors.email?.message}>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Password"
              required
              hint="At least 8 characters."
              error={errors.password?.message}
            >
              {(props) => (
                <Input {...props} {...register("password")} type="password" autoComplete="new-password" />
              )}
            </Field>
            <Field label="Confirm password" required error={errors.confirm_password?.message}>
              {(props) => (
                <Input
                  {...props}
                  {...register("confirm_password")}
                  type="password"
                  autoComplete="new-password"
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Major" required error={errors.major?.message}>
              {(props) => <Input {...props} {...register("major")} />}
            </Field>
            <Field
              label="Second major or minor"
              hint="Optional"
              error={errors.secondary_major?.message}
            >
              {(props) => <Input {...props} {...register("secondary_major")} />}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Graduation year" required error={errors.graduation_year?.message}>
              {(props) => (
                <Input
                  {...props}
                  {...register("graduation_year", { valueAsNumber: true })}
                  type="number"
                  inputMode="numeric"
                  min={new Date().getFullYear() - 10}
                  max={new Date().getFullYear() + 10}
                />
              )}
            </Field>
            <Field label="Degree level" required error={errors.degree_level?.message}>
              {(props) => (
                <Select {...props} {...register("degree_level")}>
                  {DEGREE_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field label="LinkedIn" hint="Optional" error={errors.linkedin_url?.message}>
            {(props) => (
              <Input
                {...props}
                {...register("linkedin_url")}
                type="url"
                placeholder="https://linkedin.com/in/…"
              />
            )}
          </Field>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <Checkbox
              {...register("shpe_national_member")}
              label="I'm a SHPE National member"
              description="An officer confirms this against the National roster — until then it shows as self-reported."
            />
            {claimsNationalMembership && (
              <div className="mt-3">
                <Field
                  label="SHPE National member ID"
                  hint="Optional — helps officers verify faster."
                  error={errors.shpe_national_member_id?.message}
                >
                  {(props) => <Input {...props} {...register("shpe_national_member_id")} />}
                </Field>
              </div>
            )}
          </div>

          {/*
            Only appears once the request has actually been throttled, so it
            never shows up in the ordinary case. aria-live because the visible
            change is the whole point of it.
          */}
          <div aria-live="polite" className="empty:hidden">
            {queued && isSubmitting && (
              <Alert tone="info" title="Lots of people are signing up right now">
                You're in the queue — this can take up to a minute. Keep this page open; there's no
                need to press the button again.
              </Alert>
            )}
          </div>

          <Button type="submit" block size="lg" loading={isSubmitting}>
            Create account
          </Button>
        </form>

        <p className="mt-5 border-t border-gray-100 pt-4 text-sm text-gray-600">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-shpe-orange-dark">
            Sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}

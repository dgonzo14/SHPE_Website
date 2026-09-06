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
import { DEGREE_LEVELS, registerSchema, type RegisterValues } from "@/lib/validation";
import { ALLOWED_EMAIL_DOMAINS } from "@/lib/config";
import { describeError } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

export function Register() {
  usePageMeta({ title: "Create Account | WashU SHPE", noindex: true });

  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

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
    try {
      const { needsEmailConfirmation } = await signUp(values);
      navigate("/login", {
        replace: true,
        state: {
          notice: needsEmailConfirmation
            ? "Almost there — check your email for a confirmation link, then sign in."
            : "Your account is ready. Sign in to open My SHPE.",
        },
      });
    } catch (error) {
      const { title, detail } = describeError(error, "We couldn't create your account");
      setFormError(detail ? `${title}. ${detail}` : title);
    }
  });

  const domainHint =
    ALLOWED_EMAIL_DOMAINS.length > 0
      ? `Use your ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" or ")} address.`
      : undefined;

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

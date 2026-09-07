import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { loginSchema, type LoginValues } from "@/lib/validation";
import { describeError } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

interface LocationState {
  from?: { pathname?: string; search?: string };
  /** Set by Register after a successful signup that needs email confirmation. */
  notice?: string;
}

export function Login() {
  usePageMeta({ title: "Sign In | WashU SHPE", noindex: true });

  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      // Return them to what they were trying to reach, not always the dashboard.
      const target = state.from?.pathname
        ? `${state.from.pathname}${state.from.search ?? ""}`
        : "/portal";
      navigate(target, { replace: true });
    } catch (error) {
      const { title, detail } = describeError(error, "We couldn't sign you in");
      setFormError(detail ? `${title}. ${detail}` : title);
    }
  });

  return (
    <Card>
      <CardBody className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-shpe-navy">Welcome back</h1>
        <p className="mt-2 text-sm text-gray-600">
          Access your SHPE events, points, attendance, and member profile.
        </p>

        {state.notice && (
          <Alert tone="success" className="mt-5">
            {state.notice}
          </Alert>
        )}

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
                autoComplete="username"
                inputMode="email"
                placeholder="you@wustl.edu"
              />
            )}
          </Field>

          <Field label="Password" required error={errors.password?.message}>
            {(props) => (
              <Input {...props} {...register("password")} type="password" autoComplete="current-password" />
            )}
          </Field>

          <Button type="submit" block size="lg" loading={isSubmitting}>
            Sign in
          </Button>
        </form>

        <div className="mt-5 space-y-3 text-sm">
          <p>
            <Link to="/forgot-password" className="font-medium text-shpe-navy">
              Forgot your password?
            </Link>
          </p>
          <p className="border-t border-gray-100 pt-4 text-gray-600">
            New to the member portal?{" "}
            <Link to="/register" className="font-semibold text-shpe-orange-dark">
              Create an account
            </Link>
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

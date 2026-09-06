import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from "@/components/ui/primitives";
import { PageHeader } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { changePasswordSchema, type ChangePasswordValues } from "@/lib/validation";
import { errorText } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * Only settings that actually do something.
 *
 * There are deliberately no notification toggles here. Email digests and the
 * member directory are not built yet, and a switch that silently does nothing
 * is worse than no switch — the columns exist in the database
 * (notification_preferences) so those screens can ship without a migration.
 */
export function Settings() {
  usePageMeta({ title: "Settings | My SHPE", noindex: true });

  const { user, updatePassword, signOut } = useAuth();
  const toast = useToast();
  const [changed, setChanged] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updatePassword(values.password);
      reset({ password: "", confirm_password: "" });
      setChanged(true);
      toast.success("Password updated");
    } catch (error) {
      toast.error("We couldn't update your password", errorText(error));
    }
  });

  return (
    <>
      <PageHeader title="Settings" description="Your account and sign-in." />

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-gray-700">Signed in as</span>
              <span className="font-medium text-shpe-navy">{user?.email}</span>
            </div>
            <div className="border-t border-gray-100 pt-3">
              <Button variant="outline" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardBody>
            {changed && (
              <Alert tone="success" className="mb-4">
                Your password has been updated.
              </Alert>
            )}
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <Field
                label="New password"
                required
                hint="At least 8 characters."
                error={errors.password?.message}
              >
                {(props) => (
                  <Input
                    {...props}
                    {...register("password")}
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </Field>
              <Field
                label="Confirm new password"
                required
                error={errors.confirm_password?.message}
              >
                {(props) => (
                  <Input
                    {...props}
                    {...register("confirm_password")}
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </Field>
              <Button type="submit" loading={isSubmitting}>
                Update password
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-gray-700">
            <p>
              Your attendance and points are chapter records: officers can see them, and they are
              kept as chapter history. They are never shown publicly, and your email is never
              published on the website.
            </p>
            <p>
              To correct something, or to ask about removing your account, contact a SHPE officer
              at{" "}
              <a href="mailto:shpe@wustl.edu" className="font-medium">
                shpe@wustl.edu
              </a>
              .
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

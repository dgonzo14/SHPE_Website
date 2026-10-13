import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { addAttendanceSubmission } from "@/services/attendanceForm";
import { ALLOWED_EMAIL_DOMAINS } from "@/lib/config";
import { errorText } from "@/lib/errors";
import { addAttendeeSchema, type AttendanceFormValues } from "@/lib/validation";
import { submissionName } from "./labels";
import { useInvalidateEventAttendance } from "./useAttendanceForm";

/**
 * Records someone by name and email, for the people Add attendee can't reach.
 *
 * Add attendee picks from existing accounts, so a newcomer without one, the
 * very person the attendance form exists for, had no way in once the form
 * couldn't help: no phone, the window had closed, the link was down. This is
 * the form filled in on their behalf, with the same outcome: checked in
 * straight away if an account already uses the email, otherwise waiting
 * until one does. Unlike the form it works outside the check-in window, like
 * Add attendee, since adding someone after the meeting is the point.
 *
 * Mounted only while open, so each person starts from an empty form.
 */
export function AddByNameDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const toast = useToast();
  const formId = useId();
  const invalidate = useInvalidateEventAttendance(eventId);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AttendanceFormValues>({
    resolver: zodResolver(addAttendeeSchema),
    defaultValues: { first_name: "", last_name: "", email: "" },
  });

  const add = useMutation({
    mutationFn: (values: AttendanceFormValues) => addAttendanceSubmission(eventId, values),
    onSuccess: (result, values) => {
      // The values are the schema's output: names trimmed, the email trimmed
      // and lowercased, which is how the database stores and matches them.
      const name = submissionName(values);
      if (result.status === "checked_in") {
        toast.success(
          `${name} is checked in`,
          result.points_awarded > 0
            ? `An account already uses ${values.email}, so they're on the roster with +${result.points_awarded} points.`
            : `An account already uses ${values.email}, so they're on the roster.`,
        );
      } else if (result.status === "waiting") {
        toast.success(
          `${name} is on the waiting list`,
          `They'll be added to the roster, points included, when they create an account with ${values.email}.`,
        );
      } else {
        // Not a failure: the email was already on the roster or waiting, so
        // there was nothing to add. Saying so stops the officer trying again.
        toast.info(
          `${values.email} is already on this event's list`,
          "They're on the roster or waiting for an account already, so nothing changed.",
        );
      }
      onClose();
    },
    onError: (error) => toast.error("We couldn't add them", errorText(error)),
    // Also on failure: whatever went wrong, the roster may have moved on (a
    // signup between opening this and saving it), and the page should show
    // where it stands now.
    onSettled: invalidate,
  });

  const emailHint =
    ALLOWED_EMAIL_DOMAINS.length > 0
      ? `If they have a ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" or ")} address, use it: that's what SHPE accounts use, so the attendance finds their account now or when they make one.`
      : "The address they'll use for their SHPE account, so the attendance finds it.";

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add someone by name and email"
      description="For newcomers without an account, or anyone who couldn't use the form. If an account already uses the email, they're checked in with this event's points; if not, they're listed as waiting until they create one. Members with an account can still be added with Add attendee."
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={add.isPending}>
            Add them
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit((values) => add.mutate(values))}
        noValidate
        className="space-y-4"
      >
        {/* Autocomplete is off throughout: the officer is typing someone
            else's details, and the browser would offer their own. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.first_name?.message}>
            {(props) => (
              <Input
                {...props}
                {...register("first_name")}
                autoComplete="off"
                autoCapitalize="words"
              />
            )}
          </Field>
          <Field label="Last name" required error={errors.last_name?.message}>
            {(props) => (
              <Input
                {...props}
                {...register("last_name")}
                autoComplete="off"
                autoCapitalize="words"
              />
            )}
          </Field>
        </div>

        <Field label="Email" required hint={emailHint} error={errors.email?.message}>
          {(props) => (
            <Input
              {...props}
              {...register("email")}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

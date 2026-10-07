import { useId } from "react";
import { Link } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Checkbox, Field, Input } from "@/components/ui/primitives";
import { ErrorState, SkeletonList } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { useAppConfig } from "@/hooks/useAppConfig";
import { cardUrl } from "@/services/cards";
import { memberName } from "@/services/members";
import { errorText } from "@/lib/errors";
import { cardHandleSchema } from "@/lib/validation";
import type { AdminCardRow } from "@/types/database";
import { isFallbackHandle } from "./adminCardRows";
import { useAdminCardSuggestion, useCreateCard } from "./useAdminCards";

/** Who the card is for. A row from the admin list, or the same fields from a profile. */
export type CreateCardTarget = Pick<AdminCardRow, "member_id" | "first_name" | "last_name" | "email">;

const createCardSchema = z.object({
  handle: cardHandleSchema,
  publish: z.boolean(),
});
type CreateCardValues = z.infer<typeof createCardSchema>;

/**
 * Create one member's card: the suggested handle, editable, and whether to
 * publish it as a starter card.
 *
 * The database decides what goes on the card (name and school, nothing else
 * personal) and re-validates the handle, so this form only has two questions.
 * The handle is checked here as it's typed for an instant message; a handle
 * someone else holds is only discovered on save, and comes back as a toast.
 */
export function CreateCardDialog({
  member,
  onClose,
}: {
  member: CreateCardTarget | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const suggestion = useAdminCardSuggestion(member?.member_id ?? null);
  const create = useCreateCard();
  const name = member ? memberName(member) : "";

  const submit = async (values: CreateCardValues) => {
    if (!member) return;
    try {
      const result = await create.mutateAsync({
        memberId: member.member_id,
        handle: values.handle,
        publish: values.publish,
      });
      toast.success(
        `Card created for ${name}`,
        result.is_published
          ? `Published as a starter card at /card/${result.handle}.`
          : `Their handle is ${result.handle}. It stays unpublished until they publish it.`,
      );
      onClose();
    } catch (error) {
      toast.error("We couldn't create that card", errorText(error));
    }
  };

  // Only a blank name gets no suggestion (the database counts no-break and
  // zero-width spaces as blank too), and the database refuses to make that
  // card: a handle has to come from somewhere other than their email. A name it
  // can't spell, like 王芳, still gets a member-xxxxxx suggestion.
  const noName = suggestion.isSuccess && suggestion.data === null;
  const ready = suggestion.isSuccess && !noName;

  return (
    <Dialog
      open={member !== null}
      onClose={onClose}
      title={name ? `Create a card for ${name}` : "Create a card"}
      description="Their name from their profile and the school, nothing else. Only they can add contact details, links, a photo or a bio."
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={create.isPending} disabled={!ready}>
            Create card
          </Button>
        </>
      }
    >
      {!member ? null : suggestion.isPending ? (
        <>
          <SkeletonList rows={1} />
          <span role="status" className="sr-only">
            Finding a handle
          </span>
        </>
      ) : suggestion.isError ? (
        <ErrorState
          error={suggestion.error}
          fallback="We couldn't suggest a handle"
          onRetry={() => void suggestion.refetch()}
        />
      ) : noName ? (
        <Alert tone="warning" title="Add a name to their profile first">
          A card's handle comes from the member's name, and there isn't one on this profile.{" "}
          <Link to={`/admin/members/${member.member_id}`} className="font-medium underline">
            Open their member page
          </Link>
        </Alert>
      ) : (
        // Keyed by member only: a different member starts a fresh form, but a
        // background refetch of the suggestion mustn't wipe what's been typed.
        <CreateCardForm
          key={member.member_id}
          formId={formId}
          defaultHandle={suggestion.data ?? ""}
          onSubmit={submit}
        />
      )}
    </Dialog>
  );
}

function CreateCardForm({
  formId,
  defaultHandle,
  onSubmit,
}: {
  formId: string;
  defaultHandle: string;
  onSubmit: (values: CreateCardValues) => Promise<void>;
}) {
  const config = useAppConfig();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CreateCardValues>({
    resolver: zodResolver(createCardSchema),
    defaultValues: { handle: defaultHandle, publish: false },
    mode: "onTouched",
  });

  const handle = useWatch({ control, name: "handle" });
  const publish = useWatch({ control, name: "publish" });
  const parsed = cardHandleSchema.safeParse(handle ?? "");
  const chipUrl = parsed.success ? cardUrl(parsed.data, "nfc") : null;
  const madeUp = isFallbackHandle(defaultHandle) && handle === defaultHandle;

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <Field
        label="Handle"
        required
        error={errors.handle?.message}
        hint={
          <>
            {madeUp &&
              "Their name has no letters a web address can use, so this handle was made up. Type a better one if you know it, or they can pick their own in My Card. "}
            3–30 lowercase letters, numbers and single hyphens.
            {chipUrl && (
              <>
                {" "}
                Their chip will open <span className="break-all font-mono">{chipUrl}</span>
              </>
            )}
          </>
        }
      >
        {(props) => (
          <Input
            {...props}
            {...register("handle")}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </Field>

      <div className="space-y-3">
        <Checkbox {...register("publish")} label="Publish it now as a starter card" />
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-gray-600">
          <li>
            <strong className="font-medium text-gray-800">Left unticked</strong> (the default): the
            card is saved but not public. Tapping their chip shows “card not available” until they
            open My Card and publish it.
          </li>
          <li>
            <strong className="font-medium text-gray-800">Ticked</strong>: their chip works
            straight away, showing their name, school, major, class year and verified position,
            with Add to Contacts. Nothing else appears until they add it.
          </li>
        </ul>
        {publish && config.isSuccess && config.data.cards_enabled !== true && (
          <Alert tone="info">
            Business cards are switched off, so it won't be live until you turn them on.
          </Alert>
        )}
      </div>
    </form>
  );
}

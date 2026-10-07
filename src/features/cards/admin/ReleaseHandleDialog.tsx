import { useCallback, useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Field, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { memberName } from "@/services/members";
import { errorText } from "@/lib/errors";
import { cardHandleResetSchema, type CardHandleResetValues } from "@/lib/validation";
import { CARD_LIMITS } from "@/features/cards/model";
import type { RowWithCard } from "./adminCardRows";
import { useReleaseCardHandle } from "./useAdminCards";

/** Which handle to take, and from whom. */
export interface ReleaseTarget {
  row: RowWithCard;
  handle: string;
}

/**
 * Take one handle away from a member for good: usually an old handle they
 * renamed away from but still hold, such as someone else's name.
 *
 * Releasing is permanent in one direction only. The handle stops leading to
 * this member and anyone else can claim it, but this member never can again,
 * so they can't simply switch back to it after the officer has acted. If it's
 * their current handle, the card moves to a new one chosen from their name.
 *
 * The database decides what was actually released (the list on screen may be
 * stale), so the toast reports its answer, not this dialog's assumption.
 */
export function ReleaseHandleDialog({
  target,
  onClose,
}: {
  target: ReleaseTarget | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const release = useReleaseCardHandle();
  const row = target?.row ?? null;
  const handle = target?.handle ?? "";
  const name = row ? memberName(row) : "";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CardHandleResetValues>({
    resolver: zodResolver(cardHandleResetSchema),
    defaultValues: { reason: "" },
  });

  // Stable, because Dialog re-runs its focus handling whenever onClose changes.
  const close = useCallback(() => {
    reset({ reason: "" });
    onClose();
  }, [reset, onClose]);

  const isCurrent = row !== null && row.handle === handle;
  const chipCarriesThisHandle = Boolean(row?.chip_written_at && row.chip_handle === handle);

  const onSubmit = handleSubmit(async ({ reason }) => {
    if (!row) return;
    try {
      const result = await release.mutateAsync({ memberId: row.member_id, handle, reason });
      const chipNote =
        row.chip_written_at && row.chip_handle === result.handle
          ? " Rewrite their chip with their current address, then mark it written."
          : "";
      if (result.was_current && result.new_handle) {
        toast.success(
          `${name}'s handle is now ${result.new_handle}`,
          `${result.handle} is released and no longer leads to their card.${chipNote}`,
        );
      } else {
        toast.success(
          `Released ${result.handle}`,
          `It no longer redirects to ${name}'s card, and another member can claim it.${chipNote}`,
        );
      }
      close();
    } catch (error) {
      toast.error("We couldn't release that handle", errorText(error));
    }
  });

  return (
    <Dialog
      open={target !== null}
      onClose={close}
      title={name ? `Release ${handle} from ${name}'s card?` : "Release this handle?"}
      description="For a handle they shouldn't have, like someone else's name. They can never take it back."
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={release.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={release.isPending}>
            Release handle
          </Button>
        </>
      }
    >
      {row && (
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
          {isCurrent ? (
            <Alert tone="danger" title={`${handle} is their current handle`}>
              Their card moves to a new handle chosen automatically from their name.{" "}
              <span className="font-mono">/card/{handle}</span> stops leading to them, any other
              member can claim it, and they can never take it back. Any chip, QR code or link
              carrying it needs rewriting: until then it shows “card not available”, or the card
              of whoever claims the handle next.
            </Alert>
          ) : (
            <Alert tone="danger" title={`/card/${handle} will stop redirecting to ${name}`}>
              It becomes free for any other member to claim, and they can never take it back. Any
              chip, QR code or link carrying it shows “card not available”, or the card of whoever
              claims the handle next. Their current handle, {row.handle}, isn't affected.
            </Alert>
          )}
          {chipCarriesThisHandle && (
            <Alert tone="warning" title="Their NFC chip carries this handle">
              {isCurrent
                ? "Rewrite it with their new address once this is done, then mark it written."
                : `Rewrite it with their current address, /card/${row.handle}, then mark it written.`}
            </Alert>
          )}
          <Field
            label="Reason"
            required
            error={errors.reason?.message}
            hint="Recorded in the audit log with your name."
          >
            {(props) => (
              <Textarea
                {...props}
                {...register("reason")}
                maxLength={CARD_LIMITS.hiddenReason}
                placeholder="The handle impersonates another member."
              />
            )}
          </Field>
        </form>
      )}
    </Dialog>
  );
}

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
import { useResetCardHandle } from "./useAdminCards";

/**
 * Take a handle away: for one that impersonates someone or shouldn't be on a
 * chapter domain. The member gets their next suggested handle automatically.
 *
 * This is the one action that breaks a working chip. A renamed handle keeps
 * redirecting forever; a reset one is deleted so it no longer points at the
 * member at all, and it's blocked for them so they can't save it again. The
 * dialog says that plainly, and louder when the records show the member's chip
 * carries this exact handle. (Their older handles are released one at a time,
 * from ReleaseHandleDialog.)
 */
export function ResetHandleDialog({
  row,
  onClose,
}: {
  row: RowWithCard | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const resetHandle = useResetCardHandle();
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

  const chipCarriesThisHandle = Boolean(row?.chip_written_at && row.chip_handle === row.handle);

  const onSubmit = handleSubmit(async ({ reason }) => {
    if (!row) return;
    try {
      const result = await resetHandle.mutateAsync({ memberId: row.member_id, reason });
      toast.success(
        `${name}'s handle is now ${result.handle}`,
        chipCarriesThisHandle
          ? `/card/${result.old_handle} no longer works. Rewrite their chip with the new address, then mark it written.`
          : `/card/${result.old_handle} no longer works.`,
      );
      close();
    } catch (error) {
      toast.error("We couldn't reset that handle", errorText(error));
    }
  });

  return (
    <Dialog
      open={row !== null}
      onClose={close}
      title={name ? `Reset ${name}'s handle?` : "Reset this handle?"}
      description="They get a new handle from their name, chosen automatically."
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={resetHandle.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={resetHandle.isPending}>
            Reset handle
          </Button>
        </>
      }
    >
      {row && (
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
          <Alert tone="danger" title={`/card/${row.handle} will stop working`}>
            Unlike a handle the member changes themselves, a reset handle doesn't redirect. It
            becomes free for any other member to claim, and they can never take it back. Any chip,
            QR code or link carrying it shows “card not available”, or the card of whoever claims
            it next.
          </Alert>
          {chipCarriesThisHandle && (
            <Alert tone="warning" title="Their NFC chip carries this handle">
              The chip will stop opening their card until it's rewritten with the new address.
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

import { useCallback, useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Alert, Field, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { useAppConfig } from "@/hooks/useAppConfig";
import { memberName } from "@/services/members";
import { errorText } from "@/lib/errors";
import { cardHideSchema, type CardHideValues } from "@/lib/validation";
import { CARD_LIMITS } from "@/features/cards/model";
import type { RowWithCard } from "./adminCardRows";
import { useSetCardHidden } from "./useAdminCards";

/**
 * Hide or unhide a member's card. Moderation, so hiding needs a reason: the
 * member sees it in My Card (they deserve to know why their card stopped
 * working) and it goes into the audit log with the officer's name.
 *
 * Unhiding needs no reason and clears the old one, so a card that comes back
 * doesn't keep telling its owner it was hidden.
 */
export function HideCardDialog({ row, onClose }: { row: RowWithCard | null; onClose: () => void }) {
  if (row?.status === "hidden") return <UnhideDialog row={row} onClose={onClose} />;
  return <HideDialog row={row} onClose={onClose} />;
}

function HideDialog({ row, onClose }: { row: RowWithCard | null; onClose: () => void }) {
  const toast = useToast();
  const formId = useId();
  const setHidden = useSetCardHidden();
  const name = row ? memberName(row) : "";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CardHideValues>({
    resolver: zodResolver(cardHideSchema),
    defaultValues: { reason: "" },
  });

  // Stable, because Dialog re-runs its focus handling whenever onClose changes.
  const close = useCallback(() => {
    reset({ reason: "" });
    onClose();
  }, [reset, onClose]);

  const onSubmit = handleSubmit(async ({ reason }) => {
    if (!row) return;
    try {
      await setHidden.mutateAsync({ memberId: row.member_id, hidden: true, reason });
      toast.success(`${name}'s card is hidden`, "They can see your reason in My Card.");
      close();
    } catch (error) {
      toast.error("We couldn't hide that card", errorText(error));
    }
  });

  return (
    <Dialog
      open={row !== null}
      onClose={close}
      title={name ? `Hide ${name}'s card?` : "Hide this card?"}
      description={
        row ? (
          <>
            <span className="font-mono">/card/{row.handle}</span> stops opening for everyone until
            you unhide it.
          </>
        ) : undefined
      }
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={setHidden.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={setHidden.isPending}>
            Hide card
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
        <Alert tone="warning">
          Their chip, QR code and shared links all show “card not available”, the same page as a
          card that doesn't exist. Nothing on the card is deleted.
        </Alert>
        <Field
          label="Reason"
          required
          error={errors.reason?.message}
          hint="The member sees this in My Card, and it's recorded in the audit log with your name."
        >
          {(props) => (
            <Textarea
              {...props}
              {...register("reason")}
              maxLength={CARD_LIMITS.hiddenReason}
              placeholder="The headline impersonates an officer."
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function UnhideDialog({ row, onClose }: { row: RowWithCard; onClose: () => void }) {
  const toast = useToast();
  const setHidden = useSetCardHidden();
  const config = useAppConfig();
  const name = memberName(row);
  /*
   * Unhiding a published card only makes it live while the feature switch is
   * on. Telling an officer it's "live again" before launch would send them to
   * a page that says “card not available”. While the switch is still loading,
   * neither claim is made.
   */
  const cardsSwitch = config.data?.cards_enabled;
  // A suspended (or pending) member's card resolves as "not available"
  // whatever its own state, the same rule get_public_card() applies.
  const membershipBlocks = !(["active", "alumni", "inactive"] as const).some(
    (status) => status === row.membership_status,
  );

  const publishedNote = membershipBlocks
    ? `It's published, but their membership is ${row.membership_status}, so /card/${row.handle} won't open until that changes.`
    : cardsSwitch === true
      ? `It's published, so it opens again at /card/${row.handle} straight away.`
      : cardsSwitch === false
        ? `It's published, but business cards are switched off, so /card/${row.handle} won't open until you turn them on.`
        : "It's published, so it opens again whenever business cards are on.";

  const confirm = async () => {
    try {
      await setHidden.mutateAsync({ memberId: row.member_id, hidden: false, reason: null });
      toast.success(
        `${name}'s card is back`,
        !row.is_published
          ? "It's still unpublished."
          : membershipBlocks
            ? `It won't open while their membership is ${row.membership_status}.`
            : cardsSwitch === true
            ? `It's live again at /card/${row.handle}.`
            : cardsSwitch === false
              ? `It goes live at /card/${row.handle} when business cards are turned on.`
              : `It's published again at /card/${row.handle}.`,
      );
      onClose();
    } catch (error) {
      toast.error("We couldn't unhide that card", errorText(error));
    }
  };

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => void confirm()}
      loading={setHidden.isPending}
      destructive={false}
      confirmLabel="Unhide card"
      title={`Unhide ${name}'s card?`}
      description={
        <>
          {row.is_published
            ? publishedNote
            : "It isn't published, so it stays private until they publish it."}{" "}
          The hide reason is cleared from their editor. This is recorded in the audit log.
        </>
      }
    >
      {row.hidden_reason && (
        <p className="text-sm text-gray-700">
          <span className="font-medium text-shpe-navy">Hidden because:</span> {row.hidden_reason}
        </p>
      )}
    </ConfirmDialog>
  );
}

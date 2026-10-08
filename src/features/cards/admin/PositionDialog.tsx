import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { memberName } from "@/services/members";
import { BOARD_POSITIONS } from "@/services/officers";
import { errorText } from "@/lib/errors";
import { chapterPositionSchema, type ChapterPositionValues } from "@/lib/validation";
import { CARD_LIMITS } from "@/features/cards/model";
import type { AdminCardRow } from "@/types/database";
import { useSetChapterPosition } from "./useAdminCards";

export type PositionTarget = Pick<
  AdminCardRow,
  "member_id" | "first_name" | "last_name" | "email" | "position"
>;

/**
 * Set or clear a member's verified chapter position. This is the only source of
 * the ✔ "WashU SHPE · President" line on a card; members can't claim one
 * themselves, which is what makes the check mark mean something. It works for
 * members without a card too, so it's ready the moment they make one.
 */
export function PositionDialog({
  member,
  onClose,
}: {
  member: PositionTarget | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const setPosition = useSetChapterPosition();
  const name = member ? memberName(member) : "";

  const save = async (title: string | null) => {
    if (!member) return;
    try {
      await setPosition.mutateAsync({ memberId: member.member_id, title });
      toast.success(
        title ? `${name} is now listed as ${title}` : `${name}'s position was removed`,
        title ? "It shows on their card with a check mark." : undefined,
      );
      onClose();
    } catch (error) {
      toast.error("We couldn't change that position", errorText(error));
    }
  };

  return (
    <Dialog
      open={member !== null}
      onClose={onClose}
      title={name ? `Chapter position for ${name}` : "Chapter position"}
      description="Shown on their card with a check mark as “WashU SHPE · President”. Only officers can set it."
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={setPosition.isPending}>
            Cancel
          </Button>
          {member?.position && (
            <Button
              variant="outline"
              onClick={() => void save(null)}
              disabled={setPosition.isPending}
            >
              Remove position
            </Button>
          )}
          <Button type="submit" form={formId} loading={setPosition.isPending}>
            Save position
          </Button>
        </>
      }
    >
      {member && (
        <PositionForm
          key={member.member_id}
          formId={formId}
          defaultTitle={member.position ?? ""}
          onSubmit={(title) => save(title === "" ? null : title)}
        />
      )}
    </Dialog>
  );
}

function PositionForm({
  formId,
  defaultTitle,
  onSubmit,
}: {
  formId: string;
  defaultTitle: string;
  onSubmit: (title: string) => Promise<void>;
}) {
  const suggestionsId = useId();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChapterPositionValues>({
    // 2–60 characters or blank, the same rule as admin_set_chapter_position().
    resolver: zodResolver(chapterPositionSchema),
    defaultValues: { title: defaultTitle },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(({ title }) => onSubmit(title))} noValidate>
      <Field
        label="Position"
        error={errors.title?.message}
        hint="Leave blank to remove it. Also lists them on Meet your officers. Recorded in the audit log."
      >
        {(props) => (
          <>
            <Input
              {...props}
              {...register("title")}
              list={suggestionsId}
              maxLength={CARD_LIMITS.positionTitle}
              autoComplete="off"
              placeholder="President"
            />
            {/* The Leadership page's titles, so the board sorts and reads the
                same everywhere. Anything else can still be typed. */}
            <datalist id={suggestionsId}>
              {BOARD_POSITIONS.map((title) => (
                <option key={title} value={title} />
              ))}
            </datalist>
          </>
        )}
      </Field>
    </form>
  );
}

import { Alert, Card, CardBody, CardHeader, CardTitle, Field, Select } from "@/components/ui/primitives";
import { ErrorState, SkeletonList } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { errorText } from "@/lib/errors";
import { memberName } from "@/services/members";
import { BOARD_POSITIONS } from "@/services/officers";
import type { ProfileRow } from "@/types/database";
import { useAdminCards, useSetChapterPosition } from "./useAdminCards";

/**
 * A member's chapter position on their detail page: President, Treasurer and
 * the rest of the Leadership page's titles.
 *
 * The same position Admin → Business Cards sets, stored once in
 * chapter_positions. It's what Meet your officers lists and what the verified
 * line on their card says. It grants nothing: officer access is Roles, and no
 * policy reads a position.
 *
 * Read from the shared admin card list, like MemberCardSummary, so the two
 * cards on this tab agree and cost one request between them.
 */
export function MemberPositionCard({
  member,
}: {
  member: Pick<ProfileRow, "id" | "first_name" | "last_name" | "email" | "membership_status">;
}) {
  const toast = useToast();
  const cards = useAdminCards();
  const setPosition = useSetChapterPosition();

  const row = cards.data?.rows.find((r) => r.member_id === member.id) ?? null;
  const current = row?.position ?? "";
  // A title set by hand in Business Cards may not be one of the board's. Keep
  // it selectable rather than showing "No position" for someone who has one.
  const custom = current !== "" && !BOARD_POSITIONS.includes(current);

  const change = async (title: string) => {
    const name = memberName(member);
    try {
      await setPosition.mutateAsync({ memberId: member.id, title: title || null });
      toast.success(title ? `${name} is now listed as ${title}` : `${name}'s position was removed`);
    } catch (error) {
      toast.error("We couldn't change that position", errorText(error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Officer position</CardTitle>
      </CardHeader>
      <CardBody>
        {cards.isPending ? (
          <SkeletonList rows={1} />
        ) : cards.isError ? (
          <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />
        ) : !row ? (
          <Alert tone="info">
            {member.membership_status === "pending"
              ? "Approve this member's account before giving them a position."
              : "This member isn't in the member list yet. Reload the page to check again."}
          </Alert>
        ) : (
          <Field
            label="Position"
            hint="Listed on Meet your officers in My SHPE and on their business card. It doesn't grant or remove any access; use Roles for that. Recorded in the audit log."
          >
            {(props) => (
              <Select
                {...props}
                value={current}
                disabled={setPosition.isPending}
                onChange={(e) => void change(e.target.value)}
              >
                <option value="">No position</option>
                {custom && <option value={current}>{current}</option>}
                {BOARD_POSITIONS.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </CardBody>
    </Card>
  );
}

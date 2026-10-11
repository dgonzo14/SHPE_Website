import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { useAppConfig } from "@/hooks/useAppConfig";
import { memberName } from "@/services/members";
import { errorText } from "@/lib/errors";
import { membershipShowsCard, publishNotes, type RowWithCard } from "./adminCardRows";
import { useSetCardsPublished } from "./useAdminCards";

/** One card or several, and which way. */
export interface PublishRequest {
  rows: RowWithCard[];
  publish: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Publish or unpublish members' cards on their behalf: the same switch the
 * member has in My Card, from Admin → Business Cards, for one card from its
 * row or for every selected card at once.
 *
 * It says what the visitor will actually get before anything changes. A
 * member's unpublished draft may not be finished; a starter card shows only
 * the starter fields until its owner opens it; and publishing doesn't undo a
 * hide, a blocked membership or the feature switch. Unpublishing tells the
 * officer it isn't moderation: the member can publish again, and a card that
 * has to stay down should be hidden, with a reason they can read.
 *
 * Only cards whose state would change are sent, so a stale row or a mixed
 * selection can't record anything twice (the database checks that too).
 */
export function PublishCardsDialog({
  request,
  onClose,
}: {
  request: PublishRequest | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const setPublished = useSetCardsPublished();
  const config = useAppConfig();
  const cardsSwitch = config.data?.cards_enabled;

  const publish = request?.publish ?? true;
  const rows = (request?.rows ?? []).filter((row) => row.is_published !== publish);
  const single = rows.length === 1 ? rows[0] : null;
  const name = single ? memberName(single) : "";
  const notes = publishNotes(rows);

  /** Where the cards stand now, in a sentence: live, or what still keeps them down. */
  const outcome = (): string => {
    if (!publish) {
      return single
        ? `/card/${single.handle} shows “card not available” until it's published again.`
        : "Their addresses show “card not available” until they're published again.";
    }
    if (cardsSwitch === false) {
      return single
        ? `It goes live at /card/${single.handle} when business cards are turned on.`
        : "They go live when business cards are turned on.";
    }
    if (single) {
      if (single.status === "hidden") return "It stays hidden until you unhide it.";
      if (!membershipShowsCard(single)) {
        return `It won't open while their membership is ${single.membership_status}.`;
      }
      return `It's live at /card/${single.handle}.`;
    }
    return notes.hidden.length + notes.blocked.length > 0
      ? "Hidden cards, and cards of members who aren't active, stay offline."
      : "They're live now.";
  };

  const confirm = async () => {
    if (rows.length === 0) return;
    try {
      const result = await setPublished.mutateAsync({
        memberIds: rows.map((row) => row.member_id),
        published: publish,
      });
      onClose();
      const changed = result.changed.length;
      const missed = result.unchanged.length + result.skipped.length;
      if (changed === 0) {
        toast.info(
          "Nothing changed",
          publish ? "Those cards were already published." : "Those cards were already unpublished.",
        );
        return;
      }
      const title = single
        ? `${name}'s card is ${publish ? "published" : "unpublished"}`
        : `${publish ? "Published" : "Unpublished"} ${plural(changed, "card", "cards")}`;
      toast.success(
        title,
        missed > 0
          ? `${outcome()} ${plural(missed, "card was", "cards were")} already ${publish ? "published" : "unpublished"} or gone, and left alone.`
          : outcome(),
      );
    } catch (error) {
      toast.error(
        publish ? "We couldn't publish that" : "We couldn't unpublish that",
        errorText(error),
      );
    }
  };

  const title = !request
    ? ""
    : single
      ? `${publish ? "Publish" : "Unpublish"} ${name}'s card?`
      : `${publish ? "Publish" : "Unpublish"} ${plural(rows.length, "card", "cards")}?`;

  const confirmLabel = single
    ? publish
      ? "Publish card"
      : "Unpublish card"
    : `${publish ? "Publish" : "Unpublish"} ${plural(rows.length, "card", "cards")}`;

  const description = publish ? (
    <>
      {single ? (
        <>
          <span className="font-mono">/card/{single.handle}</span> opens for anyone with the link,
          their chip or a QR code
        </>
      ) : (
        "Each card opens at its address for anyone with the link, the member's chip or a QR code"
      )}
      {cardsSwitch === false ? ", once business cards are turned on." : "."} It's recorded in the
      audit log with your name.
    </>
  ) : (
    <>
      {single ? (
        <>
          <span className="font-mono">/card/{single.handle}</span> shows
        </>
      ) : (
        "Their addresses show"
      )}{" "}
      “card not available” on chips, QR codes and shared links until{" "}
      {single ? "it's" : "they're"} published again. Nothing on {single ? "the card" : "the cards"}{" "}
      is deleted, and it's recorded in the audit log with your name.
    </>
  );

  return (
    <ConfirmDialog
      open={request !== null && rows.length > 0}
      onClose={onClose}
      onConfirm={() => void confirm()}
      loading={setPublished.isPending}
      destructive={!publish}
      confirmLabel={confirmLabel}
      title={title}
      description={description}
    >
      <div className="space-y-3">
        {publish ? (
          <>
            {notes.drafts.length > 0 && (
              <Alert tone="warning">
                {single
                  ? `${name} set this card up but hasn't published it, so it may not be finished.`
                  : `${plural(notes.drafts.length, "card is a draft its owner hasn't", "cards are drafts their owners haven't")} published, so ${notes.drafts.length === 1 ? "it" : "they"} may not be finished.`}{" "}
                {single ? "They aren't" : "Members aren't"} notified;{" "}
                {single ? "they'll see it" : "they'll see their card"} as live in My Card and can
                unpublish {single ? "it" : "it there"}.
              </Alert>
            )}
            {notes.starters.length > 0 && (
              <Alert tone="info">
                {single
                  ? `Until ${name} opens My Card, it shows only their name, school, education and chapter position.`
                  : `${plural(notes.starters.length, "is a starter card", "are starter cards")}: name, school, education and chapter position only, until ${notes.starters.length === 1 ? "its owner opens" : "their owners open"} My Card.`}
              </Alert>
            )}
            {notes.hidden.length > 0 && (
              <Alert tone="info">
                {single
                  ? "It's hidden, and stays hidden until you unhide it."
                  : `${plural(notes.hidden.length, "is hidden and stays", "are hidden and stay")} hidden until you unhide ${notes.hidden.length === 1 ? "it" : "them"}.`}
              </Alert>
            )}
            {notes.blocked.length > 0 && (
              <Alert tone="info">
                {single
                  ? `Their membership is ${single.membership_status}, so it won't open until that changes.`
                  : `${plural(notes.blocked.length, "member isn't", "members aren't")} active, so ${notes.blocked.length === 1 ? "that card won't" : "those cards won't"} open until that changes.`}
              </Alert>
            )}
          </>
        ) : (
          <Alert tone="info">
            {single ? `${name} isn't` : "Members aren't"} notified, and can publish again from My
            Card. To keep a card down, hide it instead: hiding needs a reason, which the member can
            read.
          </Alert>
        )}

        {!single && rows.length > 0 && (
          <ul
            aria-label={publish ? "Cards to publish" : "Cards to unpublish"}
            className="max-h-48 space-y-1 overflow-y-auto text-sm text-gray-700"
          >
            {rows.map((row) => (
              <li key={row.member_id}>
                {memberName(row)} · <span className="font-mono">{row.handle}</span>
                {publish && !membershipShowsCard(row) && (
                  <span className="text-gray-600"> ({row.membership_status})</span>
                )}
                {publish && row.status === "hidden" && <span className="text-gray-600"> (hidden)</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ConfirmDialog>
  );
}

import { Link } from "react-router-dom";

import { Alert } from "@/components/ui/primitives";
import { formatDate } from "@/lib/datetime";
import type { MyCardState } from "@/types/database";
import { displayCardUrl } from "./editorUtils";

/**
 * What the member needs to know about their card before editing it, most
 * serious first:
 *
 *   hidden          an officer hid it; only an officer can undo that
 *   switched off    an officer is setting up their card before launch
 *   officer-made    someone made it for them (card-writing night) and they
 *                   haven't opened it yet
 *   draft / new     nothing is public until they publish
 *
 * Statuses, not alerts: they describe the page as it loads, so they shouldn't
 * interrupt a screen reader the way an error does.
 */
export function EditorBanners({ state, isOfficer }: { state: MyCardState; isOfficer: boolean }) {
  const card = state.card;
  const hidden = Boolean(card?.hidden_at);
  const officerMade = Boolean(card && card.created_by_officer && card.member_opened_at === null);

  return (
    <div className="space-y-3 empty:hidden">
      {card && hidden && (
        <Alert tone="warning" title="An officer has hidden your card">
          <p>
            Nobody can see it at{" "}
            <span className="break-all font-medium">{displayCardUrl(card.handle)}</span> right
            now, whether or not it's published. Tapping your NFC card shows “card not available”.
          </p>
          {card.hidden_reason && (
            <p className="mt-2">
              <span className="font-semibold">Reason given:</span> “{card.hidden_reason}”
            </p>
          )}
          <p className="mt-2">
            Only an officer can unhide it, so talk to one of the chapter officers if you have
            questions. You can keep editing in the meantime.
          </p>
        </Alert>
      )}

      {!state.enabled && (
        <Alert tone="warning" title="Business cards are switched off for members">
          You can set up your card now because you're an officer, but nobody can see any card yet,
          yours included, until business cards are turned on
          {isOfficer ? (
            <>
              {" "}
              in{" "}
              <Link to="/admin/cards" className="font-medium underline underline-offset-2">
                Admin › Cards
              </Link>
            </>
          ) : null}
          . Treat this page as a preview until then.
        </Alert>
      )}

      {card && officerMade && !hidden && (
        <Alert tone="info" title="Your card is ready to finish">
          An officer set up your card on {formatDate(card.created_at)}.{" "}
          {card.chip_handle ? (
            <>
              Your NFC card points to{" "}
              <span className="break-all font-medium">{displayCardUrl(card.chip_handle)}</span>.
            </>
          ) : (
            <>
              Its address is{" "}
              <span className="break-all font-medium">{displayCardUrl(card.handle)}</span>.
            </>
          )}{" "}
          {card.is_published
            ? "It's live as a starter card with just your name and school. When you save, everything you add goes live too."
            : "Add your links and publish it."}
        </Alert>
      )}

      {card && !officerMade && !hidden && !card.is_published && (
        <Alert tone="info" title="Your card is a draft">
          Only you can see it. When you're happy with how it looks, turn on Publish and it goes live
          at <span className="break-all font-medium">{displayCardUrl(card.handle)}</span>.
        </Alert>
      )}

      {!card && (
        <Alert tone="info" title="Set up your card">
          Your name and school are filled in from your profile. Add your links, save, and then
          publish it. Nothing is public until you do.
        </Alert>
      )}
    </div>
  );
}

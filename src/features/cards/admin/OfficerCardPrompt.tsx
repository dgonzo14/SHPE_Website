import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { useAppConfig } from "@/hooks/useAppConfig";
import { cardUrl, fetchMyCard, isMyCardState } from "@/services/cards";
import { queryKeys } from "@/services/queryKeys";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * The dashboard's nudge for a member whose card an officer made before they
 * ever opened My Card, usually just before card-writing night. Their chip may
 * already point at it, so it's worth telling them it exists and that it's
 * theirs to finish.
 *
 * Asks for the card only when the portal menu would offer My Card (officers
 * always, everyone else once cards are switched on), so members never pay for
 * a request about a feature they can't see. Shares its cache with the editor,
 * so the first save there, which sets member_opened_at, makes this disappear.
 * A failed request shows nothing: this is a reminder, not something to fix.
 */
export function OfficerCardPrompt({ className }: { className?: string }) {
  const { isOfficer } = useAuth();
  const config = useAppConfig();
  const showCards = isOfficer || config.data?.cards_enabled === true;

  const myCard = useQuery({
    queryKey: queryKeys.cards.mine,
    queryFn: fetchMyCard,
    enabled: showCards,
  });

  if (!showCards || !isMyCardState(myCard.data)) return null;
  const card = myCard.data.card;
  // A hidden card can't be published, so "publish it" would be advice they
  // can't follow; the editor explains a hidden card instead.
  if (!card || !card.created_by_officer || card.member_opened_at !== null || card.hidden_at) {
    return null;
  }

  const address = cardUrl(card.handle).replace(/^https?:\/\//, "");
  // Officers see this before launch too, while the switch is off and nothing is
  // live yet; "it's live" would send them to a page that says it isn't.
  const cardsOn = myCard.data.enabled;

  return (
    <section aria-label="Your business card" className={cn(className)}>
      <Alert tone="info" title="An officer set up your business card">
        <p className="max-w-[65ch]">
          They made it on {formatDate(card.created_at)} at{" "}
          <span className="break-all font-medium">{address}</span>
          {card.chip_handle === card.handle && card.chip_written_at
            ? ", and that's the address on your NFC card."
            : "."}{" "}
          {!card.is_published
            ? "Add your links and publish it."
            : cardsOn
              ? "It's live as a starter card with just your name and school. Add your links to make it yours."
              : "It's published as a starter card with just your name and school, and goes live when business cards are turned on. Add your links to make it yours."}
        </p>
        <LinkButton to="/portal/card" variant="secondary" size="sm" className="mt-3 min-h-[44px]">
          Finish my card
          <ArrowRight className="h-4 w-4" aria-hidden />
        </LinkButton>
      </Alert>
    </section>
  );
}

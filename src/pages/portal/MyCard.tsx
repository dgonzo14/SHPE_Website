import { ExternalLink, IdCard } from "lucide-react";

import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, Skeleton } from "@/components/ui/primitives";
import { EmptyState, ErrorState, PageHeader } from "@/components/shared/states";
import { usePageMeta } from "@/hooks/usePageMeta";
import { cardUrl, isMyCardState } from "@/services/cards";
import { CardEditor } from "@/features/cards/editor/CardEditor";
import { useMyCard, useSuggestedHandle } from "@/features/cards/editor/useMyCard";

const DESCRIPTION =
  "Your digital business card: what people see when they tap your NFC card or scan your QR code.";

function EditorSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Card className="p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-3 w-2/3" />
      </Card>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card>
          <div className="flex gap-4 border-b border-shpe-rule px-4 py-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-16" />
            ))}
          </div>
          <CardBody className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-11 w-full" />
              </div>
            ))}
          </CardBody>
        </Card>
        <Skeleton className="hidden h-[640px] w-full rounded-[2.75rem] lg:block" />
      </div>
    </div>
  );
}

/**
 * /portal/card: the member's own business card editor.
 *
 * get_my_card() decides whether there's anything to edit. While officers have
 * cards switched off, members get `{ enabled: false }` and this page explains
 * that calmly; officers get their card anyway, to set it up before launch.
 * Before a member has a card, the editor starts from their profile name and
 * the suggested handle, so the wait for that suggestion is part of loading.
 */
export function MyCard() {
  usePageMeta({ title: "My Card | My SHPE", noindex: true });

  const myCard = useMyCard();
  const state = isMyCardState(myCard.data) ? myCard.data : null;
  const needsSuggestion = state !== null && state.card === null;
  const suggestion = useSuggestedHandle(needsSuggestion);

  const card = state?.card ?? null;
  const viewable = Boolean(card?.is_published && !card.hidden_at && state?.enabled);

  const header = (
    <PageHeader
      title="My Card"
      description={DESCRIPTION}
      actions={
        viewable && card ? (
          <LinkButton to={cardUrl(card.handle)} external variant="outline">
            View my card
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </LinkButton>
        ) : undefined
      }
    />
  );

  if (myCard.isPending || (needsSuggestion && suggestion.isPending)) {
    return (
      <>
        {header}
        <EditorSkeleton />
        <span role="status" className="sr-only">
          Loading your card
        </span>
      </>
    );
  }

  // Only when there's nothing to show: a background refetch that fails (the
  // refresh on reconnecting, over a connection that's still flaky) keeps the
  // last good data, and swapping the editor out for an error then would throw
  // away unsaved edits.
  if (myCard.isError && myCard.data === undefined) {
    return (
      <>
        {header}
        <ErrorState
          error={myCard.error}
          fallback="We couldn't load your card"
          onRetry={() => void myCard.refetch()}
        />
      </>
    );
  }

  if (!state) {
    return (
      <>
        {header}
        <EmptyState
          icon={IdCard}
          title="Business cards aren't open yet"
          description="Chapter officers will switch them on when the NFC cards are ready. When they do, you'll set up your card right here."
          action={
            <LinkButton to="/portal" variant="outline">
              Back to the dashboard
            </LinkButton>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      {/* A failed suggestion only means an empty handle field to fill in. */}
      <CardEditor state={state} suggestedHandle={suggestion.data ?? null} />
    </>
  );
}

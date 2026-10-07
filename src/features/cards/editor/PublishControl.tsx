import { useCallback, useId, useState } from "react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Card, CardBody } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { cardUrl } from "@/services/cards";
import type { MemberCard } from "@/types/database";
import { displayCardUrl } from "./editorUtils";
import { useSetMyCardPublished } from "./useMyCard";

function statusText(card: MemberCard | null, featureEnabled: boolean): string {
  if (!card) return "Save your card first. Then you can publish it.";
  if (card.hidden_at) {
    return "An officer has hidden your card, so nobody can see it, even when it's published.";
  }
  if (card.is_published && !featureEnabled) {
    return "Published, but business cards are switched off, so nobody can see it until they're turned on.";
  }
  if (card.is_published) {
    return "Live. Anyone who taps your NFC card, scans your QR code or opens your link can see it.";
  }
  return "Draft. Only you can see it. Tapping your NFC card shows “card not available” until you publish.";
}

/**
 * The publish switch.
 *
 * Off until the card has been saved once: there's nothing in the database to
 * publish before that. Publishing while there are unsaved edits asks first,
 * because the switch publishes the saved card, and someone who just changed
 * their phone number expects the new one to be what goes live.
 */
export function PublishControl({
  card,
  featureEnabled,
  isDirty,
  saving,
  onSave,
}: {
  card: MemberCard | null;
  /** The cards_enabled switch. */
  featureEnabled: boolean;
  isDirty: boolean;
  saving: boolean;
  /** Validates and saves the form; resolves true when the card was saved. */
  onSave: () => Promise<boolean>;
}) {
  const toast = useToast();
  const publish = useSetMyCardPublished();
  const [askToSave, setAskToSave] = useState(false);
  // Stable on purpose: Dialog re-runs its open effect when onClose changes,
  // which would pull focus off the dialog's buttons whenever this re-renders.
  const closeAskToSave = useCallback(() => setAskToSave(false), []);
  const labelId = useId();
  const descId = useId();

  const published = Boolean(card?.is_published);
  const busy = publish.isPending || saving;

  const setPublished = async (next: boolean) => {
    try {
      const result = await publish.mutateAsync(next);
      const handle = result.card?.handle ?? card?.handle ?? "";
      if (next) {
        toast.success("Your card is published", `It's at ${displayCardUrl(handle)}.`);
      } else {
        toast.success("Your card is unpublished", "Only you can see it now.");
      }
    } catch (error) {
      toast.error(
        next ? "We couldn't publish your card" : "We couldn't unpublish your card",
        errorText(error),
      );
    }
  };

  const onToggle = () => {
    if (!card || busy) return;
    if (!published && isDirty) {
      setAskToSave(true);
      return;
    }
    void setPublished(!published);
  };

  const saveThenPublish = async () => {
    setAskToSave(false);
    if (await onSave()) await setPublished(true);
  };

  return (
    <Card>
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p id={labelId} className="font-semibold text-shpe-navy">
              Publish my card
            </p>
            {card && (
              <Badge tone={card.hidden_at ? "danger" : published ? "success" : "neutral"}>
                {card.hidden_at ? "Hidden" : published ? "Live" : "Draft"}
              </Badge>
            )}
          </div>
          <p id={descId} className="max-w-[60ch] text-sm text-gray-600">
            {statusText(card, featureEnabled)}
          </p>
          {card && published && (
            <a
              href={cardUrl(card.handle)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 break-all text-sm font-medium text-shpe-navy underline underline-offset-4"
            >
              {displayCardUrl(card.handle)}
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={published}
          aria-labelledby={labelId}
          aria-describedby={descId}
          aria-busy={publish.isPending || undefined}
          disabled={!card || busy}
          onClick={onToggle}
          className={cn(
            "relative inline-flex h-11 w-[4.75rem] shrink-0 items-center self-start rounded-full border-2 transition-colors sm:self-center",
            "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy",
            "disabled:cursor-not-allowed disabled:opacity-60",
            published ? "border-emerald-700 bg-emerald-700" : "border-gray-500 bg-gray-200",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-block h-8 w-8 rounded-full border bg-white shadow transition-transform",
              published ? "translate-x-9 border-white" : "translate-x-1 border-gray-500",
            )}
          />
        </button>
      </CardBody>

      <Dialog
        open={askToSave}
        onClose={closeAskToSave}
        title="Save your changes first?"
        description="Publishing puts your last saved card live. The changes you haven't saved would stay private until you save them."
        size="sm"
        footer={
          <>
            <Button variant="subtle" onClick={closeAskToSave}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setAskToSave(false);
                void setPublished(true);
              }}
            >
              Publish last saved
            </Button>
            <Button onClick={() => void saveThenPublish()}>Save and publish</Button>
          </>
        }
      />
    </Card>
  );
}

import { Share2, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonClass } from "./styles";

/**
 * Add to Contacts and Share, on every card whatever its sections. Add to
 * Contacts is the reason someone tapped the card, so it's the primary button
 * and comes straight after the header, above the fold on any phone.
 *
 * Share is a square icon button beside it, so "Add to Contacts" stays on one
 * line down to a 320px screen. It has an accessible name and a tooltip, and
 * uses the neutral treatment (body text on the surface, a hairline border)
 * rather than the member's button style: under a filled style the accent is
 * only checked at 3:1, which is enough for an icon but not a label.
 *
 * These are real buttons in both modes; the page (or the editor) decides what
 * they do.
 */
export function ActionsBlock({
  onAddToContacts,
  onShare,
  showShare,
  icons,
}: {
  onAddToContacts?: () => void;
  onShare?: () => void;
  showShare: boolean;
  icons: boolean;
}) {
  return (
    <div
      data-part="actions"
      className={cn("grid gap-3", showShare ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1")}
    >
      <button
        type="button"
        onClick={() => onAddToContacts?.()}
        className={cn(buttonClass("primary"), "justify-center text-center")}
      >
        {/* Dropped on the narrowest screens so the label fits on one line. */}
        {icons && <UserPlus className="hidden size-5 shrink-0 @xs:block" />}
        Add to Contacts
      </button>
      {showShare && (
        <button
          type="button"
          onClick={() => onShare?.()}
          aria-label="Share"
          title="Share"
          className={cn(buttonClass("neutral"), "w-(--card-button-h) justify-center px-0")}
        >
          <Share2 className="size-5 shrink-0" />
        </button>
      )}
    </div>
  );
}

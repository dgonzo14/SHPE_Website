import { useId } from "react";

import { cn } from "@/lib/utils";
import type { PublicCardData } from "@/types/database";
import { BusinessCard } from "../BusinessCard";

/**
 * The live preview: the same BusinessCard the public page renders, in preview
 * mode, so what the member sees here is exactly what a visitor will see.
 *
 * "frame" draws a phone around it, sized like one, for the desktop column. The
 * card lays itself out with container queries, so the narrow frame gets the
 * phone layout even on a wide monitor. Its screen scrolls on its own and is
 * focusable, so keyboard users can scroll it too.
 *
 * "plain" drops the frame for the small-screen preview sheet, where the
 * phone the member is holding is the frame.
 */
export function PhonePreview({
  card,
  variant = "frame",
  className,
}: {
  card: PublicCardData;
  variant?: "frame" | "plain";
  className?: string;
}) {
  const captionId = useId();

  if (variant === "plain") {
    return (
      <figure aria-labelledby={captionId} className={cn("space-y-3", className)}>
        <figcaption id={captionId} className="text-sm text-gray-600">
          How your card looks right now, unsaved changes included. Links don't open here.
        </figcaption>
        <div className="overflow-hidden border border-shpe-rule">
          <BusinessCard mode="preview" card={card} />
        </div>
      </figure>
    );
  }

  return (
    <figure aria-labelledby={captionId} className={cn("space-y-3", className)}>
      <div className="mx-auto w-full max-w-[380px] rounded-[2.75rem] bg-shpe-navy p-2.5 shadow-[0_24px_48px_-24px_rgba(27,54,93,0.6)]">
        <div
          role="region"
          aria-label="Card preview"
          tabIndex={0}
          className="h-[min(740px,calc(100vh-10rem))] overflow-y-auto overscroll-contain rounded-[2.25rem] bg-white focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-orange"
        >
          <BusinessCard mode="preview" card={card} />
        </div>
      </div>
      <figcaption id={captionId} className="text-center text-xs text-gray-600">
        Live preview, unsaved changes included. Links don't open here.
      </figcaption>
    </figure>
  );
}

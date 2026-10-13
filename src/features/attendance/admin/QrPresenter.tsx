import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

import { buttonVariants } from "@/components/ui/buttonVariants";
import { cn } from "@/lib/utils";

/**
 * The attendance QR code filling the screen, for projecting at a meeting.
 *
 * Not the shared Dialog: that one is a card in the middle of a dimmed page,
 * capped at 90vh, and a code on a projector wants the whole screen with
 * nothing showing behind it. It keeps Dialog's manners, though: focus moves to
 * Close on open and back to whatever opened it on close, Escape dismisses, Tab
 * can't wander into the page underneath, and the page doesn't scroll behind.
 *
 * White whatever else is on the page: dark modules on a light ground is what
 * every phone camera reads, and the quiet zone around a code only works when
 * it matches the code's own background. Sized by the shorter side of the
 * viewport so it is as large as it can be on a wide projector and a portrait
 * phone alike.
 */
export function QrPresenter({
  open,
  onClose,
  eventTitle,
  url,
  qrSrc,
}: {
  open: boolean;
  onClose: () => void;
  eventTitle: string;
  /** What the code opens, printed small under it for anyone who can't scan. */
  url: string;
  /** The code as an image URL, the same one the card shows. */
  qrSrc: string;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Read through a ref so a parent re-rendering with a new inline onClose
  // doesn't re-run the effect below, which would bounce focus to the opener
  // and back. Dialog does the same, for the same reason.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        // Close is the only control here, so Tab has nowhere else to go.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white"
    >
      <div className="flex items-start justify-between gap-4 px-4 pt-4 sm:px-8 sm:pt-6">
        <h2
          id={titleId}
          className="min-w-0 text-2xl font-bold leading-tight text-shpe-navy sm:text-4xl"
        >
          {eventTitle}
        </h2>
        {/* A plain button styled like Button, because Button doesn't take a ref. */}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}
        >
          <X className="h-5 w-5" aria-hidden="true" />
          Close
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 pb-4 sm:pb-6">
        <p className="text-2xl font-semibold text-shpe-navy sm:text-4xl">Scan to check in</p>
        <img
          src={qrSrc}
          alt={`QR code that opens the attendance form at ${url}`}
          className="block aspect-square h-auto w-[min(66vh,90vw)] max-w-full"
        />
        <p className="max-w-full break-all text-center font-mono text-sm text-gray-600">{url}</p>
      </div>
    </div>
  );
}

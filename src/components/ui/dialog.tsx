import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog with the accessibility behaviour that makes one usable:
 * focus moves in on open and returns to the trigger on close, Tab is trapped
 * inside, Escape dismisses, and the background is inert to screen readers.
 *
 * Hand-rolled rather than pulled from a component library because the app needs
 * exactly one dialog pattern, and this keeps the dependency surface small.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!open) return;

      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeyDown, true);

    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const target =
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
    target?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      {/* Backdrop. Presentational: Escape and the close button are the real
          dismissal affordances, so it carries no interactive semantics. */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-shpe-navy">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-1 text-sm text-gray-600">
                {description}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-2 -mt-1 shrink-0"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>

        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Confirmation for destructive actions. The `description` should say what will
 * happen downstream, not just ask "are you sure?" — removing attendance also
 * reverses points, and the officer should know that before clicking.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  loading = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

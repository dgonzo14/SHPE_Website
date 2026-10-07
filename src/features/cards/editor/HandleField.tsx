import { useId } from "react";
import { useController, type Control } from "react-hook-form";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";

import { Alert, Input, Label } from "@/components/ui/primitives";
import { cardHandleSchema, type CardFormValues } from "@/lib/validation";
import { cn } from "@/lib/utils";
import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  MAX_HANDLES_PER_MEMBER,
  normalizeHandleInput,
} from "../model";
import { displayCardUrl } from "./editorUtils";
import { useHandleAvailability, type HandleStatus } from "./useMyCard";

type Tone = "neutral" | "success" | "danger";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-gray-600",
  success: "text-emerald-800",
  danger: "text-red-700",
};

function StatusIcon({ tone, busy }: { tone: Tone; busy?: boolean }) {
  const cls = "mt-0.5 h-4 w-4 shrink-0";
  if (busy) return <Loader2 className={cn(cls, "animate-spin")} aria-hidden="true" />;
  if (tone === "success") return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (tone === "danger") return <AlertCircle className={cls} aria-hidden="true" />;
  return <Info className={cls} aria-hidden="true" />;
}

function statusMessage(
  status: HandleStatus,
  { isCurrent, renaming }: { isCurrent: boolean; renaming: boolean },
): { tone: Tone; text: string; busy?: boolean } | null {
  if (isCurrent) return { tone: "neutral", text: "This is your card's current address." };
  switch (status) {
    case "idle":
      return null;
    case "checking":
      return { tone: "neutral", text: "Checking whether it's free…", busy: true };
    case "available":
      return {
        tone: "success",
        text: renaming
          ? `Available. After you save, your old address forwards here. You can use up to ${MAX_HANDLES_PER_MEMBER} handles in all.`
          : "Available. Saving your card claims it.",
      };
    case "yours":
      return { tone: "success", text: "You've used this handle before, so it's still yours." };
    case "taken":
      return {
        tone: "danger",
        text: "Someone else has this handle. Try adding your middle name or class year.",
      };
    case "reserved":
      return { tone: "danger", text: "This handle is kept for the chapter. Try another one." };
    case "removed":
      return {
        tone: "danger",
        text: "An officer removed this handle from your card, so you can't use it again. Try another one.",
      };
    case "invalid":
      return {
        tone: "danger",
        text: "This handle isn't allowed. Use letters, numbers and single hyphens.",
      };
    case "error":
      return {
        tone: "neutral",
        text: "We couldn't check this handle just now. You can still save, and it's checked again then.",
      };
  }
}

/**
 * The card's handle: the last part of washushpe.org/card/<handle>, and so
 * the address written to the member's NFC chip.
 *
 * Lowercased as it's typed (a space becomes a hyphen), checked against the
 * same rules as the database the moment it can be, then checked for
 * availability once typing pauses. The answer sits in a polite live region, so
 * a screen reader hears "available" or "taken" without leaving the field.
 *
 * A member whose chip carries a different handle is reminded that the chip
 * keeps working: every handle they've held forwards to their current one.
 */
export function HandleField({
  control,
  savedHandle,
  chipHandle,
  chipHandleActive = null,
}: {
  control: Control<CardFormValues>;
  /** The handle the card is saved with; null before the first save. */
  savedHandle: string | null;
  /** The handle written to the member's chip, if an officer recorded one. */
  chipHandle: string | null;
  /** false when an officer removed that handle from the card, so the chip no longer opens it. */
  chipHandleActive?: boolean | null;
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const hintId = `${id}-hint`;
  const urlId = `${id}-url`;
  const statusId = `${id}-status`;
  const errorId = `${id}-error`;

  const { field, fieldState } = useController({ control, name: "handle" });
  const value = field.value ?? "";
  const handle = normalizeHandleInput(value);

  const parsed = cardHandleSchema.safeParse(value);
  const clientError = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  const isCurrent = savedHandle !== null && handle === savedHandle;
  const status = useHandleAvailability(parsed.success && !isCurrent ? handle : null);

  // Rule messages wait until there's something worth judging: a field left,
  // a full-length attempt, or a character that can never be valid. "Use at
  // least 3 characters" on the first keystroke would only nag.
  const judge =
    value !== "" &&
    (fieldState.isTouched || handle.length >= HANDLE_MIN_LENGTH || /[^a-z0-9-]/.test(handle));
  const error = fieldState.error?.message ?? (judge ? clientError : null) ?? null;

  const message = parsed.success
    ? statusMessage(status, { isCurrent, renaming: savedHandle !== null })
    : null;
  const unavailable = message?.tone === "danger";
  const chipReminder = Boolean(chipHandle) && parsed.success && handle !== chipHandle;

  const describedBy = [hintId, parsed.success ? urlId : null, statusId, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>
        Handle
        <span className="ml-1 text-shpe-orange-dark" aria-hidden="true">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </Label>
      <Input
        // Spread, not an attribute: the primitive doesn't declare `ref`,
        // though React 19 passes it through. RHF needs it to focus the field.
        {...{ ref: field.ref }}
        id={inputId}
        name={field.name}
        value={value}
        onChange={(event) => field.onChange(event.target.value.toLowerCase().replace(/\s/g, "-"))}
        onBlur={field.onBlur}
        maxLength={HANDLE_MAX_LENGTH}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-required="true"
        aria-describedby={describedBy}
        invalid={Boolean(error) || unavailable}
        className="font-mono"
      />
      <p id={hintId} className="text-xs text-gray-500">
        {HANDLE_MIN_LENGTH}–{HANDLE_MAX_LENGTH} lowercase letters, numbers and hyphens. It's the
        address on your NFC card, so choose one you'll keep.
      </p>

      {parsed.success && (
        <p id={urlId} className="text-sm text-gray-700">
          Your card's address:{" "}
          <span className="break-all font-mono font-medium text-shpe-navy">
            {displayCardUrl(handle)}
          </span>
        </p>
      )}

      {/* Always in the DOM, so the first answer is announced too. */}
      <p id={statusId} role="status" aria-live="polite" className="text-sm">
        {message && (
          <span className={cn("flex items-start gap-1.5", TONE_TEXT[message.tone])}>
            <StatusIcon tone={message.tone} busy={message.busy} />
            <span>{message.text}</span>
          </span>
        )}
      </p>

      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {chipHandle && chipHandleActive === false ? (
        <Alert tone="warning" title="Your NFC card needs rewriting" className="mt-3">
          It was written with{" "}
          <span className="break-all font-mono font-medium">{displayCardUrl(chipHandle)}</span>,
          which an officer removed from your card. A tap now shows “card not available”, or another
          member's card if someone has claimed that handle since. Rewrite it from the Share tab or
          ask an officer to.
        </Alert>
      ) : chipReminder && chipHandle && (
        <Alert tone="info" title="Your NFC card has your old address" className="mt-3">
          It was written with{" "}
          <span className="break-all font-mono font-medium">{displayCardUrl(chipHandle)}</span>.
          That keeps working after you change your handle: it forwards to your new one, so there's
          no need to rewrite the card.
        </Alert>
      )}
    </div>
  );
}

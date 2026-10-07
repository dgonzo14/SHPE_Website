import { useId, useRef, useState } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { parseHexInput } from "./themeEdit";

/**
 * One theme colour: the browser's own colour picker beside a hex box.
 *
 * The picker is the quick way; the hex box is for a member matching a brand
 * colour exactly, and the only way in on browsers whose picker is awkward.
 * Only a complete, valid colour ever reaches the form, so the theme in the
 * form is always one the database would accept. Half-typed text stays local
 * to the box, and is explained (not discarded) when the member moves on.
 */
export function ColorField({
  label,
  value,
  onChange,
  hint,
  onReset,
  overridden = false,
}: {
  label: string;
  /** Lowercase #rrggbb. */
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** Puts the colour back to the preset's. Offered only when `overridden`. */
  onReset?: () => void;
  overridden?: boolean;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // null while the box mirrors the form value; the member's text while typing.
  const [draft, setDraft] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  const invalid = showError && draft !== null && parseHexInput(draft) === null;
  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(" ") || undefined;

  const onType = (text: string) => {
    setDraft(text);
    // Only a full six-digit colour applies while typing. The three-digit
    // shorthand waits for blur, or "#0b5" on the way to "#0b5cad" would flash
    // the card #00bb55.
    const parsed = parseHexInput(text);
    if (parsed && /^#?[0-9a-f]{6}$/i.test(text.trim())) {
      setShowError(false);
      if (parsed !== value) onChange(parsed);
    }
  };

  /** On blur or Enter: apply what was typed (shorthand included) or explain why not. */
  const commit = () => {
    if (draft === null) return;
    const parsed = parseHexInput(draft);
    if (parsed) {
      if (parsed !== value) onChange(parsed);
      setDraft(null);
      setShowError(false);
    } else if (draft.trim() === "") {
      // Blank means "never mind": show the current colour again.
      setDraft(null);
      setShowError(false);
    } else {
      setShowError(true);
    }
  };

  return (
    <div ref={groupRef} role="group" aria-labelledby={labelId} className="min-w-0 space-y-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span id={labelId} className="text-sm font-medium text-shpe-navy">
          {label}
        </span>
        {overridden && onReset && (
          <button
            type="button"
            onClick={() => {
              // Reset disappears once the colour matches the preset again.
              // The hex box beside it stays, and shows the colour just put back.
              groupRef.current?.querySelector<HTMLInputElement>("[data-hex-input]")?.focus();
              setDraft(null);
              setShowError(false);
              onReset();
            }}
            aria-label={`Reset ${label.toLowerCase()} to the preset color`}
            className="-my-2 inline-flex min-h-11 items-center gap-1 px-1 text-xs font-medium text-shpe-navy underline underline-offset-4 hover:no-underline"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset
          </button>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => {
            setDraft(null);
            setShowError(false);
            onChange(e.target.value.toLowerCase());
          }}
          aria-label={`${label}, color picker`}
          aria-describedby={hint ? hintId : undefined}
          className={cn(
            "h-11 w-14 shrink-0 cursor-pointer border border-shpe-rule-strong bg-white p-1",
            "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:border-0",
          )}
        />
        <Input
          data-hex-input
          value={draft ?? value}
          onChange={(e) => onType(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // The Design tab sits inside the editor's <form>; Enter here means
            // "use this colour", not "save my card".
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          invalid={invalid}
          aria-label={`${label}, hex code`}
          aria-describedby={describedBy}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          maxLength={9}
          className="min-w-0 font-mono"
        />
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-gray-600">
          {hint}
        </p>
      )}
      {invalid && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Use a hex color like #1b365d</span>
        </p>
      )}
    </div>
  );
}

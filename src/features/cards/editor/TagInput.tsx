import { useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { AlertCircle, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface TagInputProps {
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  onBlur?: () => void;
  /** Most tags allowed. */
  maxItems: number;
  /** Longest single tag. */
  maxLength: number;
  /** Singular, lowercase: "skill". Used in messages and button names. */
  noun: string;
  placeholder?: string;
  /** A validation message from the form, shown under the field. */
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * A short list of words (skills, languages) typed one at a time.
 *
 * Enter, a comma, the Add button or leaving the field adds what's typed, so
 * the tag isn't lost when someone types it and goes straight to Save. Commas
 * are handled on input rather than keydown because Android keyboards don't
 * report the key, and that also splits a pasted "Python, SQL, CAD".
 *
 * Each tag has its own Remove button with the tag in its name. Backspace in an
 * empty field moves focus to the last tag's Remove button rather than deleting
 * it outright, so nothing disappears by surprise. Every change is announced.
 */
export function TagInput({
  label,
  hint,
  value,
  onChange,
  onBlur,
  maxItems,
  maxLength,
  noun,
  placeholder,
  error,
  inputRef,
}: TagInputProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;

  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const removeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const plural = `${noun}s`;
  const count = `${value.length} of ${maxItems} ${plural}`;

  /** Adds each candidate that passes; returns what's left un-added. */
  const commit = (candidates: string[]): string => {
    let next = [...value];
    let rejected = "";
    let message: string | null = null;
    const added: string[] = [];

    for (const raw of candidates) {
      const tag = raw.trim().replace(/\s+/g, " ");
      if (!tag) continue;
      if (next.length >= maxItems) {
        message = `That's the limit of ${maxItems} ${plural}. Remove one to add another.`;
        rejected = tag;
        break;
      }
      if (tag.length > maxLength) {
        message = `Keep each ${noun} to ${maxLength} characters or fewer.`;
        rejected = tag;
        break;
      }
      if (next.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
        message = `${tag} is already listed.`;
        continue;
      }
      next = [...next, tag];
      added.push(tag);
    }

    if (added.length > 0) {
      onChange(next);
      setAnnouncement(`Added ${added.join(", ")}. ${next.length} of ${maxItems} ${plural}.`);
    } else if (message) {
      setAnnouncement(message);
    }
    setProblem(message);
    return rejected;
  };

  const onDraftChange = (text: string) => {
    if (!text.includes(",")) {
      setDraft(text);
      if (problem) setProblem(null);
      return;
    }
    const parts = text.split(",");
    const trailing = parts.pop() ?? "";
    const rejected = commit(parts);
    setDraft(rejected ? `${rejected}${trailing ? `, ${trailing.trim()}` : ""}` : trailing.trimStart());
  };

  const addDraft = () => {
    if (!draft.trim()) return;
    setDraft(commit([draft]));
  };

  const removeAt = (index: number) => {
    const tag = value[index];
    const next = value.filter((_, i) => i !== index);
    onChange(next);
    setProblem(null);
    setAnnouncement(`Removed ${tag}. ${next.length} of ${maxItems} ${plural}.`);
    // Focus stays in the list: the tag that slid into this place, else the
    // one before it, else the text field.
    window.requestAnimationFrame(() => {
      const target = removeRefs.current[Math.min(index, next.length - 1)];
      if (target) target.focus();
      else document.getElementById(inputId)?.focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // Never submits the form: Enter here means "add this".
      event.preventDefault();
      addDraft();
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      event.preventDefault();
      removeRefs.current[value.length - 1]?.focus();
    }
  };

  const shownError = problem ?? error;
  const describedBy = [hintId, shownError ? problemId : null].filter(Boolean).join(" ");

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label}</Label>

      {value.length > 0 && (
        <ul aria-label={`Your ${plural}`} className="flex flex-wrap gap-2">
          {value.map((tag, index) => (
            <li
              key={`${tag}-${index}`}
              className="inline-flex min-h-[44px] max-w-full items-center gap-0.5 border border-shpe-rule-strong bg-shpe-navy-soft pl-3 text-sm font-medium text-shpe-navy"
            >
              <span className="min-w-0 break-words">{tag}</span>
              <button
                ref={(node) => {
                  removeRefs.current[index] = node;
                }}
                type="button"
                onClick={() => removeAt(index)}
                aria-label={`Remove ${tag}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-shpe-navy hover:bg-shpe-navy hover:text-white focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-shpe-navy"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          // Spread, not an attribute: the primitive doesn't declare `ref`,
          // though React 19 passes it through to the <input> all the same.
          {...{ ref: inputRef }}
          id={inputId}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            addDraft();
            onBlur?.();
          }}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="done"
          invalid={Boolean(shownError)}
          aria-describedby={describedBy || undefined}
          className="min-w-0 flex-1"
        />
        <Button
          variant="subtle"
          onClick={addDraft}
          disabled={!draft.trim()}
          aria-label={`Add ${noun}`}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </div>

      <p id={hintId} className="text-xs text-gray-500">
        {hint ? `${hint} ` : ""}
        <span className={cn(value.length >= maxItems && "font-semibold text-shpe-navy")}>{count}</span>
      </p>

      {shownError && (
        <p id={problemId} className="flex items-start gap-1.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{shownError}</span>
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

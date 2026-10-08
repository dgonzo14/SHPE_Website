import { useCallback, useId, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CardPresetId } from "../../model";
import { CARD_PRESETS, CARD_PRESET_COLLECTIONS } from "../../themes";
import { CardMiniature } from "./CardMiniature";

/**
 * The presets, in two collections: the professional set first, then the
 * seven originals. Each is a miniature of the card it draws (its own layout,
 * colours, name font and link treatment, with the member's name in it), a
 * name and a line on what it's for. Choosing one replaces the whole theme
 * with `{ preset }`, which drops every override; when the member has
 * customised anything, that is confirmed first, since there is no undo. The
 * live preview beside the form shows the result at once.
 *
 * Buttons with aria-pressed rather than a radio group: with radios, arrowing
 * through the list would apply each preset in turn, and with overrides each
 * step would open the confirmation.
 */
export function PresetGallery({
  current,
  hasOverrides,
  onChoose,
  sampleName,
}: {
  current: CardPresetId;
  hasOverrides: boolean;
  onChoose: (preset: CardPresetId) => void;
  /** The member's name, drawn into each miniature. */
  sampleName?: string;
}) {
  const idPrefix = useId();
  const [pending, setPending] = useState<CardPresetId | null>(null);

  // Stable: the dialog re-runs its focus effect whenever onClose changes
  // identity, which would pull focus back to its first button each time the
  // Design tab re-renders while it is open.
  const closeDialog = useCallback(() => setPending(null), []);
  const listRef = useRef<HTMLDivElement>(null);
  const confirmDialog = () => {
    if (pending) onChoose(pending);
    setPending(null);
    if (pending === current) {
      // Resetting removes the Reset button that opened the dialog, so the
      // dialog has nowhere to hand focus back to. The preset just restored is
      // the natural place; a frame later, once the dialog is gone.
      window.requestAnimationFrame(() =>
        listRef.current?.querySelector<HTMLElement>(`[data-preset="${current}"]`)?.focus(),
      );
    }
  };

  const choose = (id: CardPresetId) => {
    if (id === current && !hasOverrides) return;
    if (hasOverrides) setPending(id);
    else onChoose(id);
  };

  const pendingLabel = pending ? CARD_PRESETS[pending].label : "";
  const resetting = pending === current;

  return (
    <div className="space-y-6">
      <div ref={listRef} className="space-y-6">
        {CARD_PRESET_COLLECTIONS.map((collection) => {
          const headingId = `${idPrefix}-${collection.id}`;
          return (
            <div key={collection.id} role="group" aria-labelledby={headingId} className="space-y-3">
              <div>
                <h4 id={headingId} className="text-sm font-semibold text-shpe-navy">
                  {collection.label}
                </h4>
                <p className="mt-0.5 text-xs text-gray-600">{collection.description}</p>
              </div>
              <ul role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {collection.presets.map((id) => {
                  const preset = CARD_PRESETS[id];
                  const selected = id === current;
                  return (
                    <li key={id} className="min-w-0">
                      <button
                        type="button"
                        data-preset={id}
                        aria-pressed={selected}
                        aria-labelledby={`${idPrefix}-${id}-label`}
                        aria-describedby={`${idPrefix}-${id}`}
                        onClick={() => choose(id)}
                        className={cn(
                          "relative flex h-full w-full flex-col border-2 bg-white text-left transition-colors",
                          selected
                            ? "border-shpe-navy shadow-[0_0_0_2px_var(--color-shpe-navy-soft)]"
                            : "border-shpe-rule hover:border-shpe-rule-strong",
                        )}
                      >
                        <CardMiniature theme={preset.theme} name={sampleName} />
                        {selected && (
                          <span className="absolute top-2 right-2 inline-flex items-center gap-1 bg-shpe-navy px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white">
                            <Check className="size-3 shrink-0" aria-hidden="true" />
                            {hasOverrides ? "Customized" : "Selected"}
                          </span>
                        )}
                        <span
                          className={cn(
                            "flex flex-1 flex-col gap-0.5 border-t p-2.5",
                            selected ? "border-shpe-navy bg-shpe-navy-soft" : "border-shpe-rule",
                          )}
                        >
                          <span id={`${idPrefix}-${id}-label`} className="text-sm font-semibold text-shpe-navy">
                            {preset.label}
                          </span>
                          <span id={`${idPrefix}-${id}`} className="text-xs leading-snug text-gray-600">
                            {preset.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {hasOverrides && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-gray-600">
            You've changed some of {CARD_PRESETS[current].label}'s settings below.
          </p>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setPending(current)}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset to {CARD_PRESETS[current].label}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        onClose={closeDialog}
        onConfirm={confirmDialog}
        destructive={false}
        title={resetting ? `Reset to ${pendingLabel}?` : `Switch to ${pendingLabel}?`}
        confirmLabel={resetting ? "Reset design" : `Use ${pendingLabel}`}
        description={
          resetting
            ? `This undoes your layout, color, background, font and button changes and puts back ${pendingLabel}'s own settings.`
            : `This replaces your layout, color, background, font and button changes with ${pendingLabel}'s settings.`
        }
      >
        <p className="text-sm text-gray-700">
          Your content, links, photos and block order stay as they are. Your live card doesn't change
          until you save.
        </p>
      </ConfirmDialog>
    </div>
  );
}

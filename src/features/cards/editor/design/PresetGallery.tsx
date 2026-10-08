import { useCallback, useId, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CARD_PRESET_IDS, type CardPresetId } from "../../model";
import { CARD_PRESETS, themeCssVars, type CardPresetInfo } from "../../themes";
import { CARD_FONTS } from "../../fonts";

/** A thumbnail of the preset: its real page background, card colour and buttons. */
function PresetThumbnail({ preset }: { preset: CardPresetInfo }) {
  const { theme } = preset;
  const centered = theme.layout !== "split" && theme.layout !== "minimal";
  return (
    <span
      aria-hidden="true"
      style={themeCssVars(theme)}
      className="flex h-28 w-full items-center justify-center px-4"
    >
      <span
        className={cn(
          "flex w-full max-w-28 flex-col gap-1.5 bg-(--card-surface-fill) p-2.5",
          centered ? "items-center" : "items-start",
          theme.buttons.shape === "square" ? "rounded-none" : "rounded-lg",
        )}
      >
        {theme.layout !== "minimal" && (
          <span
            className={cn(
              "block size-5 bg-(--card-muted)",
              theme.avatar.shape === "circle" ? "rounded-full" : theme.avatar.shape === "rounded" ? "rounded-md" : "",
            )}
          />
        )}
        <span
          className="text-[0.7rem] leading-none text-(--card-text)"
          style={{ fontFamily: CARD_FONTS[theme.font.heading].stack, fontWeight: CARD_FONTS[theme.font.heading].headingWeight }}
        >
          Aa
        </span>
        <span className="block h-1 w-10 bg-(--card-muted) opacity-70" />
        <span
          className={cn(
            "mt-0.5 block h-2.5 w-full",
            theme.buttons.style === "filled"
              ? "bg-(--card-accent)"
              : "border border-(--card-accent) bg-(--card-soft)",
            theme.buttons.shape === "pill" ? "rounded-full" : theme.buttons.shape === "rounded" ? "rounded-sm" : "",
          )}
        />
      </span>
    </span>
  );
}

/**
 * The seven presets. Choosing one replaces the whole theme with `{ preset }`,
 * which drops every override; when the member has customised anything, that
 * is confirmed first, since there is no undo.
 *
 * Buttons with aria-pressed rather than a radio group: with radios, arrowing
 * through the list would apply each preset in turn, and with overrides each
 * step would open the confirmation.
 */
export function PresetGallery({
  current,
  hasOverrides,
  onChoose,
}: {
  current: CardPresetId;
  hasOverrides: boolean;
  onChoose: (preset: CardPresetId) => void;
}) {
  const idPrefix = useId();
  const [pending, setPending] = useState<CardPresetId | null>(null);

  // Stable: the dialog re-runs its focus effect whenever onClose changes
  // identity, which would pull focus back to its first button each time the
  // Design tab re-renders while it is open.
  const closeDialog = useCallback(() => setPending(null), []);
  const listRef = useRef<HTMLUListElement>(null);
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
    <div className="space-y-4">
      <ul ref={listRef} role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {CARD_PRESET_IDS.map((id) => {
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
                  "flex h-full w-full flex-col border-2 bg-white text-left transition-colors",
                  selected ? "border-shpe-navy" : "border-shpe-rule hover:border-shpe-rule-strong",
                )}
              >
                <PresetThumbnail preset={preset} />
                <span className="flex flex-1 flex-col gap-0.5 border-t border-shpe-rule p-2.5">
                  <span className="flex items-start justify-between gap-1 text-sm font-semibold text-shpe-navy">
                    <span id={`${idPrefix}-${id}-label`}>{preset.label}</span>
                    {selected && <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
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

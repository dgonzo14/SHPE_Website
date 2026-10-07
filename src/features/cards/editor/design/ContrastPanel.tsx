import { useId, type Ref } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CardColorKey } from "../../model";
import type { ContrastIssue } from "../../themes";
import { COLOR_LABELS, type ContrastFix } from "./themeEdit";

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 border border-black/20 align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * The readability check: every way the colours fall short of WCAG AA, each
 * with a one-click fix. The editor refuses to save while any are listed, so
 * this is where the member is sent, and it says exactly what to change.
 *
 * Focusable (tabIndex -1) so the "Review" buttons elsewhere on the tab can
 * move focus here, not just scroll.
 */
export function ContrastPanel({
  items,
  colors,
  onApply,
  onResetColors,
  presetLabel,
  ref,
}: {
  /** Each problem, with the colour change to offer for it (see contrastFix). */
  items: { issue: ContrastIssue; fix: ContrastFix | null }[];
  colors: Record<CardColorKey, string>;
  /** `index` is the problem's place in `items`, so focus can go to the next one. */
  onApply: (fix: ContrastFix, index: number) => void;
  /** Puts every colour back to the preset's; offered when no single change helps. */
  onResetColors?: (index: number) => void;
  presetLabel: string;
  ref?: Ref<HTMLDivElement>;
}) {
  const titleId = useId();
  if (items.length === 0) return null;
  const count = items.length;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      role="region"
      className="border-l-4 border-l-shpe-gold bg-shpe-gold-soft p-4 text-amber-950 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
    >
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="font-semibold">
            {count === 1 ? "One color is hard to read" : `${count} colors are hard to read`}
          </h3>
          <p className="mt-1 text-sm">
            You can save once everything here is fixed. Each suggestion is the nearest shade of your
            own color that passes.
          </p>
          <ul role="list" className="mt-3 space-y-3">
            {items.map(({ issue, fix }, index) => (
              <li key={issue.id} className="border-t border-amber-900/15 pt-3 text-sm">
                <p>{issue.message}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-amber-900">
                  <Swatch color={colors[issue.fg]} />
                  <span>{COLOR_LABELS[issue.fg]}</span>
                  <span>against</span>
                  <Swatch color={colors[issue.bg]} />
                  <span>{COLOR_LABELS[issue.bg].toLowerCase()}:</span>
                  <span className="font-semibold tabular-nums">
                    {issue.ratio.toFixed(2)}:1, needs {issue.required}:1
                  </span>
                </p>
                {fix ? (
                  <Button
                    variant="subtle"
                    size="sm"
                    className="mt-2 min-h-11"
                    onClick={() => onApply(fix, index)}
                    aria-label={`Use ${fix.color} for ${COLOR_LABELS[fix.key].toLowerCase()}`}
                  >
                    <Swatch color={fix.color} />
                    Use <span className="font-mono">{fix.color}</span>
                    <span className="font-normal text-gray-600">for {COLOR_LABELS[fix.key].toLowerCase()}</span>
                  </Button>
                ) : (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs">
                      No single color change fixes this one. Try a lighter or darker card color, a
                      different button style, or a preset above.
                    </p>
                    {onResetColors && (
                      <Button
                        variant="subtle"
                        size="sm"
                        className="min-h-11"
                        onClick={() => onResetColors(index)}
                      >
                        Use {presetLabel}'s colors
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

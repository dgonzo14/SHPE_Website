import { useId } from "react";

/**
 * A labelled slider with its value written out beside it. The track is 44px
 * tall so a thumb can find it, and aria-valuetext reads the value with its
 * unit ("135 degrees"), not a bare number.
 */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  display,
  valueText,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Shown beside the label, e.g. "135°". */
  display: string;
  /** Read by screen readers, e.g. "135 degrees". */
  valueText: string;
  hint?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-shpe-navy">
          {label}
        </label>
        <span className="text-sm tabular-nums text-gray-700" aria-hidden="true">
          {display}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        aria-valuetext={valueText}
        aria-describedby={hint ? hintId : undefined}
        className="block h-11 w-full cursor-pointer accent-shpe-navy"
      />
      {hint && (
        <p id={hintId} className="text-xs text-gray-600">
          {hint}
        </p>
      )}
    </div>
  );
}

import { useId, type ReactNode, type Ref } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Building blocks shared by the Design and Share tabs: a titled section for
 * each area, and a radio group drawn as picture tiles.
 */

/**
 * One area of a tab. Drawn like the Content tab's sections (a rule above, an
 * h3 title) because the tabs already sit inside the editor's card; nested
 * bordered cards would box the controls in twice.
 */
export function DesignSection({
  title,
  description,
  children,
  className,
  headingRef,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Makes the title a place focus can be sent (tabIndex -1), for a control
   * in this section that disappears once used and has no neighbour left.
   */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn("space-y-5 border-t border-shpe-rule pt-6 first:border-t-0 first:pt-0", className)}
    >
      <div className="min-w-0">
        <h3
          ref={headingRef}
          id={titleId}
          tabIndex={headingRef ? -1 : undefined}
          className="text-base font-semibold text-shpe-navy focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
        >
          {title}
        </h3>
        {description && <p className="mt-1 max-w-[65ch] text-sm text-gray-600">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export interface OptionItem<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** A small picture of the option. Decorative: the label says what it is. */
  preview?: ReactNode;
}

/**
 * A single choice, as a real radio group: arrow keys move between options and
 * a screen reader hears "Banner, radio button, 2 of 5" with the group's
 * legend. The native inputs are visually hidden inside each tile's label, so
 * the whole tile is the click target and the tile shows the focus ring.
 */
export function OptionGroup<T extends string>({
  legend,
  hint,
  value,
  options,
  onChange,
  hideLegend = false,
  columns = "grid-cols-2 sm:grid-cols-3",
}: {
  legend: string;
  hint?: ReactNode;
  value: T;
  options: readonly OptionItem<T>[];
  onChange: (value: T) => void;
  /** For a group that is the only control under a section title saying the same thing. */
  hideLegend?: boolean;
  /** Tailwind grid-cols classes. */
  columns?: string;
}) {
  const name = useId();
  const hintId = `${name}-hint`;

  return (
    <fieldset className="min-w-0" aria-describedby={hint ? hintId : undefined}>
      <legend className={hideLegend ? "sr-only" : "mb-2 text-sm font-medium text-shpe-navy"}>
        {legend}
      </legend>
      {hint && (
        <p id={hintId} className="mb-2 text-xs text-gray-600">
          {hint}
        </p>
      )}
      <div className={cn("grid gap-2", columns)}>
        {options.map((option) => {
          const checked = option.value === value;
          const labelId = `${name}-${option.value}-label`;
          const descriptionId = option.description ? `${name}-${option.value}-desc` : undefined;
          return (
            <label
              key={option.value}
              className={cn(
                "relative flex min-h-11 min-w-0 cursor-pointer flex-col gap-1.5 border-2 p-2.5 text-left text-sm",
                "has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-shpe-navy",
                checked
                  ? "border-shpe-navy bg-shpe-navy-soft"
                  : "border-shpe-rule bg-white hover:border-shpe-rule-strong",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                className="sr-only"
              />
              {option.preview && (
                <span aria-hidden="true" className="flex items-center justify-center">
                  {option.preview}
                </span>
              )}
              <span className="flex items-start justify-between gap-1">
                <span id={labelId} className="font-medium text-shpe-navy">
                  {option.label}
                </span>
                {checked && <Check className="mt-0.5 size-4 shrink-0 text-shpe-navy" aria-hidden="true" />}
              </span>
              {option.description && (
                <span id={descriptionId} className="text-xs leading-snug text-gray-600">
                  {option.description}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

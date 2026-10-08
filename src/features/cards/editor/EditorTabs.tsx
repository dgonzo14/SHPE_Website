import { useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";
import { EDITOR_TABS, editorPanelId, editorTabId, type EditorTabId } from "./editorUtils";

/**
 * The editor's tab row, following the ARIA tabs pattern: one tab stop for the
 * whole row (the selected tab), Left/Right to move between tabs with wrap-
 * around, Home/End for the ends. Selection follows focus, since every panel
 * renders instantly from data already loaded.
 *
 * The row scrolls sideways rather than wrapping on a 320px phone, so the tabs
 * stay one line and each keeps a 44px target. A tab holding something that
 * blocks saving gets a dot, with the same fact in words for screen readers.
 */
export function EditorTabs({
  idPrefix,
  selected,
  onSelect,
  attention,
}: {
  idPrefix: string;
  selected: EditorTabId;
  onSelect: (id: EditorTabId) => void;
  attention: ReadonlySet<EditorTabId>;
}) {
  const refs = useRef(new Map<EditorTabId, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = EDITOR_TABS.findIndex((tab) => tab.id === selected);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % EDITOR_TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + EDITOR_TABS.length) % EDITOR_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = EDITOR_TABS.length - 1;
    if (next === null) return;

    event.preventDefault();
    const id = EDITOR_TABS[next].id;
    onSelect(id);
    refs.current.get(id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Card editor sections"
      onKeyDown={onKeyDown}
      className="flex overflow-x-auto border-b border-shpe-rule"
    >
      {EDITOR_TABS.map((tab) => {
        const isSelected = tab.id === selected;
        const flagged = attention.has(tab.id);
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={editorTabId(idPrefix, tab.id)}
            aria-selected={isSelected}
            aria-controls={editorPanelId(idPrefix, tab.id)}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "relative inline-flex min-h-[44px] shrink-0 items-center gap-1.5 border-b-[3px] px-4 text-sm font-semibold transition-colors",
              "focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-shpe-navy",
              isSelected
                ? "border-shpe-orange-dark text-shpe-navy"
                : "border-transparent text-gray-600 hover:border-shpe-rule-strong hover:text-shpe-navy",
            )}
          >
            {tab.label}
            {flagged && (
              <>
                <span className="h-2 w-2 rounded-full bg-red-700" aria-hidden="true" />
                <span className="sr-only">, needs attention</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

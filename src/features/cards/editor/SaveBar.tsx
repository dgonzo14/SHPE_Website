import { AlertCircle, Eye, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/errors";
import { EDITOR_TABS, type EditorTabId } from "./editorUtils";

export type SaveProblem =
  | { kind: "contrast" }
  | { kind: "invalid"; tabs: EditorTabId[] }
  | { kind: "error"; error: unknown };

function statusLine({
  isNew,
  isDirty,
  saving,
  live,
}: {
  isNew: boolean;
  isDirty: boolean;
  saving: boolean;
  live: boolean;
}): string {
  if (saving) return "Saving…";
  if (isNew) return "Not saved yet. It stays private until you publish it.";
  if (isDirty) return live ? "Unsaved changes. Saving updates your live card." : "Unsaved changes.";
  return "All changes saved.";
}

/**
 * Save, Discard and (on small screens) Preview, pinned to the bottom of the
 * editor so they're in reach from anywhere in a long tab.
 *
 * Whatever stops a save is said here, next to the button that was pressed:
 * unreadable colors (fixed on Design), invalid fields (each tab named, one tap
 * away), or the database's own message, which for card rules is written for
 * members.
 */
export function SaveBar({
  isNew,
  isDirty,
  saving,
  live,
  problem,
  onSave,
  onDiscard,
  onPreview,
  onGoToTab,
}: {
  isNew: boolean;
  isDirty: boolean;
  saving: boolean;
  /** The card is published and visible, so a save changes what people see. */
  live: boolean;
  problem: SaveProblem | null;
  onSave: () => void;
  onDiscard: () => void;
  onPreview: () => void;
  onGoToTab: (tab: EditorTabId) => void;
}) {
  return (
    <div className="sticky bottom-0 z-20 space-y-3 border-t border-shpe-rule bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:px-6">
      {problem && (
        <div
          role="alert"
          className="flex flex-col gap-2 border-l-4 border-l-red-700 bg-red-50 p-3 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {problem.kind === "contrast" &&
                "Some of your colors are too hard to read, so your card can't be saved yet. The Design tab shows each one with a suggested fix."}
              {problem.kind === "invalid" && "Some fields need fixing before your card can be saved."}
              {problem.kind === "error" && `We couldn't save your card. ${errorText(problem.error)}`}
            </span>
          </p>
          {problem.kind === "contrast" && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] shrink-0"
              onClick={() => onGoToTab("design")}
            >
              Fix colors on Design
            </Button>
          )}
          {problem.kind === "invalid" && problem.tabs.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {EDITOR_TABS.filter((tab) => problem.tabs.includes(tab.id)).map((tab) => (
                <Button
                  key={tab.id}
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => onGoToTab(tab.id)}
                >
                  Go to {tab.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-gray-600" aria-live="polite">
          {statusLine({ isNew, isDirty, saving, live })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="lg:hidden" onClick={onPreview}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            Preview
          </Button>
          {isDirty && (
            <Button variant="subtle" onClick={onDiscard} disabled={saving}>
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Discard
            </Button>
          )}
          <Button onClick={onSave} loading={saving} disabled={!isNew && !isDirty}>
            {isNew ? "Save my card" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

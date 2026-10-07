import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CARD_SECTION_LABELS, type CardSectionId } from "../../model";
import { hiddenSections, hideSection, moveSection, showSection, shownSections } from "./themeEdit";

const SECTION_DESCRIPTIONS: Record<CardSectionId, string> = {
  status: "Your status line, like “Seeking Summer 2027 internships”.",
  featured: "The link you star on the Links tab, as one big button.",
  links: "Your links and contact details.",
  about: "Your bio.",
  education: "Your major and class year, from your profile.",
  // Not the chapter position: that sits under the name in the header whatever
  // this block does, and only the Content tab's toggle turns it off. Saying
  // otherwise sends an officer who wants it gone to the wrong control.
  shpe: "Your member-since date and verified National badge. Your chapter position shows under your name instead; turn it off with “Show my chapter position” on the Content tab.",
  skills: "Your skills, as tags.",
  languages: "The languages you speak.",
};

/**
 * Block order: which content blocks the card shows, and in what order.
 *
 * Up/down buttons rather than drag and drop: they work the same with a
 * keyboard, a screen reader and a thumb, and need no new dependency. After
 * every move, hide or show, focus is put back on a sensible control (the
 * moved block's button, or the block's new place in the other list) and the
 * result is announced, because the list re-renders under the member's finger.
 */
export function BlockOrder({
  sections,
  onChange,
  emptyNotes = {},
}: {
  sections: readonly unknown[] | null | undefined;
  onChange: (next: CardSectionId[]) => void;
  /** Per block: why it would show nothing right now, e.g. "No skills added yet." */
  emptyNotes?: Partial<Record<CardSectionId, string>>;
}) {
  const shown = shownSections(sections);
  const hidden = hiddenSections(sections);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const sectionsKey = shown.join(",");
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    containerRef.current?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus();
  }, [sectionsKey]);

  const move = (id: CardSectionId, delta: -1 | 1) => {
    const next = moveSection(shown, id, delta);
    const position = next.indexOf(id);
    // Keep focus on the button just pressed, unless the block has reached the
    // end it was moving towards and that button is now disabled.
    const atEnd = delta < 0 ? position === 0 : position === next.length - 1;
    pendingFocus.current = `${id}:${(delta < 0) !== atEnd ? "up" : "down"}`;
    if (next.length === 1) pendingFocus.current = `${id}:hide`;
    setAnnouncement(`${CARD_SECTION_LABELS[id]} moved to position ${position + 1} of ${next.length}.`);
    onChange(next);
  };

  const hide = (id: CardSectionId) => {
    pendingFocus.current = `${id}:show`;
    setAnnouncement(`${CARD_SECTION_LABELS[id]} hidden.`);
    onChange(hideSection(shown, id));
  };

  const show = (id: CardSectionId) => {
    const next = showSection(shown, id);
    pendingFocus.current = next.length > 1 ? `${id}:up` : `${id}:hide`;
    setAnnouncement(`${CARD_SECTION_LABELS[id]} shown, at the end of your card.`);
    onChange(next);
  };

  return (
    <div ref={containerRef} className="space-y-5">
      <p className="text-sm text-gray-600">
        Always on your card, whatever you choose here: your name and photo at the top, the Add to
        Contacts and Share buttons, and the small “Member of WashU SHPE” footer at the bottom.
      </p>

      <div>
        <h4 className="text-sm font-semibold text-shpe-navy">Shown, top to bottom</h4>
        {shown.length === 0 ? (
          <p className="mt-2 border border-dashed border-shpe-rule-strong p-3 text-sm text-gray-600">
            Every block is hidden, so your card shows just your name, Add to Contacts and the footer.
          </p>
        ) : (
          <ol role="list" className="mt-2 space-y-2">
            {shown.map((id, index) => {
              const label = CARD_SECTION_LABELS[id];
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-shpe-rule bg-white p-2 pl-3"
                >
                  <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-gray-500" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm font-medium text-shpe-navy">{label}</p>
                    <p className="text-xs text-gray-600">{SECTION_DESCRIPTIONS[id]}</p>
                    {emptyNotes[id] && <p className="mt-0.5 text-xs italic text-gray-600">{emptyNotes[id]}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="subtle"
                      size="icon"
                      onClick={() => move(id, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${label} up`}
                      data-focus-key={`${id}:up`}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="subtle"
                      size="icon"
                      onClick={() => move(id, 1)}
                      disabled={index === shown.length - 1}
                      aria-label={`Move ${label} down`}
                      data-focus-key={`${id}:down`}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="subtle"
                      size="sm"
                      className="min-h-11"
                      onClick={() => hide(id)}
                      aria-label={`Hide ${label}`}
                      data-focus-key={`${id}:hide`}
                    >
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                      Hide
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {hidden.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-shpe-navy">Hidden</h4>
          <ul role="list" className="mt-2 space-y-2">
            {hidden.map((id) => {
              const label = CARD_SECTION_LABELS[id];
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-dashed border-shpe-rule-strong p-2 pl-3"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm font-medium text-shpe-navy">{label}</p>
                    <p className="text-xs text-gray-600">{SECTION_DESCRIPTIONS[id]}</p>
                  </div>
                  <Button
                    variant="subtle"
                    size="sm"
                    className="min-h-11"
                    onClick={() => show(id)}
                    aria-label={`Show ${label}`}
                    data-focus-key={`${id}:show`}
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    Show
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

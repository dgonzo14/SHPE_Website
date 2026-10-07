import type { PublicCardLink } from "@/types/database";

/**
 * "public": the real card at /card/:handle. Links navigate (external ones in a
 * new tab) and every handler fires.
 * "preview": the editor's live preview. Links still render with their real
 * href, so hovering shows where they go, but nothing navigates; the handlers
 * fire so the editor can say what would have happened.
 */
export type CardMode = "public" | "preview";

export type LinkClickHandler = (link: PublicCardLink) => void;

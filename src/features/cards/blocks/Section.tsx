import type { ReactNode } from "react";

import type { CardSectionId } from "../model";
import { cn } from "@/lib/utils";
import { SECTION_TITLE } from "./styles";

/**
 * One content block under a small-caps title. A plain <section> with an <h2>
 * rather than a labelled region: a card with six landmarks would make the
 * landmark list noisier than the card itself, while headings still let a
 * screen-reader user jump from block to block.
 */
export function Section({
  id,
  title,
  hideTitle = false,
  className,
  children,
}: {
  id: CardSectionId;
  title: string;
  /** Keep the heading for assistive technology but don't draw it. */
  hideTitle?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-section={id} className={cn("flex flex-col gap-2", className)}>
      <h2 className={hideTitle ? "sr-only" : SECTION_TITLE}>{title}</h2>
      {children}
    </section>
  );
}

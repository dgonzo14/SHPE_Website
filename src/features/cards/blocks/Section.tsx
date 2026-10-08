import type { ReactNode } from "react";

import type { CardSectionId } from "../model";
import { useLayoutSpec } from "../layouts";
import { cn } from "@/lib/utils";
import { SECTION_STYLES } from "./styles";

/**
 * One content block under a small title, styled by the layout: small caps in
 * the original layouts, a ruled caption in Editorial, a raised panel in
 * Layered, and so on (SECTION_STYLES). A plain <section> with an <h2> rather
 * than a labelled region: a card with six landmarks would make the landmark
 * list noisier than the card itself, while headings still let a screen-reader
 * user jump from block to block.
 */
export function Section({
  id,
  title,
  hideTitle = false,
  arrangement,
  className,
  children,
}: {
  id: CardSectionId;
  title: string;
  /** Keep the heading for assistive technology but don't draw it. */
  hideTitle?: boolean;
  /** For the links block: how the links are laid out, as data-arrangement. */
  arrangement?: string;
  className?: string;
  children: ReactNode;
}) {
  const style = SECTION_STYLES[useLayoutSpec().sectionStyle];
  return (
    <section data-section={id} data-arrangement={arrangement} className={cn(style.section, className)}>
      <h2 className={hideTitle ? "sr-only" : style.title}>{title}</h2>
      {children}
    </section>
  );
}

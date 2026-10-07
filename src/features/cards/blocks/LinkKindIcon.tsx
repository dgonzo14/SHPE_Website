import { createElement } from "react";

import type { CardLinkKind } from "../model";
import { linkIcon } from "../linkKinds";

/**
 * The icon for a link kind (a plain link icon for anything unrecognised).
 * Decorative: the label next to it always says what the link is.
 */
export function LinkKindIcon({ kind, className }: { kind: CardLinkKind; className?: string }) {
  return createElement(linkIcon(kind), { className });
}

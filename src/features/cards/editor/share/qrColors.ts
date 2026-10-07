import { contrastRatio, type ResolvedTheme } from "../../themes";

export interface QrColors {
  fg: string;
  bg: string;
}

export const PLAIN_QR_COLORS: QrColors = { fg: "#000000", bg: "#ffffff" };

/**
 * QR codes need far more contrast than text does: phone cameras read them at
 * an angle, under bad light, often off a screen. 7:1 is WCAG's AAA level for
 * text and leaves room for all of that.
 */
export const MIN_QR_CONTRAST = 7;

/** Contrast against white rises as a colour darkens, so it orders colours by darkness. */
function darkness(color: string): number {
  return contrastRatio(color, "#ffffff");
}

/**
 * The card's own colours for its QR code, or plain black on white when the
 * theme has no pair that scans reliably.
 *
 * Always dark modules on a light ground: inverted codes scan on some phones and
 * not others. The light colour is whichever of the card and text colours is
 * lighter (the card on most themes, the text on dark ones like Midnight); the
 * modules take the accent if it is dark enough, which looks the most like the
 * card, then the other of card/text, then the page background.
 */
export function themedQrColors(theme: ResolvedTheme): QrColors {
  const { surface, text, accent, background } = theme.colors;
  const surfaceIsLighter = darkness(surface) <= darkness(text);
  const light = surfaceIsLighter ? surface : text;
  const candidates = [accent, surfaceIsLighter ? text : surface, background];
  for (const fg of candidates) {
    if (darkness(fg) > darkness(light) && contrastRatio(fg, light) >= MIN_QR_CONTRAST) {
      return { fg, bg: light };
    }
  }
  return PLAIN_QR_COLORS;
}

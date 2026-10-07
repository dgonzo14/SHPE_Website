import { describe, expect, it } from "vitest";

import { CARD_PRESET_IDS } from "../../../model";
import { CARD_PRESETS, contrastRatio, resolveTheme } from "../../../themes";
import { MIN_QR_CONTRAST, PLAIN_QR_COLORS, themedQrColors } from "../qrColors";

const darker = (a: string, b: string) => contrastRatio(a, "#ffffff") > contrastRatio(b, "#ffffff");

describe("themedQrColors", () => {
  it.each(CARD_PRESET_IDS)("gives %s dark modules on a light ground with room to spare", (id) => {
    const { fg, bg } = themedQrColors(CARD_PRESETS[id].theme);
    expect(darker(fg, bg)).toBe(true);
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_QR_CONTRAST);
  });

  it("uses the card's own colours on a light theme", () => {
    expect(themedQrColors(CARD_PRESETS["shpe-classic"].theme)).toEqual({ fg: "#1b365d", bg: "#ffffff" });
  });

  it("prefers the accent when it is dark enough", () => {
    expect(themedQrColors(CARD_PRESETS.glass.theme)).toEqual({ fg: "#3730a3", bg: "#ffffff" });
  });

  it("never inverts a dark theme: the light text becomes the ground", () => {
    const midnight = CARD_PRESETS.midnight.theme;
    expect(themedQrColors(midnight)).toEqual({ fg: midnight.colors.surface, bg: midnight.colors.text });
  });

  it("falls back to black and white when no theme pair scans reliably", () => {
    const washedOut = resolveTheme({
      preset: "paper",
      colors: { background: "#cccccc", surface: "#bbbbbb", text: "#777777", accent: "#888888" },
    });
    expect(themedQrColors(washedOut)).toEqual(PLAIN_QR_COLORS);
  });
});

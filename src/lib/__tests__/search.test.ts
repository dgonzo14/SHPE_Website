import { describe, expect, it } from "vitest";

import { foldForSearch } from "../search";

describe("foldForSearch", () => {
  it.each([
    ["Muñoz", "munoz"],
    ["García", "garcia"],
    ["JOSÉ", "jose"],
    ["Peña Núñez", "pena nunez"],
    ["Ünal Çelik", "unal celik"],
    ["Conceição", "conceicao"],
  ])("folds %j to %j", (text, folded) => {
    expect(foldForSearch(text)).toBe(folded);
  });

  it("folds a letter typed as a base letter plus a combining accent the same way", () => {
    // "n" + U+0303 COMBINING TILDE, as some keyboards produce it.
    expect(foldForSearch("Mun\u0303oz")).toBe(foldForSearch("Muñoz"));
  });

  it("leaves punctuation, digits and email addresses alone", () => {
    expect(foldForSearch("ana.rivera+shpe@wustl.edu")).toBe("ana.rivera+shpe@wustl.edu");
    expect(foldForSearch("O'Brien-Smith 2027")).toBe("o'brien-smith 2027");
  });
});

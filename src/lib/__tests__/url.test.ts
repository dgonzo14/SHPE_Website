import { describe, expect, it } from "vitest";
import { safeExternalHref } from "../url";

describe("safeExternalHref", () => {
  it("allows the protocols the app actually links with", () => {
    expect(safeExternalHref("https://linkedin.com/in/diego")).toBe("https://linkedin.com/in/diego");
    expect(safeExternalHref("http://example.org")).toBe("http://example.org");
    expect(safeExternalHref("mailto:shpe@wustl.edu")).toBe("mailto:shpe@wustl.edu");
  });

  it("drops script-executing protocols", () => {
    expect(safeExternalHref("javascript:alert(document.domain)")).toBeUndefined();
    expect(safeExternalHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalHref("vbscript:msgbox(1)")).toBeUndefined();
  });

  /*
   * These are the cases a startsWith("javascript:") check would let through.
   * The URL parser normalises them all before the protocol is read, which is
   * the reason this function parses instead of string-matching.
   */
  it("is not fooled by casing or leading whitespace", () => {
    expect(safeExternalHref("JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeExternalHref("  javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("\njavascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("\tjavascript:alert(1)")).toBeUndefined();
  });

  it("treats empty and unparseable values as no link", () => {
    expect(safeExternalHref(null)).toBeUndefined();
    expect(safeExternalHref(undefined)).toBeUndefined();
    expect(safeExternalHref("")).toBeUndefined();
    expect(safeExternalHref("   ")).toBeUndefined();
    expect(safeExternalHref("/portal/points")).toBeUndefined();
    expect(safeExternalHref("not a url")).toBeUndefined();
  });
});

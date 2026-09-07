import { describe, expect, it } from "vitest";
import { resolveSiteLink } from "@/lib/url";

const BACKSLASH = String.fromCharCode(92);

describe("resolveResourceLink", () => {
  it("treats an absolute http(s) URL as external", () => {
    const link = resolveSiteLink(("https://shpe.org/convention"));
    expect(link).toEqual({ href: "https://shpe.org/convention", external: true });
  });

  it("resolves a site-relative path against the deployment base, not external", () => {
    const link = resolveSiteLink(("/SHPE_Constitution.docx"));
    expect(link?.external).toBe(false);
    expect(link?.href).toContain("SHPE_Constitution.docx");
  });

  /*
   * The regression this file exists for. `//host` is protocol-relative: the old
   * code failed /^https?:\/\// so labelled it internal, rendered it with no
   * target="_blank" and no external affordance, and the browser left the site
   * anyway. An officer could publish that and silently redirect every member.
   */
  it("does not let a protocol-relative or backslash target escape the site", () => {
    for (const evil of [
      "//elsewhere.example/login",
      "///elsewhere.example/login",
      `${BACKSLASH}${BACKSLASH}elsewhere.example/login`,
      `/${BACKSLASH}elsewhere.example/login`,
    ]) {
      const link = resolveSiteLink((evil));
      expect(link, `expected ${evil} to resolve`).not.toBeNull();
      expect(new URL(link!.href).origin, `expected ${evil} to stay on-site`).toBe(
        window.location.origin,
      );
      expect(link!.external, `expected ${evil} to be internal`).toBe(false);
    }
  });

  it("refuses to render a link for a script-executing protocol", () => {
    expect(resolveSiteLink(("javascript:alert(1)"))).toBeNull();
    expect(resolveSiteLink(("data:text/html,<script>alert(1)</script>"))).toBeNull();
  });

  it("returns null when there is no target at all", () => {
    expect(resolveSiteLink(null)).toBeNull();
    expect(resolveSiteLink(("   "))).toBeNull();
  });
});

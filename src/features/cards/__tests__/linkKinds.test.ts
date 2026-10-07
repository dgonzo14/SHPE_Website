import { describe, expect, it } from "vitest";

import { LINK_KINDS, isExternalHref, linkDisplayLabel, linkHref, linkIcon } from "../linkKinds";
import { CARD_LINK_KINDS, isLinkValueValid, type CardLinkKind } from "../model";

const normalize = (kind: CardLinkKind, raw: string) => LINK_KINDS[kind].normalize(raw);

describe("LINK_KINDS catalog", () => {
  it("describes all sixteen kinds", () => {
    expect(Object.keys(LINK_KINDS).sort()).toEqual([...CARD_LINK_KINDS].sort());
    for (const kind of CARD_LINK_KINDS) {
      const info = LINK_KINDS[kind];
      expect(info.label, kind).not.toBe("");
      expect(info.placeholder, kind).not.toBe("");
      expect(info.hint, kind).not.toBe("");
      expect(typeof info.icon, kind).toMatch(/function|object/);
      expect(["url", "email", "tel", "text"]).toContain(info.inputMode);
    }
  });

  it("uses the right keyboard for email and phone", () => {
    expect(LINK_KINDS.email.inputMode).toBe("email");
    expect(LINK_KINDS.phone.inputMode).toBe("tel");
    expect(LINK_KINDS.linkedin.inputMode).toBe("url");
  });

  it("tells members that email and phone are public", () => {
    expect(LINK_KINDS.email.hint).toMatch(/public/i);
    expect(LINK_KINDS.phone.hint).toMatch(/public/i);
  });
});

describe("normalize", () => {
  it.each<[CardLinkKind, string, string]>([
    // Usernames and @handles become profile links
    ["linkedin", "diego-gonzalezz", "https://www.linkedin.com/in/diego-gonzalezz"],
    ["linkedin", "@diego", "https://www.linkedin.com/in/diego"],
    ["linkedin", "in/diego", "https://www.linkedin.com/in/diego"],
    ["github", "@diego", "https://github.com/diego"],
    ["github", "diego-g", "https://github.com/diego-g"],
    ["instagram", "@diego.gonzalez", "https://www.instagram.com/diego.gonzalez"],
    ["x", "@diego_g", "https://x.com/diego_g"],
    ["tiktok", "@diego", "https://www.tiktok.com/@diego"],
    ["tiktok", "diego", "https://www.tiktok.com/@diego"],
    ["youtube", "@shpewashu", "https://www.youtube.com/@shpewashu"],
    ["devpost", "diego", "https://devpost.com/diego"],
    ["calendly", "diego-gonzalez", "https://calendly.com/diego-gonzalez"],
    // Links on the site's own domain are completed, not re-prefixed
    ["linkedin", "linkedin.com/in/diego", "https://linkedin.com/in/diego"],
    ["linkedin", "www.linkedin.com/in/diego/", "https://www.linkedin.com/in/diego/"],
    ["github", "github.com/diego", "https://github.com/diego"],
    ["x", "twitter.com/diego", "https://twitter.com/diego"],
    ["youtube", "youtu.be/abc123", "https://youtu.be/abc123"],
    // Bare domains and http become https
    ["website", "example.com", "https://example.com"],
    ["website", "  example.com/about?x=1#top  ", "https://example.com/about?x=1#top"],
    ["website", "http://example.com", "https://example.com"],
    ["website", "HTTP://Example.com/Path", "https://Example.com/Path"],
    ["website", "//example.com", "https://example.com"],
    ["website", "sub.example.co.uk:8443/x", "https://sub.example.co.uk:8443/x"],
    ["portfolio", "behance.net/diego", "https://behance.net/diego"],
    ["resume", "https://drive.google.com/file/d/abc/view", "https://drive.google.com/file/d/abc/view"],
    ["github", "http://github.com/diego", "https://github.com/diego"],
    ["discord", "discord.gg/abc123", "https://discord.gg/abc123"],
    ["custom", "shpe.org", "https://shpe.org"],
    // Email: trimmed and lowercased
    ["email", "  Diego.Gonzalez@WUSTL.edu ", "diego.gonzalez@wustl.edu"],
    ["email", "mailto:diego@wustl.edu", "diego@wustl.edu"],
    // Phone: digits and + ( ) . - only
    ["phone", " +1 (314) 555-0123 ", "+1 (314) 555-0123"],
    ["phone", "314.555.0123", "314.555.0123"],
    ["phone", "tel:+13145550123", "+13145550123"],
    ["phone", "314 555 0123 ext. 12", "314 555 0123"],
    ["phone", "Cell: 314   555 0123", "314 555 0123"],
  ])("%s: %j → %j", (kind, raw, expected) => {
    const result = normalize(kind, raw);
    expect(result).toBe(expected);
    expect(isLinkValueValid(kind, result)).toBe(true);
  });

  it("returns an empty string for blank input", () => {
    for (const kind of CARD_LINK_KINDS) expect(normalize(kind, "   ")).toBe("");
  });

  it("is idempotent", () => {
    const samples: [CardLinkKind, string][] = [
      ["linkedin", "diego"],
      ["github", "@diego"],
      ["tiktok", "@diego"],
      ["website", "example.com"],
      ["email", "A@B.CO"],
      ["phone", "+1 314 555 0123"],
    ];
    for (const [kind, raw] of samples) {
      const once = normalize(kind, raw);
      expect(normalize(kind, once)).toBe(once);
    }
  });

  it.each<[CardLinkKind, string]>([
    ["website", "javascript:alert(1)"],
    ["website", "JaVaScRiPt:alert(document.cookie)"],
    ["custom", "data:text/html,<script>alert(1)</script>"],
    ["github", "javascript:alert(1)"],
    ["linkedin", "javascript://linkedin.com/%0Aalert(1)"],
    ["instagram", "data:image/svg+xml;base64,PHN2Zz4="],
    ["website", "vbscript:msgbox(1)"],
    ["website", "ftp://example.com/file"],
    ["website", "mailto:diego@wustl.edu"],
    ["website", "not a link"],
    ["website", "hello"],
    ["website", "192.168.0.1"],
    ["website", "me@example.com"],
    ["github", "not/a/user name"],
    ["github", "-diego"],
    ["x", "this_handle_is_too_long_for_x"],
    ["discord", "diego#1234"],
    ["handshake", "diego"],
    ["email", "diego"],
    ["email", "diego@wustl"],
    ["phone", "555-01"],
    ["phone", "1-800-FLOWERS"],
  ])("doesn't invent a valid link from %s: %j", (kind, raw) => {
    expect(isLinkValueValid(kind, normalize(kind, raw))).toBe(false);
  });

  it("never rewrites a dangerous scheme into https", () => {
    for (const kind of CARD_LINK_KINDS) {
      for (const raw of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"]) {
        expect(normalize(kind, raw).toLowerCase()).not.toMatch(/^https:/);
      }
    }
  });
});

describe("linkHref", () => {
  it("builds mailto: for a plain address", () => {
    expect(linkHref("email", "diego@wustl.edu")).toBe("mailto:diego@wustl.edu");
    expect(linkHref("email", "o'brien@wustl.edu")).toBe("mailto:o'brien@wustl.edu");
  });

  it("refuses addresses that would add recipients, headers or a body", () => {
    expect(linkHref("email", "diego@wustl.edu?cc=boss@x.com")).toBeUndefined();
    expect(linkHref("email", "diego@wustl.edu?body=hi")).toBeUndefined();
    expect(linkHref("email", "diego%0Abcc:x@y.com@wustl.edu")).toBeUndefined();
    expect(linkHref("email", "diego@wustl.edu&subject=x")).toBeUndefined();
    expect(linkHref("email", "not-an-email")).toBeUndefined();
  });

  it("builds tel: from the digits and a leading + only", () => {
    expect(linkHref("phone", "+1 (314) 555-0123")).toBe("tel:+13145550123");
    expect(linkHref("phone", "314.555.0123")).toBe("tel:3145550123");
    expect(linkHref("phone", "555-01")).toBeUndefined();
    expect(linkHref("phone", "javascript:alert(1)")).toBeUndefined();
  });

  it("passes https links through", () => {
    expect(linkHref("linkedin", "https://www.linkedin.com/in/diego")).toBe(
      "https://www.linkedin.com/in/diego",
    );
    expect(linkHref("custom", "  https://shpe.org/  ")).toBe("https://shpe.org/");
  });

  it.each([
    "javascript:alert(1)",
    " javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "http://example.com",
    "mailto:diego@wustl.edu",
    "//evil.example/login",
    "/relative/path",
    'https://example.com/"onmouseover="alert(1)',
    "https://exa mple.com",
    "",
  ])("rejects %j for a web link", (value) => {
    expect(linkHref("website", value)).toBeUndefined();
    expect(linkHref("github", value)).toBeUndefined();
  });

  it("never yields anything but https:, mailto: or tel:", () => {
    const values = ["https://ok.example", "diego@wustl.edu", "+1 314 555 0123", "javascript:x", "data:x"];
    for (const kind of CARD_LINK_KINDS) {
      for (const value of values) {
        const href = linkHref(kind, value);
        if (href !== undefined) expect(href).toMatch(/^(https:\/\/|mailto:|tel:)/);
      }
    }
  });
});

describe("labels and icons", () => {
  it("prefers the member's own label and falls back to the kind's", () => {
    expect(linkDisplayLabel({ kind: "calendly", label: "Book a coffee chat" })).toBe("Book a coffee chat");
    expect(linkDisplayLabel({ kind: "calendly", label: null })).toBe("Calendly");
    expect(linkDisplayLabel({ kind: "linkedin", label: "   " })).toBe("LinkedIn");
    expect(linkDisplayLabel({ kind: "resume", label: null })).toBe("Résumé");
  });

  it("copes with a kind it doesn't know", () => {
    const unknown = "myspace" as CardLinkKind;
    expect(linkDisplayLabel({ kind: unknown, label: null })).toBe("Link");
    expect(linkIcon(unknown)).toBe(LINK_KINDS.custom.icon);
    expect(linkHref(unknown, "https://ok.example")).toBe("https://ok.example");
    expect(linkHref(unknown, "javascript:alert(1)")).toBeUndefined();
  });

  it("knows which hrefs leave the site", () => {
    expect(isExternalHref("https://x.example")).toBe(true);
    expect(isExternalHref("mailto:a@b.co")).toBe(false);
    expect(isExternalHref("tel:+13145550123")).toBe(false);
  });
});

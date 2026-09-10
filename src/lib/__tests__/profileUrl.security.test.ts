import { describe, expect, it } from "vitest";

import { registerSchema } from "@/lib/validation";

/**
 * optionalProfileUrl adds "https://" to a value that has no scheme, so that a
 * member can type `linkedin.com/in/you`. That convenience is one bad edge case
 * away from being a script-injection sink, and the edge cases are not obvious:
 * the WHATWG URL parser strips tabs, newlines and some control characters
 * before parsing, so a value that does not look like a scheme to a regex can
 * still become one by the time a browser sees it.
 *
 * The invariant is narrow and absolute: whatever survives validation parses as
 * http or https. Nothing else about the URL is promised -- an arbitrary host is
 * accepted, and always was.
 */

const base = {
  first_name: "A",
  last_name: "B",
  email: "a@wustl.edu",
  password: "password123",
  confirm_password: "password123",
  major: "M",
  graduation_year: new Date().getFullYear() + 1,
  degree_level: "undergraduate" as const,
  shpe_national_member: false,
  shpe_national_member_id: "",
};

const parse = (linkedin_url: string) => registerSchema.safeParse({ ...base, linkedin_url });

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const SOH = String.fromCharCode(1);
const BACKSLASH = String.fromCharCode(92);

describe("profile URL validation", () => {
  /*
   * Every one of these carries a scheme the regex recognises, so the value is
   * left alone and refused by the protocol check -- rather than being prefixed
   * into something that looks safe.
   */
  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    ["blob:https://x.com/abc"],
    ["javascript://linkedin.com%0aalert(1)"],
    [" javascript:alert(1) "],
  ])("rejects %j", (input) => {
    expect(parse(input).success).toBe(false);
  });

  /*
   * The interesting half. A regex sees "java<TAB>script:" as scheme-less and
   * would prefix it; the parser then strips the tab. These must not end up as
   * javascript: URLs by that route -- and they do not, because prefixing can
   * only ever produce an https URL, and the leftover ":alert(1)" makes the
   * result unparseable rather than dangerous.
   */
  it.each([
    ["java" + TAB + "script:alert(1)"],
    ["java" + LF + "script:alert(1)"],
    ["jav" + NUL + "ascript:alert(1)"],
    [SOH + "javascript:alert(1)"],
    [NUL + "javascript:alert(1)"],
  ])("does not let %j smuggle a scheme past the prefix", (input) => {
    const result = parse(input);
    if (result.success) {
      expect(new URL(result.data.linkedin_url as string).protocol).toMatch(/^https?:$/);
    }
  });

  /*
   * Accepted, and worth stating plainly rather than leaving implied: these all
   * resolve to a host that is not LinkedIn. That is not a regression -- plain
   * "https://evil.com" passed the previous schema too -- and linkedin_url is
   * never rendered into an href anywhere in the app, so there is no click
   * target. If that ever changes, route it through safeExternalHref.
   */
  it.each([
    ["//evil.com/x"],
    [BACKSLASH + BACKSLASH + "evil.com"],
    ["linkedin.com@evil.com"],
  ])("accepts %j but only ever as http/https", (input) => {
    const result = parse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(new URL(result.data.linkedin_url as string).protocol).toBe("https:");
    }
  });
});

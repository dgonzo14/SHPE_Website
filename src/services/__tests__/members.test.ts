import { describe, expect, it } from "vitest";
import { sanitiseFilterValue } from "../members";

/*
 * fetchMembers builds a PostgREST .or() expression, which is a raw filter
 * string rather than a bound parameter. An unsanitised comma does not error --
 * it silently starts a new OR condition and widens the result set. Against the
 * local database, searching `zzzznomatch` returned 0 rows while
 * `zzzznomatch,first_name.not.is.null` returned all 30 members.
 */
// Written this way rather than as an escape so the character under test stays
// visible in review: "\b" in a source file is a backspace, not a backslash.
const BACKSLASH = String.fromCharCode(92);

describe("sanitiseFilterValue", () => {
  it("removes the characters that break out of a quoted filter value", () => {
    expect(sanitiseFilterValue('a"b')).toBe("ab");
    expect(sanitiseFilterValue(`a${BACKSLASH}b`)).toBe("ab");
    expect(sanitiseFilterValue('x" ,first_name.not.is.null,"')).toBe("x ,first_name.not.is.null,");
  });

  it("leaves ordinary searches intact, commas included", () => {
    expect(sanitiseFilterValue("Rivera")).toBe("Rivera");
    expect(sanitiseFilterValue("  ana  ")).toBe("ana");
    // A comma is harmless once the caller wraps the value in double quotes.
    expect(sanitiseFilterValue("Rivera, Ana")).toBe("Rivera, Ana");
  });
});

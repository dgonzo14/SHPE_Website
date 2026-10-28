import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The real client, with fetch replaced: fetchMembers is tested by the request
 * it actually sends to PostgREST, so how supabase-js serialises .or() is part
 * of what is covered.
 */
const requests = vi.hoisted(() => [] as URL[]);

vi.mock("@/lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient("https://test.supabase.co", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        requests.push(new URL(input instanceof Request ? input.url : String(input)));
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  });
  return { getSupabase: () => client };
});

import { fetchMembers, memberSearchFilters, sanitiseFilterValue } from "../members";

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

describe("memberSearchFilters", () => {
  const anyColumn = (word: string) =>
    ["first_name", "last_name", "email", "major"].map((c) => `${c}.ilike."%${word}%"`).join(",");

  it("gives each word its own condition across the searchable columns", () => {
    expect(memberSearchFilters("Ana Rivera")).toEqual([
      'first_name.ilike."%Ana%",last_name.ilike."%Ana%",email.ilike."%Ana%",major.ilike."%Ana%"',
      'first_name.ilike."%Rivera%",last_name.ilike."%Rivera%",email.ilike."%Rivera%",major.ilike."%Rivera%"',
    ]);
  });

  it("splits on commas and runs of spaces, and drops what's left empty", () => {
    expect(memberSearchFilters("  Rivera,  Ana ")).toEqual(memberSearchFilters("Rivera Ana"));
    expect(memberSearchFilters("")).toEqual([]);
    expect(memberSearchFilters(" , ")).toEqual([]);
    expect(memberSearchFilters('Ana " Rivera')).toHaveLength(2);
  });

  it("keeps an email address in one piece", () => {
    expect(memberSearchFilters("ana.rivera@wustl.edu")).toEqual([anyColumn("ana.rivera@wustl.edu")]);
  });

  it("still can't be talked out of its quotes", () => {
    // The comma that once started a new condition now only ends a word, and
    // the stray quote is stripped, so every piece stays a quoted ilike value.
    expect(memberSearchFilters('x",first_name.not.is.null')).toEqual([
      anyColumn("x"),
      anyColumn("first_name.not.is.null"),
    ]);
  });
});

describe("fetchMembers search", () => {
  const ANA = {
    first_name: "Ana",
    last_name: "Rivera",
    email: "ana.rivera@wustl.edu",
    major: "Mechanical Engineering",
  };
  const LUIS = {
    first_name: "Luis",
    last_name: "Ortiz",
    email: "l.ortiz@wustl.edu",
    major: "Computer Science",
  };

  /**
   * What PostgREST does with the request: every `or` parameter must hold
   * (they're ANDed), and within one, any ilike condition will do.
   */
  function matches(member: Record<string, string>, url: URL): boolean {
    return url.searchParams
      .getAll("or")
      .every((param) =>
        [...param.matchAll(/(\w+)\.ilike\."%([^"]*)%"/g)].some(([, column, word]) =>
          (member[column] ?? "").toLowerCase().includes(word.toLowerCase()),
        ),
      );
  }

  async function search(term: string): Promise<URL> {
    requests.length = 0;
    await fetchMembers({ search: term, status: "active" });
    expect(requests).toHaveLength(1);
    return requests[0];
  }

  beforeEach(() => {
    requests.length = 0;
  });

  it.each([
    "Ana",
    "rivera",
    "Ana Rivera",
    "ana rivera",
    "Ana Riv",
    "Rivera Ana",
    "Rivera, Ana",
    "ana.rivera@wustl.edu",
  ])("finds Ana Rivera by %j", async (term) => {
    const url = await search(term);
    expect(matches(ANA, url)).toBe(true);
    expect(matches(LUIS, url)).toBe(false);
  });

  it("needs every word to match, so a wrong surname finds nobody", async () => {
    const url = await search("Ana Ortiz");
    expect(matches(ANA, url)).toBe(false);
    expect(matches(LUIS, url)).toBe(false);
  });

  it("finds by a major of more than one word", async () => {
    expect(matches(LUIS, await search("Computer Science"))).toBe(true);
  });

  it("sends one or parameter per word, alongside the status filter", async () => {
    const url = await search("Ana Rivera");
    expect(url.pathname).toBe("/rest/v1/profiles");
    expect(url.searchParams.get("membership_status")).toBe("eq.active");
    expect(url.searchParams.getAll("or")).toEqual([
      '(first_name.ilike."%Ana%",last_name.ilike."%Ana%",email.ilike."%Ana%",major.ilike."%Ana%")',
      '(first_name.ilike."%Rivera%",last_name.ilike."%Rivera%",email.ilike."%Rivera%",major.ilike."%Rivera%")',
    ]);
  });

  it("sends no search filter for an empty search", async () => {
    const url = await search("   ");
    expect(url.searchParams.has("or")).toBe(false);
  });
});

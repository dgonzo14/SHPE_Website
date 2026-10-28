import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The real client, with fetch replaced: fetchMembers is tested by the request
 * it actually sends to PostgREST, so how supabase-js serialises the search
 * filters is part of what is covered.
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

import { foldForSearch } from "@/lib/search";
import { fetchMembers, memberSearchPatterns } from "../members";

// Written this way rather than as an escape so the character under test stays
// visible in review: "\b" in a source file is a backspace, not a backslash.
const BACKSLASH = String.fromCharCode(92);

describe("memberSearchPatterns", () => {
  it("gives each word its own pattern", () => {
    expect(memberSearchPatterns("ana rivera")).toEqual(["%ana%", "%rivera%"]);
  });

  it("folds each word the way profiles.search_text is folded", () => {
    expect(memberSearchPatterns("María José Muñoz")).toEqual(["%maria%", "%jose%", "%munoz%"]);
    expect(memberSearchPatterns("Munoz")).toEqual(memberSearchPatterns("Muñoz"));
  });

  it("splits on commas and runs of spaces, and drops what's left empty", () => {
    expect(memberSearchPatterns("  Rivera,  Ana ")).toEqual(memberSearchPatterns("Rivera Ana"));
    expect(memberSearchPatterns("")).toEqual([]);
    expect(memberSearchPatterns(" , ")).toEqual([]);
  });

  it("keeps an email address in one piece", () => {
    expect(memberSearchPatterns("ana.rivera@wustl.edu")).toEqual(["%ana.rivera@wustl.edu%"]);
  });

  it("escapes LIKE's metacharacters, so they match only themselves", () => {
    expect(memberSearchPatterns("a_b")).toEqual([`%a${BACKSLASH}_b%`]);
    expect(memberSearchPatterns("100%")).toEqual([`%100${BACKSLASH}%%`]);
    expect(memberSearchPatterns(`a${BACKSLASH}b`)).toEqual([`%a${BACKSLASH}${BACKSLASH}b%`]);
  });

  it("passes quotes and filter syntax through as text to match, not as syntax", () => {
    // A comma now only ends a word, and the rest is a value in one column's
    // filter, where PostgREST reads nothing as an operator.
    expect(memberSearchPatterns('x",first_name.not.is.null')).toEqual([
      '%x"%',
      `%first${BACKSLASH}_name.not.is.null%`,
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
  const MARIA = {
    first_name: "María José",
    last_name: "Muñoz Peña",
    // None of her name, so finding her by it relies on the folding alone.
    email: "mjmp@wustl.edu",
    major: "Ingeniería Biomédica",
  };

  /**
   * What the database does with the request: search_text is the member's
   * fields folded (20260921000001_member_search_text.sql), and every
   * search_text filter must hold. PostgREST ANDs repeated filters on a column;
   * that was checked against a real PostgREST when this was written.
   */
  function matches(member: Record<string, string>, url: URL): boolean {
    const searchText = foldForSearch(
      [member.first_name, member.last_name, member.email, member.major].join(" "),
    );
    return url.searchParams.getAll("search_text").every((filter) => {
      const pattern = filter.replace(/^ilike\./, "");
      const literal = pattern.slice(1, -1).replace(/\\(.)/g, "$1");
      return pattern.startsWith("%") && pattern.endsWith("%") && searchText.includes(literal);
    });
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

  it.each(["Munoz", "muñoz", "Maria Jose", "María José Muñoz", "pena", "biomedica", "Muñoz, María"])(
    "finds María José Muñoz Peña by %j, accents or not",
    async (term) => {
      const url = await search(term);
      expect(matches(MARIA, url)).toBe(true);
      expect(matches(ANA, url)).toBe(false);
    },
  );

  it("sends one search_text filter per word, alongside the status filter", async () => {
    const url = await search("Ana Muñoz");
    expect(url.pathname).toBe("/rest/v1/profiles");
    expect(url.searchParams.get("membership_status")).toBe("eq.active");
    expect(url.searchParams.getAll("search_text")).toEqual(["ilike.%ana%", "ilike.%munoz%"]);
    // The raw .or() expression, and the escaping it needed, are gone.
    expect(url.searchParams.has("or")).toBe(false);
  });

  it("sends no search filter for an empty search", async () => {
    const url = await search("   ");
    expect(url.searchParams.has("search_text")).toBe(false);
  });
});

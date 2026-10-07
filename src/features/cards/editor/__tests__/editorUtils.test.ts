import { describe, expect, it } from "vitest";
import type { FieldErrors } from "react-hook-form";

import type { CardFormValues } from "@/lib/validation";
import {
  arrayErrorMessage,
  displayCardUrl,
  errorFocusName,
  firstError,
  imagesToRemove,
  mediaPathsOf,
  mergeServerValues,
  profileDisplayName,
  sameFormValue,
  tabsWithErrors,
} from "../editorUtils";
import { emptyCardFormValues } from "../../viewModel";

const A = "11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";
const B = "11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp";
const C = "11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg";

const err = (message: string) => ({ type: "custom", message });

describe("images left behind by a save", () => {
  it("lists the paths a card points at, blanks dropped", () => {
    expect(mediaPathsOf({ avatar_path: A, banner_path: null, background_path: C })).toEqual([A, C]);
    expect(mediaPathsOf(null)).toEqual([]);
  });

  it("removes a replaced photo and keeps its replacement", () => {
    expect(imagesToRemove([A], [B])).toEqual([A]);
  });

  it("removes uploads that were themselves replaced before saving", () => {
    // Stored A; uploaded B, then C; saved with C.
    expect(imagesToRemove([A, B, C], [C])).toEqual([A, B]);
  });

  it("removes nothing when nothing changed, and never lists a path twice", () => {
    expect(imagesToRemove([A, A, null, undefined], [A])).toEqual([]);
    expect(imagesToRemove([B, B], [])).toEqual([B]);
  });
});

describe("routing a failed save to the right tab", () => {
  it("names every tab with a problem", () => {
    const errors = {
      bio: err("Too long"),
      links: [undefined, { value: err("Enter a full link") }],
      theme: err("Bad theme"),
    } as unknown as FieldErrors<CardFormValues>;
    expect([...tabsWithErrors(errors)].sort()).toEqual(["content", "design", "links"]);
  });

  it("picks the first problem in screen order, whatever order the errors arrive in", () => {
    const errors = {
      theme: err("Bad theme"),
      links: [{ value: err("Enter a full link") }],
      display_name: err("Enter the name to show on your card"),
    } as unknown as FieldErrors<CardFormValues>;
    expect(firstError(errors)).toEqual({ field: "display_name", tab: "content" });
    expect(firstError({})).toBeNull();
  });

  it("focuses the broken link's own input", () => {
    const errors = {
      links: [undefined, undefined, { value: err("Enter a full link") }],
    } as unknown as FieldErrors<CardFormValues>;
    expect(errorFocusName(errors, "links")).toBe("links.2.value");

    const labelOnly = {
      links: [{ label: err("Keep labels under 40 characters") }],
    } as unknown as FieldErrors<CardFormValues>;
    expect(errorFocusName(labelOnly, "links")).toBe("links.0.label");
  });

  it("has nothing to focus for a theme problem, and the field itself otherwise", () => {
    expect(errorFocusName({}, "theme")).toBeNull();
    expect(errorFocusName({}, "handle")).toBe("handle");
  });

  it("reads an array error from the array, its root, or its first item", () => {
    expect(arrayErrorMessage(err("Up to 15 skills"))).toBe("Up to 15 skills");
    expect(arrayErrorMessage({ root: err("Only one link can be featured") })).toBe(
      "Only one link can be featured",
    );
    expect(arrayErrorMessage([undefined, err("Keep each skill under 30 characters")])).toBe(
      "Keep each skill under 30 characters",
    );
    expect(arrayErrorMessage(undefined)).toBeUndefined();
  });
});

describe("words", () => {
  it("builds the profile name from whichever parts exist", () => {
    expect(profileDisplayName({ first_name: " Ana ", last_name: "Rivera" })).toBe("Ana Rivera");
    expect(profileDisplayName({ first_name: "Ana", last_name: "" })).toBe("Ana");
    expect(profileDisplayName({ first_name: "", last_name: "" })).toBe("");
  });

  it("writes a card address without the scheme", () => {
    const shown = displayCardUrl("ana-rivera");
    expect(shown).toMatch(/\/card\/ana-rivera$/);
    expect(shown).not.toMatch(/^https?:/);
  });
});

describe("re-seeding the form mid-edit", () => {
  const base: CardFormValues = {
    ...emptyCardFormValues({ first_name: "Ana", last_name: "Rivera" }, "ana-rivera"),
    headline: "CS student",
    links: [
      { id: "l1", kind: "linkedin", label: "", value: "https://www.linkedin.com/in/ana", is_featured: false, is_visible: true },
    ],
  };

  it("compares values by shape, ignoring key order and keys left undefined", () => {
    expect(sameFormValue({ preset: "paper", colors: { text: "#111111" } }, { colors: { text: "#111111" }, preset: "paper" })).toBe(true);
    expect(sameFormValue({ preset: "paper", layout: undefined }, { preset: "paper" })).toBe(true);
    expect(sameFormValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameFormValue([], {})).toBe(false);
    expect(sameFormValue(null, {})).toBe(false);
    expect(sameFormValue("", null)).toBe(false);
  });

  it("takes the stored value for untouched fields and keeps the member's changes", () => {
    const current = { ...base, headline: "SWE intern" };
    const server = { ...base, handle: "ana-zulu", pronouns: "they/them", headline: "Changed elsewhere" };

    const merged = mergeServerValues(current, base, server);

    expect(merged.handle).toBe("ana-zulu");
    expect(merged.pronouns).toBe("they/them");
    expect(merged.headline).toBe("SWE intern");
  });

  it("keeps or replaces a list as a whole, never row by row", () => {
    const current = {
      ...base,
      links: [{ ...base.links[0], value: "https://www.linkedin.com/in/ana-r" }],
    };
    const server = {
      ...base,
      links: [
        { id: "l2", kind: "github" as const, label: "", value: "https://github.com/ana", is_featured: false, is_visible: true },
        base.links[0],
      ],
    };

    expect(mergeServerValues(current, base, server).links).toEqual(current.links);
    expect(mergeServerValues(base, base, server).links).toEqual(server.links);
  });

  it("treats a theme rewritten in a different key order as unchanged", () => {
    const seeded = { ...base, theme: { preset: "paper" as const, density: "compact" as const } };
    const current = { ...seeded, theme: { density: "compact" as const, preset: "paper" as const } };
    const server = { ...seeded, theme: { preset: "midnight" as const } };

    expect(mergeServerValues(current, seeded, server).theme).toEqual({ preset: "midnight" });
  });
});

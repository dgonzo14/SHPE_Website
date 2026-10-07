import { describe, expect, it } from "vitest";

import { cardFormSchema, type CardFormValues } from "@/lib/validation";
import type { CardLink, CardProfileFields, MemberCard, MemberCardInput } from "@/types/database";
import { DEFAULT_CARD_SECTIONS, DEFAULT_CARD_THEME, DEFAULT_ORGANIZATION } from "../model";
import { cardToFormValues, emptyCardFormValues, formValuesToInput, toPreviewCard } from "../viewModel";

/*
 * An independent check on the contract's conversions. toPreviewCard() has to
 * reproduce get_public_card()'s visibility rules exactly, or the editor's
 * preview would promise one thing and the public card show another.
 */

const MEMBER = "11111111-1111-4111-8111-111111111111";
const AVATAR = `${MEMBER}/22222222-2222-4222-8222-222222222222.webp`;

const profile: CardProfileFields = {
  first_name: "Ana",
  last_name: "Rivera",
  major: "Computer Science",
  secondary_major: "Mathematics",
  graduation_year: 2028,
  degree_level: "undergraduate",
  member_since: "2025-08-25",
  national_member_verified: true,
  membership_status: "active",
};

function storedCard(overrides: Partial<MemberCard> = {}): MemberCard {
  return {
    member_id: MEMBER,
    handle: "ana-rivera",
    is_published: true,
    allow_indexing: false,
    hidden_at: null,
    hidden_reason: null,
    created_by_officer: false,
    member_opened_at: "2026-09-20T15:00:00Z",
    chip_handle: null,
    chip_handle_active: null,
    chip_written_at: null,
    display_name: "Ana Rivera",
    pronouns: "she/her",
    headline: "Mechanical engineering @ WashU",
    organization: DEFAULT_ORGANIZATION,
    status_line: null,
    bio: "Robotics, rockets and café con leche.\nHablo español.",
    location: null,
    skills: ["CAD", "Python"],
    languages: ["English", "Español"],
    avatar_path: AVATAR,
    banner_path: null,
    background_path: null,
    show_major: true,
    show_graduation_year: true,
    show_member_since: false,
    show_national_member: true,
    show_chapter_position: true,
    theme: { preset: "midnight", colors: { accent: "#e84e1b" } },
    sections: ["status", "links", "about"],
    created_at: "2026-09-20T15:00:00Z",
    updated_at: "2026-09-21T15:00:00Z",
    ...overrides,
  };
}

const links: CardLink[] = [
  { id: "l-2", kind: "email", label: null, value: "ana@example.com", sort_order: 2, is_featured: false, is_visible: true },
  { id: "l-1", kind: "linkedin", label: "Let's connect", value: "https://www.linkedin.com/in/ana", sort_order: 1, is_featured: true, is_visible: true },
  { id: "l-3", kind: "phone", label: null, value: "+1 314 555 0123", sort_order: 3, is_featured: false, is_visible: false },
];

function pickInput(card: MemberCard): MemberCardInput {
  const {
    handle, display_name, pronouns, headline, organization, status_line, bio, location, skills,
    languages, avatar_path, banner_path, background_path, show_major, show_graduation_year,
    show_member_since, show_national_member, show_chapter_position, theme, sections, allow_indexing,
  } = card;
  return {
    handle, display_name, pronouns, headline, organization, status_line, bio, location, skills,
    languages, avatar_path, banner_path, background_path, show_major, show_graduation_year,
    show_member_since, show_national_member, show_chapter_position, theme, sections, allow_indexing,
  };
}

function formFor(overrides: Partial<CardFormValues> = {}): CardFormValues {
  return { ...cardToFormValues(storedCard(), links), ...overrides };
}

describe("emptyCardFormValues", () => {
  it("starts from the profile name, the school, the suggested handle and the default look", () => {
    const values = emptyCardFormValues(profile, "ana-rivera");
    expect(values).toMatchObject({
      handle: "ana-rivera",
      display_name: "Ana Rivera",
      organization: DEFAULT_ORGANIZATION,
      pronouns: "",
      headline: "",
      skills: [],
      links: [],
      avatar_path: null,
      show_member_since: false,
      allow_indexing: false,
      theme: DEFAULT_CARD_THEME,
      sections: [...DEFAULT_CARD_SECTIONS],
    });
  });

  it("never copies contact details from the profile", () => {
    const values = emptyCardFormValues(profile, "ana-rivera");
    expect(values.links).toEqual([]);
  });

  it("copies the shared defaults rather than aliasing them", () => {
    const values = emptyCardFormValues(profile, null);
    expect(values.theme).not.toBe(DEFAULT_CARD_THEME);
    expect(values.sections).not.toBe(DEFAULT_CARD_SECTIONS);
  });

  it("copes with a missing name part and a missing suggestion", () => {
    expect(emptyCardFormValues({ first_name: "  Ana ", last_name: "" }, null)).toMatchObject({
      handle: "",
      display_name: "Ana",
    });
  });

  it("produces values the form schema accepts once there's a handle", () => {
    expect(cardFormSchema.safeParse(emptyCardFormValues(profile, "ana-rivera")).success).toBe(true);
  });
});

describe("cardToFormValues", () => {
  it("turns nulls into empty strings and orders links by sort_order", () => {
    const values = cardToFormValues(storedCard(), links);
    expect(values.status_line).toBe("");
    expect(values.location).toBe("");
    expect(values.links.map((l) => l.id)).toEqual(["l-1", "l-2", "l-3"]);
    expect(values.links[1]).toEqual({
      id: "l-2",
      kind: "email",
      label: "",
      value: "ana@example.com",
      is_featured: false,
      is_visible: true,
    });
  });

  it("copies arrays, so editing the form can't mutate the cached card", () => {
    const card = storedCard();
    const values = cardToFormValues(card, links);
    expect(values.skills).not.toBe(card.skills);
    expect(values.sections).not.toBe(card.sections);
    values.skills.push("Rust");
    expect(card.skills).toEqual(["CAD", "Python"]);
  });

  it("gives the form schema values it accepts", () => {
    expect(cardFormSchema.safeParse(cardToFormValues(storedCard(), links)).success).toBe(true);
  });
});

describe("formValuesToInput", () => {
  it("round-trips a stored card unchanged", () => {
    const card = storedCard();
    const { card: input, links: linkInput } = formValuesToInput(cardToFormValues(card, links));
    expect(input).toEqual(pickInput(card));
    expect(linkInput).toEqual(
      [...links]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id, kind, label, value, is_featured, is_visible }) => ({
          id,
          kind,
          label,
          value,
          is_featured,
          is_visible,
        })),
    );
  });

  it("turns blanks into nulls and trims what the member typed", () => {
    const { card, links: out } = formValuesToInput(
      formFor({
        handle: "  Ana-Rivera ",
        display_name: "  Ana Rivera  ",
        pronouns: "   ",
        headline: " Builder ",
        organization: "",
        skills: [" CAD ", "", "  "],
        languages: [" Español "],
        links: [{ kind: "website", label: "  ", value: " https://ana.dev ", is_featured: false, is_visible: true }],
      }),
    );
    expect(card).toMatchObject({
      handle: "ana-rivera",
      display_name: "Ana Rivera",
      pronouns: null,
      headline: "Builder",
      organization: null,
      skills: ["CAD"],
      languages: ["Español"],
    });
    expect(out).toEqual([
      { id: null, kind: "website", label: null, value: "https://ana.dev", is_featured: false, is_visible: true },
    ]);
  });

  it("sends exactly the keys save_my_card() requires", () => {
    const { card } = formValuesToInput(formFor());
    expect(Object.keys(card).sort()).toEqual(Object.keys(pickInput(storedCard())).sort());
  });
});

describe("toPreviewCard", () => {
  it("shows education, position and the verified National badge when switched on", () => {
    const preview = toPreviewCard(formFor(), { profile, position: "President" });
    expect(preview.education).toEqual({
      major: "Computer Science",
      secondary_major: "Mathematics",
      graduation_year: 2028,
      degree_level: "undergraduate",
    });
    expect(preview.shpe).toEqual({
      position: "President",
      member_since: null,
      national_member_verified: true,
      is_alumni: false,
    });
    expect(preview.is_starter).toBe(false);
  });

  it("hides the majors without show_major, keeping the year and degree", () => {
    const preview = toPreviewCard(formFor({ show_major: false }), { profile, position: null });
    expect(preview.education).toEqual({
      major: null,
      secondary_major: null,
      graduation_year: 2028,
      degree_level: "undergraduate",
    });
  });

  it("hides the year without show_graduation_year, keeping the majors and degree", () => {
    const preview = toPreviewCard(formFor({ show_graduation_year: false }), { profile, position: null });
    expect(preview.education).toEqual({
      major: "Computer Science",
      secondary_major: "Mathematics",
      graduation_year: null,
      degree_level: "undergraduate",
    });
  });

  it("drops education entirely when both are off, degree level included", () => {
    const preview = toPreviewCard(formFor({ show_major: false, show_graduation_year: false }), {
      profile,
      position: null,
    });
    expect(preview.education).toBeNull();
  });

  it("drops education when the profile has nothing left to show", () => {
    const sparse = { ...profile, major: null, secondary_major: null, graduation_year: null };
    expect(toPreviewCard(formFor(), { profile: sparse, position: null }).education).toBeNull();
    // Degree level alone is not enough to show the block.
    expect(
      toPreviewCard(formFor({ show_major: false }), {
        profile: { ...profile, graduation_year: null },
        position: null,
      }).education,
    ).toBeNull();
  });

  it("shows the position only when show_chapter_position is on", () => {
    const preview = toPreviewCard(formFor({ show_chapter_position: false }), { profile, position: "President" });
    expect(preview.shpe.position).toBeNull();
  });

  it("shows member-since only when opted in", () => {
    expect(toPreviewCard(formFor(), { profile, position: null }).shpe.member_since).toBeNull();
    expect(
      toPreviewCard(formFor({ show_member_since: true }), { profile, position: null }).shpe.member_since,
    ).toBe("2025-08-25");
  });

  it("needs both verification and the toggle for the National badge", () => {
    const unverified = { ...profile, national_member_verified: false };
    expect(toPreviewCard(formFor(), { profile: unverified, position: null }).shpe.national_member_verified).toBe(
      false,
    );
    expect(
      toPreviewCard(formFor({ show_national_member: false }), { profile, position: null }).shpe
        .national_member_verified,
    ).toBe(false);
  });

  it("marks alumni", () => {
    const alumni = { ...profile, membership_status: "alumni" as const };
    expect(toPreviewCard(formFor(), { profile: alumni, position: null }).shpe.is_alumni).toBe(true);
  });

  it("shows only visible links with a value, in order, with stable ids", () => {
    const preview = toPreviewCard(
      formFor({
        links: [
          { id: "l-1", kind: "linkedin", label: "", value: "https://www.linkedin.com/in/ana", is_featured: true, is_visible: true },
          { kind: "github", label: "Code", value: "https://github.com/ana", is_featured: false, is_visible: true },
          { id: "l-3", kind: "phone", label: "", value: "+1 314 555 0123", is_featured: false, is_visible: false },
          { kind: "website", label: "", value: "   ", is_featured: false, is_visible: true },
        ],
      }),
      { profile, position: null },
    );
    expect(preview.links).toEqual([
      { id: "l-1", kind: "linkedin", label: null, value: "https://www.linkedin.com/in/ana", is_featured: true },
      { id: "preview-1", kind: "github", label: "Code", value: "https://github.com/ana", is_featured: false },
    ]);
    expect(new Set(preview.links.map((l) => l.id)).size).toBe(preview.links.length);
  });

  it("carries the card's own fields through with blanks as nulls", () => {
    const preview = toPreviewCard(formFor({ status_line: "  ", pronouns: "she/her" }), { profile, position: null });
    expect(preview).toMatchObject({
      handle: "ana-rivera",
      display_name: "Ana Rivera",
      pronouns: "she/her",
      status_line: null,
      avatar_path: AVATAR,
      theme: { preset: "midnight", colors: { accent: "#e84e1b" } },
      sections: ["status", "links", "about"],
      skills: ["CAD", "Python"],
    });
  });
});

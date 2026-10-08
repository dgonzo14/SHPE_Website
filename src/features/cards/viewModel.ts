import type { CardFormValues, CardLinkFormValues } from "@/lib/validation";
import type {
  CardLink,
  CardLinkInput,
  CardProfileFields,
  MemberCard,
  MemberCardInput,
  PublicCardData,
} from "@/types/database";
import { DEFAULT_CARD_SECTIONS, DEFAULT_CARD_THEME, DEFAULT_ORGANIZATION } from "./model";

/**
 * Conversions between the three shapes a card takes:
 *
 *   MemberCard + CardLink[]   what get_my_card() returns (the stored card)
 *   CardFormValues            what the editor's form holds ("" for empty)
 *   PublicCardData            what the renderer draws
 *
 * toPreviewCard() reproduces get_public_card()'s rules for which profile
 * facts appear. That is the property that makes the editor's preview honest,
 * so the two must change together: if the database starts hiding something,
 * this has to hide it too.
 */

/** Blank -> null. Text fields are strings in the form and nullable in the database. */
function blank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** A new card: the profile name, the school, the suggested handle, the default look. */
export function emptyCardFormValues(
  profile: Pick<CardProfileFields, "first_name" | "last_name">,
  suggestedHandle: string | null,
): CardFormValues {
  const name = [profile.first_name, profile.last_name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  return {
    handle: suggestedHandle ?? "",
    display_name: name,
    pronouns: "",
    headline: "",
    organization: DEFAULT_ORGANIZATION,
    status_line: "",
    bio: "",
    location: "",
    skills: [],
    languages: [],
    avatar_path: null,
    banner_path: null,
    background_path: null,
    show_major: true,
    show_graduation_year: true,
    show_member_since: false,
    show_national_member: true,
    show_chapter_position: true,
    theme: { ...DEFAULT_CARD_THEME },
    sections: [...DEFAULT_CARD_SECTIONS],
    allow_indexing: false,
    links: [],
  };
}

/** The stored card, as form values. */
export function cardToFormValues(card: MemberCard, links: CardLink[]): CardFormValues {
  return {
    handle: card.handle,
    display_name: card.display_name,
    pronouns: card.pronouns ?? "",
    headline: card.headline ?? "",
    organization: card.organization ?? "",
    status_line: card.status_line ?? "",
    bio: card.bio ?? "",
    location: card.location ?? "",
    skills: [...card.skills],
    languages: [...card.languages],
    avatar_path: card.avatar_path,
    banner_path: card.banner_path,
    background_path: card.background_path,
    show_major: card.show_major,
    show_graduation_year: card.show_graduation_year,
    show_member_since: card.show_member_since,
    show_national_member: card.show_national_member,
    show_chapter_position: card.show_chapter_position,
    theme: card.theme,
    sections: [...card.sections],
    allow_indexing: card.allow_indexing,
    links: [...links]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((link) => ({
        id: link.id,
        kind: link.kind,
        label: link.label ?? "",
        value: link.value,
        is_featured: link.is_featured,
        is_visible: link.is_visible,
      })),
  };
}

/** What save_my_card() takes: the card and its links, blanks as nulls. */
export function formValuesToInput(values: CardFormValues): {
  card: MemberCardInput;
  links: CardLinkInput[];
} {
  return {
    card: {
      handle: values.handle.trim().toLowerCase(),
      display_name: values.display_name.trim(),
      pronouns: blank(values.pronouns),
      headline: blank(values.headline),
      organization: blank(values.organization),
      status_line: blank(values.status_line),
      bio: blank(values.bio),
      location: blank(values.location),
      skills: values.skills.map((s) => s.trim()).filter(Boolean),
      languages: values.languages.map((s) => s.trim()).filter(Boolean),
      avatar_path: values.avatar_path,
      banner_path: values.banner_path,
      background_path: values.background_path,
      show_major: values.show_major,
      show_graduation_year: values.show_graduation_year,
      show_member_since: values.show_member_since,
      show_national_member: values.show_national_member,
      show_chapter_position: values.show_chapter_position,
      theme: values.theme,
      sections: values.sections,
      allow_indexing: values.allow_indexing,
    },
    links: values.links.map((link: CardLinkFormValues) => ({
      id: link.id ?? null,
      kind: link.kind,
      label: blank(link.label),
      value: link.value.trim(),
      is_featured: link.is_featured,
      is_visible: link.is_visible,
    })),
  };
}

/**
 * The renderer's input for the editor preview. Mirrors get_public_card():
 *
 *   education  major and second major when show_major; class year when
 *              show_graduation_year; degree level when either is on; null when
 *              nothing is left to show.
 *   shpe       the officer-assigned position when show_chapter_position; member
 *              since when show_member_since; the National badge only when the
 *              membership is officer-verified AND show_national_member.
 *   links      visible links only, in order.
 */
export function toPreviewCard(
  values: CardFormValues,
  context: { profile: CardProfileFields; position: string | null },
): PublicCardData {
  const { card, links } = formValuesToInput(values);
  const { profile, position } = context;

  // Blank counts as absent, exactly as get_public_card() does with nullif(btrim()).
  const major = card.show_major ? blank(profile.major ?? "") : null;
  const secondary = card.show_major ? blank(profile.secondary_major ?? "") : null;
  const year = card.show_graduation_year ? profile.graduation_year : null;
  const degree = card.show_major || card.show_graduation_year ? profile.degree_level : null;
  const education =
    major !== null || secondary !== null || year !== null
      ? { major, secondary_major: secondary, graduation_year: year, degree_level: degree }
      : null;

  return {
    handle: card.handle,
    display_name: card.display_name,
    pronouns: card.pronouns,
    headline: card.headline,
    organization: card.organization,
    status_line: card.status_line,
    bio: card.bio,
    location: card.location,
    skills: card.skills,
    languages: card.languages,
    avatar_path: card.avatar_path,
    banner_path: card.banner_path,
    background_path: card.background_path,
    theme: card.theme,
    sections: card.sections,
    allow_indexing: card.allow_indexing,
    is_starter: false,
    education,
    shpe: {
      position: card.show_chapter_position ? position : null,
      member_since: card.show_member_since ? profile.member_since : null,
      national_member_verified: card.show_national_member && profile.national_member_verified,
      is_alumni: profile.membership_status === "alumni",
    },
    links: links
      .filter((link) => link.is_visible && link.value)
      .map((link, index) => ({
        id: link.id ?? `preview-${index}`,
        kind: link.kind,
        label: link.label,
        value: link.value,
        is_featured: link.is_featured,
      })),
  };
}

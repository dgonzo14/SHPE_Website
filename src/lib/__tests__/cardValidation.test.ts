import { describe, expect, it } from "vitest";

import migration from "../../../supabase/migrations/20260914000001_member_business_cards.sql?raw";
import {
  CARD_AVATAR_SHAPES,
  CARD_BACKGROUND_TYPES,
  CARD_BUTTON_ARRANGEMENTS,
  CARD_BUTTON_SHAPES,
  CARD_BUTTON_STYLES,
  CARD_DENSITIES,
  CARD_FONT_IDS,
  CARD_LAYOUTS,
  CARD_LIMITS,
  CARD_LINK_KINDS,
  CARD_PATTERNS,
  CARD_PRESET_IDS,
  CARD_PRIMARY_FILLS,
  CARD_SECTION_IDS,
  HANDLE_PATTERN,
  RESERVED_HANDLES,
} from "@/features/cards/model";
import {
  cardFormSchema,
  cardHandleResetSchema,
  cardHandleSchema,
  cardHideSchema,
  cardLinkFormSchema,
  cardThemeSchema,
  chapterPositionSchema,
  type CardFormValues,
  type CardLinkFormValues,
} from "../validation";

/*
 * The card schemas exist for instant, field-level messages; the database
 * (private.card_theme_is_valid, the CHECK constraints, save_my_card) is the
 * authority. The property that matters most here is the one-way guarantee:
 * nothing these schemas accept may be something the database rejects, or a
 * member gets a form that looks fine and a save that fails.
 */

const MEMBER = "11111111-1111-4111-8111-111111111111";
const IMAGE = `${MEMBER}/22222222-2222-4222-8222-222222222222.webp`;

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

function messages(result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`);
}

function link(overrides: Partial<CardLinkFormValues> = {}): CardLinkFormValues {
  return {
    kind: "website",
    label: "",
    value: "https://ana.dev",
    is_featured: false,
    is_visible: true,
    ...overrides,
  };
}

function form(overrides: Partial<CardFormValues> = {}): CardFormValues {
  return {
    handle: "ana-rivera",
    display_name: "Ana Rivera",
    pronouns: "she/her",
    headline: "Mechanical engineering",
    organization: "Washington University in St. Louis",
    status_line: "",
    bio: "",
    location: "",
    skills: ["CAD"],
    languages: ["Español"],
    avatar_path: IMAGE,
    banner_path: null,
    background_path: null,
    show_major: true,
    show_graduation_year: true,
    show_member_since: false,
    show_national_member: true,
    show_chapter_position: true,
    theme: { preset: "shpe-classic" },
    sections: ["status", "featured", "links"],
    allow_indexing: false,
    links: [link()],
    ...overrides,
  };
}

/* ── Theme ───────────────────────────────────────────────────────────────── */

describe("cardThemeSchema", () => {
  it("accepts every preset on its own", () => {
    for (const preset of CARD_PRESET_IDS) expect(ok(cardThemeSchema, { preset }), preset).toBe(true);
  });

  it("accepts every value of every enum", () => {
    for (const layout of CARD_LAYOUTS) expect(ok(cardThemeSchema, { preset: "paper", layout })).toBe(true);
    for (const type of CARD_BACKGROUND_TYPES) {
      expect(ok(cardThemeSchema, { preset: "paper", background: { type } })).toBe(true);
    }
    for (const pattern of CARD_PATTERNS) {
      expect(ok(cardThemeSchema, { preset: "paper", background: { type: "pattern", pattern } })).toBe(true);
    }
    for (const id of CARD_FONT_IDS) {
      expect(ok(cardThemeSchema, { preset: "paper", font: { heading: id, body: id } })).toBe(true);
    }
    for (const shape of CARD_BUTTON_SHAPES) {
      expect(ok(cardThemeSchema, { preset: "paper", buttons: { shape } })).toBe(true);
    }
    for (const style of CARD_BUTTON_STYLES) {
      expect(ok(cardThemeSchema, { preset: "paper", buttons: { style } })).toBe(true);
    }
    for (const arrangement of CARD_BUTTON_ARRANGEMENTS) {
      expect(ok(cardThemeSchema, { preset: "paper", buttons: { arrangement } })).toBe(true);
    }
    for (const primary of CARD_PRIMARY_FILLS) {
      expect(ok(cardThemeSchema, { preset: "paper", buttons: { primary } })).toBe(true);
    }
    for (const shape of CARD_AVATAR_SHAPES) {
      expect(ok(cardThemeSchema, { preset: "paper", avatar: { shape, ring: true } })).toBe(true);
    }
    for (const density of CARD_DENSITIES) expect(ok(cardThemeSchema, { preset: "paper", density })).toBe(true);
  });

  it("accepts the plan's full example, and colours in either case", () => {
    expect(
      ok(cardThemeSchema, {
        preset: "shpe-classic",
        layout: "banner",
        colors: {
          background: "#0b1f3a",
          surface: "#FFFFFF",
          text: "#1b365d",
          muted: "#4b5563",
          accent: "#E84E1B",
          accentText: "#ffffff",
        },
        background: { type: "gradient", from: "#1b365d", to: "#e84e1b", angle: 135 },
        font: { heading: "libre-franklin", body: "inter" },
        buttons: { shape: "pill", style: "filled", arrangement: "list", icons: true },
        avatar: { shape: "circle", ring: true },
        density: "comfortable",
      }),
    ).toBe(true);
  });

  it("requires a known preset", () => {
    expect(ok(cardThemeSchema, {})).toBe(false);
    expect(ok(cardThemeSchema, { preset: "neon" })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "SHPE-CLASSIC" })).toBe(false);
  });

  it("rejects unknown keys at every level, as the database does", () => {
    expect(ok(cardThemeSchema, { preset: "paper", css: "body{}" })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", colors: { link: "#000000" } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", background: { type: "image", url: "https://x" } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", font: { title: "inter" } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", buttons: { radius: 4 } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", avatar: { size: 4 } })).toBe(false);
  });

  it("rejects anything but #rrggbb colours", () => {
    for (const bad of ["#fff", "1b365d", "#1b365dd", "#gggggg", "red", "rgb(0,0,0)", "#1b365d;x", ""]) {
      expect(ok(cardThemeSchema, { preset: "paper", colors: { accent: bad } }), bad).toBe(false);
      expect(ok(cardThemeSchema, { preset: "paper", background: { type: "gradient", from: bad } }), bad).toBe(false);
    }
  });

  it("rejects out-of-range numbers and unknown enum values", () => {
    const bg = (extra: object) => ({ preset: "paper", background: { type: "gradient", ...extra } });
    expect(ok(cardThemeSchema, bg({ angle: 0 }))).toBe(true);
    expect(ok(cardThemeSchema, bg({ angle: 360 }))).toBe(true);
    expect(ok(cardThemeSchema, bg({ angle: -1 }))).toBe(false);
    expect(ok(cardThemeSchema, bg({ angle: 361 }))).toBe(false);
    expect(ok(cardThemeSchema, bg({ angle: 45.5 }))).toBe(false);
    expect(ok(cardThemeSchema, bg({ dim: 80 }))).toBe(true);
    expect(ok(cardThemeSchema, bg({ dim: 81 }))).toBe(false);
    expect(ok(cardThemeSchema, bg({ dim: "40" }))).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", background: { from: "#000000" } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", background: { type: "video" } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", layout: "grid" })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", font: { body: "comic-sans" } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", buttons: { icons: "yes" } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", avatar: { ring: 1 } })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", density: "airy" })).toBe(false);
    expect(ok(cardThemeSchema, { preset: "paper", buttons: { primary: "accentText" } })).toBe(false);
  });

  it("can't build a theme past the database's 2000-character cap", () => {
    // The largest theme the schema allows, using the longest value of each enum.
    const longest = <T extends string>(values: readonly T[]) =>
      values.reduce((a, b) => (b.length > a.length ? b : a));
    const hex = "#ffffff";
    const biggest = {
      preset: longest(CARD_PRESET_IDS),
      layout: longest(CARD_LAYOUTS),
      colors: { background: hex, surface: hex, text: hex, muted: hex, accent: hex, accentText: hex },
      background: {
        type: longest(CARD_BACKGROUND_TYPES),
        from: hex,
        to: hex,
        angle: 360,
        dim: 80,
        pattern: longest(CARD_PATTERNS),
      },
      font: { heading: longest(CARD_FONT_IDS), body: longest(CARD_FONT_IDS) },
      buttons: {
        shape: longest(CARD_BUTTON_SHAPES),
        style: longest(CARD_BUTTON_STYLES),
        arrangement: longest(CARD_BUTTON_ARRANGEMENTS),
        icons: false,
        primary: longest(CARD_PRIMARY_FILLS),
      },
      avatar: { shape: longest(CARD_AVATAR_SHAPES), ring: false },
      density: longest(CARD_DENSITIES),
    };
    expect(ok(cardThemeSchema, biggest)).toBe(true);
    // jsonb::text puts a space after every ':' and ','.
    const json = JSON.stringify(biggest);
    const pgLength = json.length + (json.match(/[:,]/g)?.length ?? 0);
    expect(pgLength).toBeLessThan(2000);
  });
});

/* ── Handles ─────────────────────────────────────────────────────────────── */

describe("cardHandleSchema", () => {
  it("accepts well-formed handles, normalising case and spaces", () => {
    expect(cardHandleSchema.parse("diego")).toBe("diego");
    expect(cardHandleSchema.parse("  Diego-Gonzalez-27 ")).toBe("diego-gonzalez-27");
    expect(cardHandleSchema.parse("a1b")).toBe("a1b");
    expect(cardHandleSchema.parse("a".repeat(30))).toBe("a".repeat(30));
  });

  it("rejects malformed handles", () => {
    for (const bad of ["ab", "a".repeat(31), "-abc", "abc-", "a--b", "a_b", "a.b", "josé", "ana rivera", ""]) {
      expect(ok(cardHandleSchema, bad), bad).toBe(false);
    }
  });

  it("agrees with HANDLE_PATTERN (the SQL CHECK) on what is well-formed", () => {
    const samples = ["abc", "a-b-c", "a--b", "-ab", "ab-", "abc1", "1-2-3", "x".repeat(29), "x".repeat(31)];
    for (const s of samples) {
      const reserved = RESERVED_HANDLES.includes(s);
      expect(ok(cardHandleSchema, s), s).toBe(HANDLE_PATTERN.test(s) && !reserved);
    }
  });

  it("refuses every reserved handle, whatever the case", () => {
    for (const handle of RESERVED_HANDLES) {
      expect(ok(cardHandleSchema, handle), handle).toBe(false);
      expect(ok(cardHandleSchema, handle.toUpperCase()), handle).toBe(false);
    }
    expect(messages(cardHandleSchema.safeParse("President"))).toEqual([": That handle is reserved"]);
  });

  it("keeps the reserved list lowercase and free of duplicates", () => {
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
    for (const handle of RESERVED_HANDLES) {
      expect(handle).toBe(handle.toLowerCase());
      // The reserved table's own (looser) shape check, which allows short words.
      expect(handle, handle).toMatch(/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,29}$/);
    }
  });

  it("reserves exactly what the migration seeds into reserved_card_handles", () => {
    const insert = /insert into public\.reserved_card_handles[\s\S]*?on conflict/.exec(migration)?.[0] ?? "";
    const seeded = [...insert.matchAll(/'([a-z0-9-]+)'/g)]
      .map((m) => m[1])
      .filter((word) => !["route", "brand", "role"].includes(word));
    expect(seeded.length).toBeGreaterThan(0);
    expect([...seeded].sort()).toEqual([...RESERVED_HANDLES].sort());
  });
});

/* ── Links ───────────────────────────────────────────────────────────────── */

describe("cardLinkFormSchema", () => {
  it("accepts https links for every URL kind", () => {
    for (const kind of CARD_LINK_KINDS.filter((k) => k !== "email" && k !== "phone")) {
      expect(ok(cardLinkFormSchema, link({ kind, value: "https://example.com/ana?x=1#y" })), kind).toBe(true);
    }
    expect(ok(cardLinkFormSchema, link({ value: "HTTPS://EXAMPLE.COM" }))).toBe(true);
  });

  it("refuses anything that isn't https, or that could break out of an attribute", () => {
    for (const bad of [
      "http://example.com",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//example.com",
      "example.com",
      "https://",
      "https://exa mple.com",
      'https://example.com/"onmouseover="x',
      "https://example.com/<script>",
      "https://example.com/'x",
      "ftp://example.com",
    ]) {
      expect(ok(cardLinkFormSchema, link({ value: bad })), bad).toBe(false);
    }
    expect(messages(cardLinkFormSchema.safeParse(link({ value: "http://example.com" })))).toEqual([
      "value: Enter a full link starting with https://",
    ]);
  });

  it("checks email links as addresses", () => {
    expect(ok(cardLinkFormSchema, link({ kind: "email", value: "ana@example.com" }))).toBe(true);
    for (const bad of ["ana", "ana@", "ana@example", "ana @example.com", "mailto:ana@example.com@"]) {
      expect(ok(cardLinkFormSchema, link({ kind: "email", value: bad })), bad).toBe(false);
    }
    expect(messages(cardLinkFormSchema.safeParse(link({ kind: "email", value: "ana" })))).toEqual([
      "value: Enter a valid email address",
    ]);
  });

  it("checks phone links: the allowed characters and at least seven digits", () => {
    for (const good of ["+1 314 555 0123", "(314) 555-0123", "314.555.0123", "5550123"]) {
      expect(ok(cardLinkFormSchema, link({ kind: "phone", value: good })), good).toBe(true);
    }
    for (const bad of ["555012", "1-2-3-4-5-6", "(((())))", "+1 314 CALL ANA", "+".repeat(1) + "1".repeat(21)]) {
      expect(ok(cardLinkFormSchema, link({ kind: "phone", value: bad })), bad).toBe(false);
    }
  });

  it("trims the value, requires one, and caps value and label length", () => {
    expect(cardLinkFormSchema.parse(link({ value: "  https://ana.dev  " })).value).toBe("https://ana.dev");
    expect(messages(cardLinkFormSchema.safeParse(link({ value: "   " })))).toEqual([
      "value: Add the link or remove this row",
    ]);
    expect(ok(cardLinkFormSchema, link({ value: `https://a.dev/${"x".repeat(CARD_LIMITS.linkValue)}` }))).toBe(false);
    expect(ok(cardLinkFormSchema, link({ label: "x".repeat(CARD_LIMITS.linkLabel) }))).toBe(true);
    expect(ok(cardLinkFormSchema, link({ label: "x".repeat(CARD_LIMITS.linkLabel + 1) }))).toBe(false);
  });

  it("refuses unknown kinds", () => {
    expect(ok(cardLinkFormSchema, { ...link(), kind: "myspace" })).toBe(false);
  });
});

/* ── The whole form ──────────────────────────────────────────────────────── */

describe("cardFormSchema", () => {
  it("accepts a complete card", () => {
    expect(messages(cardFormSchema.safeParse(form()))).toEqual([]);
  });

  it("allows one featured link and refuses two", () => {
    expect(
      ok(cardFormSchema, form({ links: [link({ is_featured: true }), link({ kind: "github", value: "https://github.com/ana" })] })),
    ).toBe(true);
    const result = cardFormSchema.safeParse(
      form({
        links: [
          link({ is_featured: true }),
          link({ kind: "github", value: "https://github.com/ana", is_featured: true }),
        ],
      }),
    );
    expect(messages(result)).toEqual(["links: Only one link can be featured"]);
  });

  it("caps the number of links", () => {
    expect(ok(cardFormSchema, form({ links: Array.from({ length: CARD_LIMITS.links }, () => link()) }))).toBe(true);
    expect(ok(cardFormSchema, form({ links: Array.from({ length: CARD_LIMITS.links + 1 }, () => link()) }))).toBe(
      false,
    );
  });

  it("refuses duplicate skills regardless of case and spacing", () => {
    expect(messages(cardFormSchema.safeParse(form({ skills: ["Python", " python "] })))).toEqual([
      "skills: That skill is already listed",
    ]);
  });

  it("caps skills and languages, in count and length", () => {
    const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    expect(ok(cardFormSchema, form({ skills: many(CARD_LIMITS.skills, "s") }))).toBe(true);
    expect(ok(cardFormSchema, form({ skills: many(CARD_LIMITS.skills + 1, "s") }))).toBe(false);
    expect(ok(cardFormSchema, form({ skills: ["x".repeat(CARD_LIMITS.skillLength + 1)] }))).toBe(false);
    expect(ok(cardFormSchema, form({ languages: many(CARD_LIMITS.languages, "l") }))).toBe(true);
    expect(ok(cardFormSchema, form({ languages: many(CARD_LIMITS.languages + 1, "l") }))).toBe(false);
  });

  it("checks sections: known ids, each at most once", () => {
    expect(ok(cardFormSchema, form({ sections: [...CARD_SECTION_IDS] }))).toBe(true);
    expect(ok(cardFormSchema, form({ sections: [] }))).toBe(true);
    expect(ok(cardFormSchema, form({ sections: ["links", "links"] }))).toBe(false);
    expect(ok(cardFormSchema, { ...form(), sections: ["contact"] })).toBe(false);
  });

  it("only accepts storage paths for images, never URLs", () => {
    expect(ok(cardFormSchema, form({ banner_path: IMAGE.replace(".webp", ".jpg") }))).toBe(true);
    for (const bad of [
      "https://evil.example/pixel.png",
      `${MEMBER}/../other.webp`,
      `${MEMBER}/22222222-2222-4222-8222-222222222222.gif`,
      "ABCDEF12-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp",
      "",
    ]) {
      expect(ok(cardFormSchema, form({ avatar_path: bad })), bad).toBe(false);
    }
  });

  it("requires a name and caps text lengths at the database's limits", () => {
    expect(messages(cardFormSchema.safeParse(form({ display_name: "   " })))).toEqual([
      "display_name: Enter the name to show on your card",
    ]);
    expect(ok(cardFormSchema, form({ display_name: "x".repeat(CARD_LIMITS.displayName + 1) }))).toBe(false);
    expect(ok(cardFormSchema, form({ bio: "x".repeat(CARD_LIMITS.bio) }))).toBe(true);
    expect(ok(cardFormSchema, form({ bio: "x".repeat(CARD_LIMITS.bio + 1) }))).toBe(false);
    expect(ok(cardFormSchema, form({ headline: "x".repeat(CARD_LIMITS.headline + 1) }))).toBe(false);
    expect(ok(cardFormSchema, form({ status_line: "x".repeat(CARD_LIMITS.statusLine + 1) }))).toBe(false);
    expect(ok(cardFormSchema, form({ pronouns: "x".repeat(CARD_LIMITS.pronouns + 1) }))).toBe(false);
  });

  it("validates the handle and theme inside the form", () => {
    expect(ok(cardFormSchema, form({ handle: "admin" }))).toBe(false);
    expect(ok(cardFormSchema, { ...form(), theme: { preset: "paper", extra: true } })).toBe(false);
  });
});

/* ── Officer forms ───────────────────────────────────────────────────────── */

describe("officer reason schemas", () => {
  it("need 3–300 characters after trimming, like the database", () => {
    for (const schema of [cardHideSchema, cardHandleResetSchema]) {
      expect(ok(schema, { reason: "  ab  " })).toBe(false);
      expect(ok(schema, { reason: "spam" })).toBe(true);
      expect(ok(schema, { reason: "x".repeat(300) })).toBe(true);
      expect(ok(schema, { reason: "x".repeat(301) })).toBe(false);
    }
  });
});

describe("chapterPositionSchema", () => {
  it("allows a blank title (which clears the position) and caps the length", () => {
    expect(ok(chapterPositionSchema, { title: "" })).toBe(true);
    expect(ok(chapterPositionSchema, { title: "President" })).toBe(true);
    expect(ok(chapterPositionSchema, { title: "x".repeat(60) })).toBe(true);
    expect(ok(chapterPositionSchema, { title: "x".repeat(61) })).toBe(false);
  });

  // admin_set_chapter_position() and the chapter_positions CHECK require 2–60
  // characters for a non-blank title; the schema has to refuse what they refuse.
  it("refuses a one-character title, as the database does", () => {
    expect(ok(chapterPositionSchema, { title: "A" })).toBe(false);
    expect(ok(chapterPositionSchema, { title: "  A  " })).toBe(false);
    expect(ok(chapterPositionSchema, { title: "VP" })).toBe(true);
  });
});

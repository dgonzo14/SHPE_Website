import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicCardData } from "@/types/database";
import { buildVCard, downloadVCard, escapeVCardText, foldVCardLine, vcardFilename } from "../vcard";

// The avatar is decoded through imageUpload.loadImage, which needs a real image
// decoder; jsdom has none, so a stand-in image is returned instead.
const loadImage = vi.fn();
vi.mock("../imageUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../imageUpload")>()),
  loadImage: (blob: Blob) => loadImage(blob),
}));

vi.mock("@/services/cards", () => ({
  cardMediaUrl: (path: string | null) =>
    path ? `https://project.supabase.co/storage/v1/object/public/card-media/${path}` : null,
}));


const encoder = new TextEncoder();
const octets = (s: string) => encoder.encode(s).length;
const unfold = (s: string) => s.replace(/\r\n /g, "");

const CARD_URL = "https://washushpe.org/card/diego-gonzalez";

function card(overrides: Partial<PublicCardData> = {}): PublicCardData {
  return {
    handle: "diego-gonzalez",
    display_name: "Diego Gonzalez",
    pronouns: "he/him",
    headline: "SWE Intern @ Boeing",
    organization: "Washington University in St. Louis",
    status_line: null,
    bio: null,
    location: null,
    skills: [],
    languages: [],
    avatar_path: null,
    banner_path: null,
    background_path: null,
    theme: { preset: "shpe-classic" },
    sections: ["links"],
    allow_indexing: false,
    is_starter: false,
    education: null,
    shpe: { position: null, member_since: null, national_member_verified: false, is_alumni: false },
    links: [],
    ...overrides,
  };
}

/** Just enough of a fetch Response for the avatar download. */
function okResponse() {
  return { ok: true, blob: async () => new Blob(["img"], { type: "image/webp" }) };
}

/** Logical lines, after unfolding, without the trailing empty string. */
function lines(vcard: string): string[] {
  return unfold(vcard).split("\r\n").slice(0, -1);
}

describe("escapeVCardText", () => {
  it("escapes backslash, comma, semicolon and every newline form", () => {
    expect(escapeVCardText("a\\b")).toBe("a\\\\b");
    expect(escapeVCardText("Smith, Jr.; PhD")).toBe("Smith\\, Jr.\\; PhD");
    expect(escapeVCardText("one\ntwo\r\nthree\rfour")).toBe("one\\ntwo\\nthree\\nfour");
  });

  it("escapes backslashes first, so an escape is never double-escaped", () => {
    expect(escapeVCardText("\\,")).toBe("\\\\\\,");
    expect(escapeVCardText("\\n")).toBe("\\\\n");
  });

  it("leaves ordinary text and accents alone", () => {
    expect(escapeVCardText("José Peña · ñ 🎉")).toBe("José Peña · ñ 🎉");
  });
});

describe("foldVCardLine", () => {
  it("leaves a line of exactly 75 octets alone", () => {
    const line = "N".repeat(75);
    expect(foldVCardLine(line)).toBe(line);
  });

  it("folds at 75 octets, with continuation lines of a space plus 74", () => {
    const line = "X".repeat(75 + 74 + 10);
    const folded = foldVCardLine(line);
    const physical = folded.split("\r\n");
    expect(physical.map((l) => l.length)).toEqual([75, 75, 11]);
    expect(physical.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(unfold(folded)).toBe(line);
  });

  it("never splits a multi-byte character, whatever the offset", () => {
    for (const char of ["é", "ñ", "€", "🎉", "👩🏽‍💻"]) {
      for (let prefix = 60; prefix <= 80; prefix += 1) {
        const line = `${"a".repeat(prefix)}${char.repeat(30)}José Peña`;
        const folded = foldVCardLine(line);
        for (const physical of folded.split("\r\n")) {
          expect(octets(physical)).toBeLessThanOrEqual(75);
          // A split sequence would contain a lone surrogate or decode to U+FFFD.
          expect(new TextDecoder("utf-8", { fatal: true }).decode(encoder.encode(physical))).toBe(
            physical,
          );
          expect(physical).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
        }
        expect(unfold(folded)).toBe(line);
      }
    }
  });

  it("counts octets, not characters", () => {
    // 40 two-octet characters are 80 octets: one fold, after 37 of them.
    const folded = foldVCardLine("é".repeat(40));
    const [first, second] = folded.split("\r\n");
    expect(octets(first)).toBe(74);
    expect(second).toBe(` ${"é".repeat(3)}`);
  });

  it("returns an empty line unchanged", () => {
    expect(foldVCardLine("")).toBe("");
  });
});

describe("buildVCard", () => {
  it("is a vCard 3.0 with CRLF line endings throughout", () => {
    const vcard = buildVCard(card(), { cardUrl: CARD_URL });
    expect(vcard.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
    expect(vcard.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("splits the name into family (last word) and given (the rest)", () => {
    const out = lines(buildVCard(card({ display_name: "  María José  García " }), { cardUrl: CARD_URL }));
    expect(out).toContain("N:García;María José;;;");
    expect(out).toContain("FN:María José García");
  });

  it("puts a one-word name in the family field", () => {
    const out = lines(buildVCard(card({ display_name: "Xochitl" }), { cardUrl: CARD_URL }));
    expect(out).toContain("N:Xochitl;;;;");
  });

  it("escapes structured name parts so a comma can't shift fields", () => {
    const out = lines(buildVCard(card({ display_name: "Ana Rivera, Jr." }), { cardUrl: CARD_URL }));
    expect(out).toContain("N:Jr.;Ana Rivera\\,;;;");
  });

  it("adds WashU SHPE as the organization unit", () => {
    expect(lines(buildVCard(card(), { cardUrl: CARD_URL }))).toContain(
      "ORG:Washington University in St. Louis;WashU SHPE",
    );
    expect(lines(buildVCard(card({ organization: null }), { cardUrl: CARD_URL }))).toContain(
      "ORG:WashU SHPE",
    );
    expect(lines(buildVCard(card({ organization: "Boeing; BCA" }), { cardUrl: CARD_URL }))).toContain(
      "ORG:Boeing\\; BCA;WashU SHPE",
    );
  });

  it("uses the verified position as the title, else the headline", () => {
    const withPosition = card({
      shpe: { position: "President", member_since: null, national_member_verified: true, is_alumni: false },
    });
    expect(lines(buildVCard(withPosition, { cardUrl: CARD_URL }))).toContain("TITLE:President");
    expect(lines(buildVCard(card(), { cardUrl: CARD_URL }))).toContain("TITLE:SWE Intern @ Boeing");
    expect(
      lines(buildVCard(card({ headline: null }), { cardUrl: CARD_URL })).some((l) => l.startsWith("TITLE")),
    ).toBe(false);
  });

  it("maps each link kind to the right property, in card order", () => {
    const out = lines(
      buildVCard(
        card({
          links: [
            { id: "1", kind: "linkedin", label: null, value: "https://www.linkedin.com/in/diego", is_featured: true },
            { id: "2", kind: "email", label: null, value: "diego@example.com", is_featured: false },
            { id: "3", kind: "phone", label: "Cell", value: "+1 (314) 555-0123", is_featured: false },
            { id: "4", kind: "website", label: null, value: "https://diego.dev", is_featured: false },
            { id: "5", kind: "portfolio", label: null, value: "https://diego.dev/work", is_featured: false },
            { id: "6", kind: "github", label: null, value: "https://github.com/diego", is_featured: false },
            { id: "7", kind: "x", label: null, value: "https://x.com/diego", is_featured: false },
          ],
        }),
        { cardUrl: CARD_URL },
      ),
    );
    expect(out).toContain("X-SOCIALPROFILE;type=linkedin:https://www.linkedin.com/in/diego");
    expect(out).toContain("X-SOCIALPROFILE;type=github:https://github.com/diego");
    expect(out).toContain("X-SOCIALPROFILE;type=x:https://x.com/diego");
    expect(out).toContain("EMAIL;TYPE=INTERNET:diego@example.com");
    expect(out).toContain("TEL;TYPE=CELL:+1 (314) 555-0123");
    const urls = out.filter((l) => l.startsWith("URL:"));
    expect(urls).toEqual([
      "URL:https://diego.dev",
      "URL:https://diego.dev/work",
      `URL:${CARD_URL}`,
    ]);
  });

  it("does not escape URLs (they are URIs, not text), but neutralises backslashes", () => {
    const out = lines(
      buildVCard(
        card({
          links: [
            { id: "1", kind: "website", label: null, value: "https://a.example/x,y;z\\w", is_featured: false },
          ],
        }),
        { cardUrl: CARD_URL },
      ),
    );
    expect(out).toContain("URL:https://a.example/x,y;z%5Cw");
  });

  it("leaves out link values the database would reject", () => {
    const out = lines(
      buildVCard(
        card({
          links: [
            { id: "1", kind: "website", label: null, value: "javascript:alert(1)", is_featured: false },
            { id: "2", kind: "linkedin", label: null, value: "http://insecure.example", is_featured: false },
            { id: "3", kind: "email", label: null, value: "not-an-email", is_featured: false },
            { id: "4", kind: "phone", label: null, value: "12", is_featured: false },
          ],
        }),
        { cardUrl: CARD_URL },
      ),
    ).join("\n");
    expect(out).not.toMatch(/javascript|insecure|not-an-email|TEL|EMAIL|X-SOCIALPROFILE/);
  });

  it("ends with the 'met via' note carrying the card address", () => {
    const out = lines(buildVCard(card(), { cardUrl: CARD_URL }));
    expect(out).toContain(`NOTE:Met via WashU SHPE · ${CARD_URL}`);
    expect(out.at(-1)).toBe("END:VCARD");
  });

  it("adds a folded JPEG photo when one is given, and none otherwise", () => {
    const base64 = "QUJD".repeat(100);
    const vcard = buildVCard(card(), { cardUrl: CARD_URL, photo: { base64 } });
    expect(lines(vcard)).toContain(`PHOTO;ENCODING=b;TYPE=JPEG:${base64}`);
    for (const physical of vcard.split("\r\n")) expect(octets(physical)).toBeLessThanOrEqual(75);

    expect(buildVCard(card(), { cardUrl: CARD_URL, photo: null })).not.toContain("PHOTO");
    expect(buildVCard(card(), { cardUrl: CARD_URL, photo: { base64: "not base64!" } })).not.toContain(
      "PHOTO",
    );
  });

  it("keeps every physical line within 75 octets for a long, accented card", () => {
    const vcard = buildVCard(
      card({
        display_name: "María José García López de la Peña y Hernández-Ñúñez Ávila",
        headline: "Ingeniería mecánica · robótica · 🤖 · Investigación en sistemas autónomos y control",
        links: [
          {
            id: "1",
            kind: "website",
            label: null,
            value: `https://example.com/${"path/".repeat(30)}`,
            is_featured: false,
          },
        ],
      }),
      { cardUrl: CARD_URL },
    );
    for (const physical of vcard.split("\r\n")) expect(octets(physical)).toBeLessThanOrEqual(75);
    expect(lines(vcard)).toContain(
      "TITLE:Ingeniería mecánica · robótica · 🤖 · Investigación en sistemas autónomos y control",
    );
  });

  it("gives a starter card just the name, school, title and card link", () => {
    const starter = card({
      is_starter: true,
      headline: null,
      pronouns: null,
      shpe: { position: "Treasurer", member_since: null, national_member_verified: false, is_alumni: false },
    });
    expect(lines(buildVCard(starter, { cardUrl: CARD_URL }))).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Gonzalez;Diego;;;",
      "FN:Diego Gonzalez",
      "ORG:Washington University in St. Louis;WashU SHPE",
      "TITLE:Treasurer",
      `URL:${CARD_URL}`,
      `NOTE:Met via WashU SHPE · ${CARD_URL}`,
      "END:VCARD",
    ]);
  });
});

describe("vcardFilename", () => {
  it("slugs the display name, folding accents", () => {
    expect(vcardFilename(card())).toBe("diego-gonzalez.vcf");
    expect(vcardFilename(card({ display_name: "José Peña" }))).toBe("jose-pena.vcf");
    expect(vcardFilename(card({ display_name: "  Ana  O'Neil!! " }))).toBe("ana-o-neil.vcf");
  });

  it("falls back to the handle, then to 'contact'", () => {
    expect(vcardFilename(card({ display_name: "李小龙", handle: "bruce-lee" }))).toBe("bruce-lee.vcf");
    expect(vcardFilename(card({ display_name: "🎉", handle: "" }))).toBe("contact.vcf");
  });
});

describe("downloadVCard", () => {
  let created: Blob[];
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    created = [];
    clicked = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:vcard";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads a text/vcard file named after the member and revokes the URL later", async () => {
    await downloadVCard(card(), { cardUrl: CARD_URL });

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("diego-gonzalez.vcf");
    expect(clicked[0].isConnected).toBe(false);
    expect(created[0].type).toMatch(/^text\/vcard/);
    expect(await created[0].text()).toContain("FN:Diego Gonzalez");

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:vcard");
  });

  it("embeds the avatar, fetched through resolveMedia and re-encoded as a JPEG", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    loadImage.mockResolvedValue({ naturalWidth: 512, naturalHeight: 512, width: 512, height: 512 });
    const ctx = {
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/jpeg;base64,SlBFRw==");
    const resolveMedia = vi.fn(() => "https://cdn.example/avatar.webp");

    await downloadVCard(card({ avatar_path: "a/b.webp" }), { cardUrl: CARD_URL, resolveMedia });

    expect(resolveMedia).toHaveBeenCalledWith("a/b.webp");
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/avatar.webp", expect.any(Object));
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", expect.any(Number));
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 512, 512, 0, 0, 200, 200);
    expect(unfold(await created[0].text())).toContain("PHOTO;ENCODING=b;TYPE=JPEG:SlBFRw==");
  });

  it("still downloads, without a photo, when the avatar can't be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await downloadVCard(card({ avatar_path: "a/b.webp" }), { cardUrl: CARD_URL });
    expect(clicked).toHaveLength(1);
    expect(await created[0].text()).not.toContain("PHOTO");
  });

  it("still downloads, without a photo, when the browser can't encode a JPEG", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    loadImage.mockResolvedValue({ naturalWidth: 10, naturalHeight: 10, width: 10, height: 10 });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
    await downloadVCard(card({ avatar_path: "a/b.webp" }), { cardUrl: CARD_URL });
    expect(await created[0].text()).not.toContain("PHOTO");
  });

  it("doesn't fetch a photo for a starter card or one whose photo is hidden", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await downloadVCard(card({ avatar_path: "a/b.webp", is_starter: true }), { cardUrl: CARD_URL });
    await downloadVCard(
      card({ avatar_path: "a/b.webp", theme: { preset: "shpe-classic", avatar: { shape: "hidden" } } }),
      { cardUrl: CARD_URL },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(2);
  });

  // The Minimal layout draws no photo, so the contact gets none either. Paper
  // is stored as just { preset: "paper" }, so the layout comes from the preset.
  it.each([
    ["the Paper preset", { preset: "paper" as const }],
    ["the Minimal layout on another preset", { preset: "shpe-classic" as const, layout: "minimal" as const }],
  ])("doesn't fetch a photo for %s, which shows none", async (_name, theme) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await downloadVCard(card({ avatar_path: "a/b.webp", theme }), { cardUrl: CARD_URL });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(1);
    expect(await created[0].text()).not.toContain("PHOTO");
  });

  it("fetches the photo for Paper switched to a layout that shows one", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await downloadVCard(card({ avatar_path: "a/b.webp", theme: { preset: "paper", layout: "split" } }), {
      cardUrl: CARD_URL,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

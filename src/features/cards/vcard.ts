import { cardMediaUrl } from "@/services/cards";
import type { CardLinkKind, PublicCardData } from "@/types/database";
import { computeCropRect, imageSize, loadImage } from "./imageUpload";
import { isLinkValueValid } from "./model";
import { visiblePhotoPath } from "./photoVisibility";

/**
 * "Add to Contacts": a vCard 3.0 file built in the browser.
 *
 * 3.0 rather than 4.0 because it is the version iOS imports most reliably, and
 * an iPhone is what most people will be holding. The format details below are
 * the difference between a contact that imports cleanly and one with a name
 * split across the wrong fields or a URL cut in half:
 *
 *   - text values escape backslash, comma, semicolon and newlines;
 *   - lines end in CRLF;
 *   - lines longer than 75 octets fold onto continuation lines that start with
 *     a space, and a fold never lands inside a multi-byte UTF-8 character, so
 *     "José", "Peña" and emoji survive.
 *
 * Loaded with import() when someone taps the button, so none of this weighs on
 * the card page's first paint.
 */

const SHPE_ORG_UNIT = "WashU SHPE";

/** Rendered as X-SOCIALPROFILE, which iOS shows as a labelled social profile. */
const SOCIAL_KINDS: ReadonlySet<CardLinkKind> = new Set<CardLinkKind>([
  "linkedin",
  "github",
  "instagram",
  "x",
  "tiktok",
  "youtube",
  "handshake",
  "devpost",
  "discord",
]);

/** Contact photo size. Plenty for a contact avatar, small enough to keep the file light. */
const PHOTO_SIZE = 200;
const PHOTO_QUALITY = 0.85;
/** Someone is standing there waiting; a slow photo must not hold up the contact. */
const PHOTO_TIMEOUT_MS = 4000;

/** Firefox needs the object URL alive until the download has actually started. */
const REVOKE_DELAY_MS = 30_000;

/** RFC 2426 text escaping: backslash first, then comma, semicolon and newlines. */
export function escapeVCardText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * Folds one logical line at 75 octets: the first physical line holds up to 75
 * octets, and each continuation line is a space plus up to 74 more. Iterating
 * by code point (for…of) is what keeps a fold out of the middle of a UTF-8
 * sequence or a surrogate pair.
 */
export function foldVCardLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  let limit = 75;

  for (const char of line) {
    const size = utf8Length(char);
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
      limit = 74;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/**
 * URI values are not text in vCard 3.0, so they are not escaped: an importer
 * that treats URL as a URI would keep a "\," literally and break the link.
 * Anything with whitespace or control characters can't be a well-formed line,
 * so it is dropped; a stray backslash is percent-encoded so a text-minded
 * importer can't read it as an escape.
 */
function vcardUri(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return trimmed.replace(/\\/g, "%5C");
}

/** "Diego Alejandro Gonzalez" → family "Gonzalez", given "Diego Alejandro". */
function splitName(displayName: string): { family: string; given: string } {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { family: "", given: "" };
  return { family: words[words.length - 1], given: words.slice(0, -1).join(" ") };
}

/**
 * Builds the vCard text. Uses only what the public card shows: PublicCardData
 * carries visible links only, so a hidden link can't reach a contact, and a
 * starter card yields a contact with just the name, school and card link.
 * Link values that wouldn't pass the database's check (the editor preview can
 * hold half-typed ones) are left out rather than written as broken fields.
 */
export function buildVCard(
  card: PublicCardData,
  opts: { cardUrl: string; photo?: { base64: string } | null },
): string {
  const name = card.display_name.trim().replace(/\s+/g, " ") || card.handle;
  const { family, given } = splitName(name);
  const organization = card.organization?.trim();
  const title = card.shpe.position?.trim() || card.headline?.trim();

  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCardText(family)};${escapeVCardText(given)};;;`,
    `FN:${escapeVCardText(name)}`,
    `ORG:${organization ? `${escapeVCardText(organization)};` : ""}${SHPE_ORG_UNIT}`,
  ];
  if (title) lines.push(`TITLE:${escapeVCardText(title)}`);

  const urls: string[] = [];
  for (const link of card.links) {
    const value = link.value.trim();
    if (!isLinkValueValid(link.kind, value)) continue;

    if (link.kind === "email") {
      lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardText(value)}`);
    } else if (link.kind === "phone") {
      lines.push(`TEL;TYPE=CELL:${escapeVCardText(value)}`);
    } else {
      const uri = vcardUri(value);
      if (!uri) continue;
      if (SOCIAL_KINDS.has(link.kind)) {
        lines.push(`X-SOCIALPROFILE;type=${link.kind}:${uri}`);
      } else {
        urls.push(uri);
      }
    }
  }

  const cardUri = vcardUri(opts.cardUrl);
  if (cardUri) urls.push(cardUri);
  for (const uri of new Set(urls)) lines.push(`URL:${uri}`);

  lines.push(`NOTE:${escapeVCardText(`Met via WashU SHPE · ${opts.cardUrl.trim()}`)}`);

  const photo = opts.photo?.base64.replace(/\s+/g, "");
  if (photo && /^[A-Za-z0-9+/]+={0,2}$/.test(photo)) {
    lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${photo}`);
  }

  lines.push("END:VCARD");
  return `${lines.map(foldVCardLine).join("\r\n")}\r\n`;
}

/** "José Peña" → "jose-pena.vcf"; falls back to the handle, then "contact". */
export function vcardFilename(card: PublicCardData): string {
  const slug = card.display_name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || card.handle || "contact"}.vcf`;
}

/**
 * The card's photo as a ~200 px JPEG, base64 without the data: prefix, or null
 * on any failure. A contact without a photo is fine; a contact that never
 * arrives because the photo failed is not.
 *
 * Skipped whenever the card itself doesn't show the photo: a "No photo" shape,
 * or a layout with no photo such as Minimal (which Paper uses by default). A
 * face they chose not to show on the card shouldn't land in someone's phone.
 */
async function contactPhoto(
  card: PublicCardData,
  resolveMedia: (path: string | null) => string | null,
): Promise<{ base64: string } | null> {
  const path = visiblePhotoPath(card);
  if (!path) return null;
  const url = resolveMedia(path);
  if (!url) return null;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, { credentials: "omit", signal: controller?.signal });
    if (!response.ok) return null;
    const img = await loadImage(await response.blob());

    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const { width, height } = imageSize(img);
    const { sx, sy, sw, sh } = computeCropRect(width, height, 1, { zoom: 1, x: 0, y: 0 });
    // JPEG has no transparency: paint white first so a transparent PNG isn't black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, PHOTO_SIZE, PHOTO_SIZE);

    const dataUrl = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
    const prefix = "data:image/jpeg;base64,";
    return dataUrl.startsWith(prefix) ? { base64: dataUrl.slice(prefix.length) } : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Builds the vCard, with the photo when it can be fetched, and hands it to the
 * browser as a text/vcard download. iOS Safari and Android Chrome open their
 * "add contact" sheet for this type.
 */
export async function downloadVCard(
  card: PublicCardData,
  opts: { cardUrl: string; resolveMedia?: (p: string | null) => string | null },
): Promise<void> {
  const photo = await contactPhoto(card, opts.resolveMedia ?? cardMediaUrl);
  const text = buildVCard(card, { cardUrl: opts.cardUrl, photo });
  saveFile(new Blob([text], { type: "text/vcard;charset=utf-8" }), vcardFilename(card));
}

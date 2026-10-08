import type { ComponentType } from "react";
import { Briefcase, FileText, Globe, Link as LinkGlyph, Mail, Phone } from "lucide-react";

import { safeExternalHref } from "@/lib/url";
import {
  CARD_LINK_KINDS,
  LINK_EMAIL_PATTERN,
  LINK_URL_PATTERN,
  isLinkValueValid,
  type CardLinkKind,
} from "./model";
import {
  CalendlyIcon,
  DevpostIcon,
  DiscordIcon,
  GithubIcon,
  HandshakeIcon,
  InstagramIcon,
  LinkedinIcon,
  TiktokIcon,
  XIcon,
  YoutubeIcon,
} from "./brandIcons";

/**
 * The link catalog: for each of the sixteen kinds, how the editor asks for it
 * and how the card shows it.
 *
 * normalize() is the "smart input". It turns what people actually type into
 * what the database accepts: `diego-gonzalezz` in the LinkedIn field becomes
 * https://www.linkedin.com/in/diego-gonzalezz, `@diego` in GitHub becomes
 * https://github.com/diego, `example.com` becomes https://example.com. It only
 * ever completes something that already looks like the right shape. Anything
 * else comes back trimmed but otherwise untouched, so isLinkValueValid() (and
 * the database CHECK behind it) still rejects it. In particular a
 * `javascript:` or `data:` value is never rewritten into something that would
 * pass.
 *
 * linkHref() is the other end: the only place a stored value becomes an href.
 */

export interface LinkKindInfo {
  label: string;
  icon: ComponentType<{ className?: string }>;
  placeholder: string;
  /** One line under the field. */
  hint: string;
  inputMode: "url" | "email" | "tel" | "text";
  normalize(raw: string): string;
}

/* ── Normalising ─────────────────────────────────────────────────────────── */

/** Any scheme ("javascript:", "data:", "ftp:"), but not a host:port like "site.com:8080". */
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * A bare host with a dot and a real-looking TLD, optionally followed by a
 * port, path, query or fragment. No "@" before the path: "me@example.com" is
 * an email, and "https://me@example.com" is the credential-URL trick used to
 * dress up phishing links.
 */
const BARE_DOMAIN = /^[^\s/?#@:]+\.[^\s/?#@:.\d][^\s/?#@:.]+(?::\d{1,5})?(?:[/?#]\S*)?$/u;

/**
 * Upgrades http, completes a bare domain, and leaves everything else alone.
 * Returns null when the value doesn't look like a web address at all, so the
 * caller can try other readings first.
 */
function asWebUrl(value: string): string | null {
  if (/^https:\/\//i.test(value)) return `https://${value.slice(8)}`;
  if (/^http:\/\//i.test(value)) return `https://${value.slice(7)}`;
  if (value.startsWith("//")) return asWebUrl(value.replace(/^\/+/, ""));
  if (SCHEME.test(value)) return null;
  if (BARE_DOMAIN.test(value)) return `https://${value}`;
  return null;
}

function webNormalize(raw: string): string {
  const value = raw.trim();
  if (value === "") return "";
  return asWebUrl(value) ?? value;
}

interface SocialRule {
  /** Prefix a username is appended to. */
  profileBase: string;
  /** Hosts that mean "already a link to this site". */
  hosts: string[];
  username: RegExp;
  /** Strip this before matching a username ("in/" for LinkedIn). */
  stripPrefix?: RegExp;
}

/**
 * Social kinds accept a username or @handle as well as a link. A value naming
 * the site's own host is treated as a link; otherwise a value that fits the
 * site's username rules is completed; otherwise it's read as a web address.
 */
function socialNormalizer(rule: SocialRule) {
  return (raw: string): string => {
    const value = raw.trim();
    if (value === "") return "";
    const lower = value.toLowerCase().replace(/^https?:\/\//, "");
    if (rule.hosts.some((host) => lower === host || lower.startsWith(`${host}/`))) {
      return asWebUrl(value) ?? `https://${value}`;
    }
    if (!SCHEME.test(value)) {
      const handle = value
        .replace(/^@/, "")
        .replace(rule.stripPrefix ?? /^$/, "")
        .replace(/\/+$/, "");
      if (rule.username.test(handle)) return `${rule.profileBase}${handle}`;
    }
    return webNormalize(value);
  };
}

function hostsFor(...domains: string[]): string[] {
  return domains.flatMap((d) => [d, `www.${d}`, `m.${d}`]);
}

function normalizeEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").trim().toLowerCase();
}

/**
 * Keeps digits, spaces, + ( ) . and -; tidies runs of whitespace. A trailing
 * extension ("x12", "ext. 12") is dropped rather than letting its digits run
 * on into the number, which would dial somebody else.
 */
function normalizePhone(raw: string): string {
  return raw
    .trim()
    .replace(/^tel:/i, "")
    .replace(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i, "")
    .replace(/[^0-9+().\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Catalog ─────────────────────────────────────────────────────────────── */

const PUBLIC_NOTE = "Shown on your public card.";

export const LINK_KINDS: Record<CardLinkKind, LinkKindInfo> = {
  linkedin: {
    label: "LinkedIn",
    icon: LinkedinIcon,
    placeholder: "linkedin.com/in/your-name",
    hint: "Paste your profile link, or just type your username.",
    inputMode: "url",
    normalize: socialNormalizer({
      profileBase: "https://www.linkedin.com/in/",
      hosts: hostsFor("linkedin.com"),
      username: /^[A-Za-z0-9_-]{2,100}$/,
      stripPrefix: /^in\//i,
    }),
  },
  github: {
    label: "GitHub",
    icon: GithubIcon,
    placeholder: "github.com/username",
    hint: "Your GitHub username or profile link.",
    inputMode: "url",
    normalize: socialNormalizer({
      profileBase: "https://github.com/",
      hosts: hostsFor("github.com"),
      // GitHub's own rule: letters, digits and single inner hyphens, up to 39.
      username: /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
    }),
  },
  email: {
    label: "Email",
    icon: Mail,
    placeholder: "you@example.com",
    hint: `${PUBLIC_NOTE} Use an address you're happy for anyone to see.`,
    inputMode: "email",
    normalize: normalizeEmail,
  },
  phone: {
    label: "Phone",
    icon: Phone,
    placeholder: "+1 314 555 0123",
    hint: `${PUBLIC_NOTE} Only add a number you're comfortable sharing with strangers.`,
    inputMode: "tel",
    normalize: normalizePhone,
  },
  website: {
    label: "Website",
    icon: Globe,
    placeholder: "yourname.com",
    hint: "We'll add the https:// for you.",
    inputMode: "url",
    normalize: webNormalize,
  },
  portfolio: {
    label: "Portfolio",
    icon: Briefcase,
    placeholder: "yourname.com/work",
    hint: "Your portfolio site, Behance, Dribbble or similar.",
    inputMode: "url",
    normalize: webNormalize,
  },
  resume: {
    label: "Résumé",
    icon: FileText,
    placeholder: "drive.google.com/…",
    hint: "A link to your résumé. Make sure anyone with the link can view it.",
    inputMode: "url",
    normalize: webNormalize,
  },
  instagram: {
    label: "Instagram",
    icon: InstagramIcon,
    placeholder: "@username",
    hint: "Your Instagram username or profile link.",
    inputMode: "url",
    normalize: socialNormalizer({
      profileBase: "https://www.instagram.com/",
      hosts: [...hostsFor("instagram.com"), "instagr.am"],
      username: /^[A-Za-z0-9._]{1,30}$/,
    }),
  },
  x: {
    label: "X",
    icon: XIcon,
    placeholder: "@username",
    hint: "Your X (Twitter) username or profile link.",
    inputMode: "url",
    normalize: socialNormalizer({
      profileBase: "https://x.com/",
      hosts: [...hostsFor("x.com"), ...hostsFor("twitter.com")],
      username: /^[A-Za-z0-9_]{1,15}$/,
    }),
  },
  tiktok: {
    label: "TikTok",
    icon: TiktokIcon,
    placeholder: "@username",
    hint: "Your TikTok username or profile link.",
    inputMode: "url",
    normalize: socialNormalizer({
      profileBase: "https://www.tiktok.com/@",
      hosts: [...hostsFor("tiktok.com"), "vm.tiktok.com"],
      username: /^[A-Za-z0-9._]{2,24}$/,
    }),
  },
  youtube: {
    label: "YouTube",
    icon: YoutubeIcon,
    placeholder: "@channel",
    hint: "Your channel's @handle or link.",
    inputMode: "url",
    normalize: socialNormalizer({
      profileBase: "https://www.youtube.com/@",
      hosts: [...hostsFor("youtube.com"), "youtu.be"],
      username: /^[A-Za-z0-9._-]{3,30}$/,
    }),
  },
  handshake: {
    label: "Handshake",
    icon: HandshakeIcon,
    placeholder: "app.joinhandshake.com/profiles/…",
    hint: "Your Handshake profile link.",
    inputMode: "url",
    normalize: webNormalize,
  },
  devpost: {
    label: "Devpost",
    icon: DevpostIcon,
    placeholder: "devpost.com/username",
    hint: "Your Devpost username or profile link.",
    inputMode: "url",
    normalize: socialNormalizer({
      profileBase: "https://devpost.com/",
      hosts: hostsFor("devpost.com"),
      username: /^[A-Za-z0-9_-]{2,60}$/,
    }),
  },
  calendly: {
    label: "Calendly",
    icon: CalendlyIcon,
    placeholder: "calendly.com/your-name",
    hint: "Your booking link, for coffee chats.",
    inputMode: "url",
    normalize: socialNormalizer({
      profileBase: "https://calendly.com/",
      hosts: hostsFor("calendly.com"),
      username: /^[A-Za-z0-9_-]{2,60}$/,
    }),
  },
  discord: {
    label: "Discord",
    icon: DiscordIcon,
    placeholder: "discord.gg/invite",
    hint: "A server invite or your profile link (discord.com/users/…). A username alone can't be linked.",
    inputMode: "url",
    normalize: webNormalize,
  },
  custom: {
    label: "Link",
    icon: LinkGlyph,
    placeholder: "https://…",
    hint: "Any https link. Give it a label so people know where it goes.",
    inputMode: "url",
    normalize: webNormalize,
  },
};

function isKnownKind(kind: unknown): kind is CardLinkKind {
  return typeof kind === "string" && (CARD_LINK_KINDS as readonly string[]).includes(kind);
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

/**
 * Characters that would turn a mailto: into more than an address: a query
 * (?cc=, ?body=), a fragment, or percent-escapes that smuggle in headers.
 * Apostrophes and the like are legal in addresses and harmless here.
 */
const MAILTO_UNSAFE = /[?#&%\\<>"\s]/;

/**
 * The href for a stored link, or undefined when it shouldn't be a link at all.
 * Defence in depth: the database CHECK already holds these shapes, but the
 * renderer doesn't rely on that.
 *
 *   email   mailto: for a plain address only (no ?cc= or other extras)
 *   phone   tel: with the digits and a leading + only
 *   others  https only, through safeExternalHref
 */
export function linkHref(kind: CardLinkKind, value: string): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  if (v === "") return undefined;

  if (kind === "email") {
    if (!LINK_EMAIL_PATTERN.test(v) || MAILTO_UNSAFE.test(v)) return undefined;
    return safeExternalHref(`mailto:${v}`);
  }
  if (kind === "phone") {
    if (!isLinkValueValid("phone", v)) return undefined;
    return `tel:${v.startsWith("+") ? "+" : ""}${v.replace(/\D/g, "")}`;
  }
  if (!LINK_URL_PATTERN.test(v)) return undefined;
  const href = safeExternalHref(v);
  return href && /^https:\/\//i.test(href) ? href : undefined;
}

/** True for links that leave the site (everything but mailto: and tel:). */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/** The member's own label, or the kind's name ("LinkedIn") when they didn't set one. */
export function linkDisplayLabel(link: { kind: CardLinkKind; label: string | null }): string {
  const own = typeof link.label === "string" ? link.label.trim() : "";
  if (own) return own;
  return isKnownKind(link.kind) ? LINK_KINDS[link.kind].label : LINK_KINDS.custom.label;
}

/** The kind's icon, or a plain link icon for anything unrecognised. */
export function linkIcon(kind: CardLinkKind): ComponentType<{ className?: string }> {
  return isKnownKind(kind) ? LINK_KINDS[kind].icon : LINK_KINDS.custom.icon;
}

/** A path segment this long is an id (a Drive file, a share token), not a name. */
const LONG_SEGMENT = 20;

/**
 * The second line of a link row: where the link goes, in the words a person
 * would say it. The address for email, the number for phone, and for a web
 * link the host and path without the scheme or "www." -- linkedin.com/in/ana,
 * github.com/ana -- or just the host when the path is an opaque id, so a
 * résumé on Drive reads "drive.google.com" rather than a string of noise.
 * Query strings and fragments never show. null when there's nothing useful to
 * say. Plain text: the card renders it as text, never as markup.
 */
export function linkDetail(link: { kind: CardLinkKind; value: string }): string | null {
  const value = typeof link.value === "string" ? link.value.trim() : "";
  if (value === "") return null;
  if (link.kind === "email" || link.kind === "phone") return value;

  const match = /^https?:\/\/([^/?#\s]+)([^?#\s]*)/i.exec(value);
  if (!match) return null;
  const host = match[1].toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  const segments = match[2].split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 3 || segments.some((s) => s.length > LONG_SEGMENT)) {
    return host;
  }
  return `${host}/${segments.join("/")}`;
}

/**
 * The groups the "grouped" arrangement sorts links into, in display order:
 * things the member made, ways to reach them professionally, and everything
 * social. A custom link is usually a project, so it counts as work.
 */
export const LINK_GROUPS = [
  { id: "work", title: "Work" },
  { id: "professional", title: "Professional" },
  { id: "social", title: "Social" },
] as const;
export type LinkGroupId = (typeof LINK_GROUPS)[number]["id"];

const LINK_GROUP_OF: Record<CardLinkKind, LinkGroupId> = {
  portfolio: "work",
  website: "work",
  github: "work",
  devpost: "work",
  resume: "work",
  youtube: "work",
  custom: "work",
  linkedin: "professional",
  email: "professional",
  phone: "professional",
  calendly: "professional",
  handshake: "professional",
  instagram: "social",
  x: "social",
  tiktok: "social",
  discord: "social",
};

export function linkGroup(kind: CardLinkKind): LinkGroupId {
  return isKnownKind(kind) ? LINK_GROUP_OF[kind] : "work";
}

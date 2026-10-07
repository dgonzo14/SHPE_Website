import type { BadgeTone } from "@/components/ui/primitives";
import { cardUrl } from "@/services/cards";
import { memberName } from "@/services/members";
import { toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/datetime";
import type { AdminCardRow, CardAdminStatus, MembershipStatus } from "@/types/database";

/**
 * The officer's view of the roster as cards: what each row's status means in
 * words, which rows a filter keeps, and the programming sheet for card-writing
 * night.
 *
 * Kept out of the components so the rules can be tested without rendering a
 * table, and so the badge on the page and the "Status" column in the CSV can
 * never describe the same card differently.
 */

/** A row whose member has a card, which is the only kind a chip can be written for. */
export type RowWithCard = AdminCardRow & { handle: string };

export function hasCard(row: AdminCardRow): row is RowWithCard {
  return row.handle !== null;
}

/**
 * An officer made the card and the member has never saved or published it
 * themselves. Read from the two underlying fields rather than from `status`,
 * because a published starter card's status is "published" and it is still
 * unopened.
 */
export function isUnopenedOfficerCard(row: AdminCardRow): boolean {
  return hasCard(row) && row.created_by_officer && row.member_opened_at === null;
}

/**
 * The chip was written with a handle the member has since changed. A renamed
 * handle keeps redirecting, so the chip still works -- unless chipIsDead().
 */
export function chipCarriesOldHandle(row: AdminCardRow): boolean {
  return row.chip_handle !== null && row.handle !== null && row.chip_handle !== row.handle;
}

/**
 * The chip's handle is no longer the member's: an officer reset or released
 * it, which takes the handle away rather than leaving a redirect. A tap opens
 * "card not available", or, once another member has claimed that handle, their
 * card. Either way the chip needs rewriting. The database says so directly
 * (chip_handle_active), so this never has to be guessed from the handles.
 */
export function chipIsDead(row: AdminCardRow): boolean {
  return row.chip_handle !== null && row.chip_handle_active === false;
}

/** Matches get_public_card()'s rule for whose cards resolve at all. */
const VISIBLE_MEMBERSHIP: readonly MembershipStatus[] = ["active", "alumni", "inactive"];

/**
 * Whether opening the card's address right now shows the card. Published is not
 * enough: the feature switch and a suspended membership both turn a published
 * card into "not available", and a link to that would only confuse.
 */
export function isCardLive(row: AdminCardRow, cardsEnabled: boolean): boolean {
  return (
    cardsEnabled &&
    hasCard(row) &&
    row.status === "published" &&
    VISIBLE_MEMBERSHIP.includes(row.membership_status)
  );
}

/* ── Status ──────────────────────────────────────────────────────────────── */

export interface StatusBadge {
  label: string;
  tone: BadgeTone;
}

const STATUS_BADGES: Record<CardAdminStatus, StatusBadge> = {
  none: { label: "No card", tone: "neutral" },
  hidden: { label: "Hidden", tone: "danger" },
  published: { label: "Published", tone: "success" },
  officer_unopened: { label: "Set up by officer, not opened", tone: "warning" },
  member: { label: "Member set up", tone: "info" },
};

/**
 * One badge per fact. A published starter card gets two, "Published" and "Set
 * up by officer, not opened", because both are true and an officer deciding
 * whether to nudge the member needs the second.
 */
export function cardStatusBadges(row: AdminCardRow): StatusBadge[] {
  const primary = STATUS_BADGES[row.status] ?? { label: String(row.status), tone: "neutral" };
  if (row.status === "published" && isUnopenedOfficerCard(row)) {
    return [primary, STATUS_BADGES.officer_unopened];
  }
  return [primary];
}

/** The same badges as one string, for the CSV. */
export function cardStatusText(row: AdminCardRow): string {
  return cardStatusBadges(row)
    .map((badge) => badge.label)
    .join("; ");
}

/* ── Search and filters ──────────────────────────────────────────────────── */

export type CardFilter = "all" | "no_card" | "no_chip" | "chip_dead" | "hidden";

export const CARD_FILTERS: { value: CardFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "no_card", label: "No card" },
  { value: "no_chip", label: "Card, but no chip yet" },
  { value: "chip_dead", label: "Chip needs rewriting" },
  { value: "hidden", label: "Hidden" },
];

/**
 * The handle the database falls back to when a name has no letters a web
 * address can spell (王芳, Иван): "member-" and six hex characters derived from
 * the member id. Worth recognising, because to an officer it looks like a bug.
 */
const FALLBACK_HANDLE = /^member-[0-9a-f]{6}$/;

export function isFallbackHandle(handle: string | null | undefined): boolean {
  return Boolean(handle && FALLBACK_HANDLE.test(handle));
}

/** Lowercase without accents, so "jose" finds "José" and "pena" finds "Peña". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Every word typed has to appear somewhere in the name, email or handles, so
 * "ana riv" and "rivera ana" both find Ana Rivera. Old handles count: a report
 * that someone is squatting /card/rosa-rios names that handle, not whoever
 * holds it.
 */
export function matchesSearch(row: AdminCardRow, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(
    [
      row.first_name,
      row.last_name,
      row.email,
      row.handle ?? "",
      row.chip_handle ?? "",
      ...(row.old_handles ?? []),
    ].join(" "),
  );
  return words.every((word) => haystack.includes(word));
}

/**
 * "No chip yet" means a card with no chip recorded. A member without a card
 * needs one before a chip can point anywhere, which is what "No card" is for.
 */
export function matchesFilter(row: AdminCardRow, filter: CardFilter): boolean {
  switch (filter) {
    case "no_card":
      return !hasCard(row);
    case "no_chip":
      return hasCard(row) && row.chip_written_at === null;
    case "chip_dead":
      return hasCard(row) && chipIsDead(row);
    case "hidden":
      return row.status === "hidden";
    default:
      return true;
  }
}

export function filterCardRows(
  rows: readonly AdminCardRow[],
  { search, filter }: { search: string; filter: CardFilter },
): AdminCardRow[] {
  return rows.filter((row) => matchesFilter(row, filter) && matchesSearch(row, search));
}

/* ── NFC programming sheet ───────────────────────────────────────────────── */

function chipWrittenText(row: RowWithCard): string {
  if (!row.chip_written_at) return "Not yet";
  const date = formatDate(row.chip_written_at);
  if (chipIsDead(row)) return `${date}, as ${row.chip_handle} (no longer theirs: rewrite it)`;
  return chipCarriesOldHandle(row) ? `${date}, as ${row.chip_handle} (redirects)` : date;
}

/**
 * The sheet officers program chips from. "Chip URL" is exactly what goes on
 * the chip: cardUrl() with ?src=nfc, from the same function the rest of the app
 * uses, so the sheet and the site can't disagree about the address.
 */
export function programmingSheetCsv(rows: readonly RowWithCard[]): string {
  return toCsv(rows, [
    { header: "Name", value: (row) => memberName(row) },
    { header: "Email", value: (row) => row.email },
    { header: "Handle", value: (row) => row.handle },
    { header: "Chip URL", value: (row) => cardUrl(row.handle, "nfc") },
    { header: "Card status", value: (row) => cardStatusText(row) },
    { header: "Chip written", value: (row) => chipWrittenText(row) },
  ]);
}

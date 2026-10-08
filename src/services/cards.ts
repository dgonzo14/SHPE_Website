import { getSupabase } from "@/lib/supabase";
import { SUPABASE_URL, absoluteAppUrl } from "@/lib/config";
import {
  CARD_MEDIA_BUCKET,
  CARD_MEDIA_PATH_PATTERN,
  type CardEvent,
  type CardSource,
} from "@/features/cards/model";
import type {
  AdminCardsResponse,
  AdminCreateCardResult,
  BulkCreateCardsResult,
  CardInsights,
  CardLinkInput,
  HandleAvailability,
  MarkChipsWrittenResult,
  MemberCardInput,
  MyCardResponse,
  MyCardState,
  PublicCardResponse,
  ReleaseCardHandleResult,
} from "@/types/database";

/**
 * Member business cards.
 *
 * Thin wrappers over RPCs, like every other service. The rules live in the
 * database: the card tables have no grants to any client role, so these
 * functions are the only way in, and each one re-checks who is calling.
 * get_public_card() decides what a stranger may see; save_my_card() validates
 * every field again however the request was built.
 */

/* ── Public ──────────────────────────────────────────────────────────────── */

/** Anyone, signed in or not. See PublicCardResponse for the three outcomes. */
export async function fetchPublicCard(handle: string): Promise<PublicCardResponse> {
  const { data, error } = await getSupabase().rpc("get_public_card", { p_handle: handle });
  if (error) throw error;
  return data as PublicCardResponse;
}

/**
 * Counts a view, contact save, share or link click. Fire-and-forget: a failed
 * count must never get in the way of the person standing there with the card,
 * so errors are swallowed. The database ignores unknown handles, owners viewing
 * their own card, and links that are not on the card.
 */
export async function recordCardEvent(
  handle: string,
  event: CardEvent,
  source: CardSource,
  linkId?: string,
): Promise<void> {
  try {
    await getSupabase().rpc("record_card_event", {
      p_handle: handle,
      p_event: event,
      p_source: source,
      p_link_id: linkId ?? null,
    });
  } catch {
    // Deliberately silent; see above.
  }
}

/* ── My Card ─────────────────────────────────────────────────────────────── */

export async function fetchMyCard(): Promise<MyCardResponse> {
  const { data, error } = await getSupabase().rpc("get_my_card");
  if (error) throw error;
  return data as MyCardResponse;
}

/** A switched-off response has no `profile`; this tells the two apart. */
export function isMyCardState(response: MyCardResponse | undefined): response is MyCardState {
  return Boolean(response && "profile" in response && response.profile);
}

/** The pre-fill for a member who has no card yet, e.g. "diego-gonzalez". */
export async function suggestMyCardHandle(): Promise<string | null> {
  const { data, error } = await getSupabase().rpc("suggest_my_card_handle");
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function checkCardHandle(handle: string): Promise<HandleAvailability> {
  const { data, error } = await getSupabase().rpc("check_card_handle", { p_handle: handle });
  if (error) throw error;
  return data as HandleAvailability;
}

/**
 * Creates or updates the caller's card and replaces its links in one
 * transaction. Returns the card as stored, which is what the editor should
 * reset its form to.
 */
export async function saveMyCard(
  card: MemberCardInput,
  links: CardLinkInput[],
): Promise<MyCardState> {
  const { data, error } = await getSupabase().rpc("save_my_card", {
    p_card: card,
    p_links: links,
  });
  if (error) throw error;
  return data as MyCardState;
}

export async function setMyCardPublished(published: boolean): Promise<MyCardState> {
  const { data, error } = await getSupabase().rpc("set_my_card_published", {
    p_published: published,
  });
  if (error) throw error;
  return data as MyCardState;
}

export async function fetchMyCardInsights(days: number): Promise<CardInsights> {
  const { data, error } = await getSupabase().rpc("get_my_card_insights", { p_days: days });
  if (error) throw error;
  return data as CardInsights;
}

/* ── Media ───────────────────────────────────────────────────────────────── */

/**
 * Uploads an already-resized image into the caller's own folder and returns
 * its storage path. Storage policies refuse any folder but the caller's, and
 * the bucket refuses anything over 2 MB or not an image.
 */
export async function uploadCardImage(memberId: string, blob: Blob): Promise<string> {
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
  const path = `${memberId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await getSupabase()
    .storage.from(CARD_MEDIA_BUCKET)
    .upload(path, blob, { contentType: blob.type || "image/webp", upsert: false });
  if (error) throw error;
  return path;
}

/**
 * Removes every card image a deleted member left in the bucket. Admin only, by
 * storage policy: call it after admin_delete_member succeeds. Best-effort and
 * never throws -- the member is already gone, and a leftover photo is cleaned
 * up the next time someone runs this for them.
 */
export async function removeMemberCardMedia(memberId: string): Promise<void> {
  try {
    const bucket = getSupabase().storage.from(CARD_MEDIA_BUCKET);
    const { data } = await bucket.list(memberId, { limit: 1000 });
    const paths = (data ?? [])
      .map((file) => `${memberId}/${file.name}`)
      .filter((path) => CARD_MEDIA_PATH_PATTERN.test(path));
    if (paths.length > 0) await bucket.remove(paths);
  } catch {
    // See above: never fail the caller over cleanup.
  }
}

/**
 * How old an unused image must be before pruneCardMedia() deletes it. A week,
 * not a day: an upload can sit unsaved in an editor left open on a laptop
 * while the member opens My Card on their phone, and deleting it under that
 * tab would leave its next save pointing at a missing file.
 */
export const ORPHAN_MEDIA_MIN_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Deletes images in the member's own folder that the saved card doesn't use.
 *
 * The editor cleans up replaced images on Save and Discard, but an upload made
 * in a session that was simply closed is never referenced by anything, and the
 * bucket's 30-file-per-member cap counts it. Without this, a member who tried a
 * few photos over a semester could end up unable to upload at all.
 *
 * Only files older than `minAgeMs` go, so an upload sitting unsaved in another
 * open tab survives. Storage policies limit a member to their own folder.
 * Best-effort: returns how many were removed and never throws.
 */
export async function pruneCardMedia(
  memberId: string,
  keep: (string | null | undefined)[],
  { minAgeMs = ORPHAN_MEDIA_MIN_AGE_MS, now = Date.now() }: { minAgeMs?: number; now?: number } = {},
): Promise<number> {
  try {
    const bucket = getSupabase().storage.from(CARD_MEDIA_BUCKET);
    const { data, error } = await bucket.list(memberId, { limit: 1000 });
    if (error || !data) return 0;
    const kept = new Set(keep.filter(Boolean));
    const stale = data
      .filter((file) => {
        const path = `${memberId}/${file.name}`;
        if (!CARD_MEDIA_PATH_PATTERN.test(path) || kept.has(path)) return false;
        const created = Date.parse(file.created_at ?? "");
        // No timestamp means no proof it's old enough; leave it.
        return Number.isFinite(created) && now - created >= minAgeMs;
      })
      .map((file) => `${memberId}/${file.name}`);
    if (stale.length === 0) return 0;
    const { error: removeError } = await bucket.remove(stale);
    return removeError ? 0 : stale.length;
  } catch {
    return 0;
  }
}

/** Best-effort cleanup of images a save has replaced. Never throws. */
export async function removeCardImages(paths: (string | null | undefined)[]): Promise<void> {
  const valid = paths.filter((p): p is string => Boolean(p && CARD_MEDIA_PATH_PATTERN.test(p)));
  if (valid.length === 0) return;
  try {
    await getSupabase().storage.from(CARD_MEDIA_BUCKET).remove(valid);
  } catch {
    // An orphaned image costs a few KB; failing a save over it would be worse.
  }
}

/**
 * Public URL for a stored card image, or null for anything that is not a
 * well-formed card-media path. Cards store paths rather than URLs so a card
 * can only ever load images from this project's own bucket.
 */
export function cardMediaUrl(path: string | null | undefined): string | null {
  if (!path || !CARD_MEDIA_PATH_PATTERN.test(path) || !SUPABASE_URL) return null;
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${CARD_MEDIA_BUCKET}/${path}`;
}

/* ── URLs ────────────────────────────────────────────────────────────────── */

/**
 * The public address of a card. `source` tags how the visit arrived: chips are
 * written with ?src=nfc and generated QR codes carry ?src=qr; a plain link
 * counts as shared.
 *
 * The origin comes from VITE_SITE_URL when set, so a programming sheet exported
 * from a preview deploy still produces production URLs, provided that variable
 * is set there.
 */
export function cardUrl(handle: string, source?: CardSource): string {
  const base = absoluteAppUrl(`/card/${encodeURIComponent(handle)}`);
  return source && source !== "link" ? `${base}?src=${source}` : base;
}

/* ── Officer tools (every one audited server-side) ───────────────────────── */

export async function fetchAdminCards(): Promise<AdminCardsResponse> {
  const { data, error } = await getSupabase().rpc("admin_list_cards");
  if (error) throw error;
  return data as AdminCardsResponse;
}

export async function adminSuggestCardHandle(memberId: string): Promise<string | null> {
  const { data, error } = await getSupabase().rpc("admin_suggest_card_handle", {
    p_member_id: memberId,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Creates a card for a member who has not opened My Card: name and school only.
 * `handle` overrides the suggestion; `publish` makes it a live starter card.
 */
export async function adminCreateCard(
  memberId: string,
  { handle, publish = false }: { handle?: string | null; publish?: boolean } = {},
): Promise<AdminCreateCardResult> {
  const { data, error } = await getSupabase().rpc("admin_create_card", {
    p_member_id: memberId,
    p_handle: handle ?? null,
    p_publish: publish,
  });
  if (error) throw error;
  return data as AdminCreateCardResult;
}

/** With `dryRun` (the default) nothing is written: it returns the preview. */
export async function adminCreateMissingCards({
  publish = false,
  dryRun = true,
}: { publish?: boolean; dryRun?: boolean } = {}): Promise<BulkCreateCardsResult> {
  const { data, error } = await getSupabase().rpc("admin_create_missing_cards", {
    p_publish: publish,
    p_dry_run: dryRun,
  });
  if (error) throw error;
  return data as BulkCreateCardsResult;
}

/**
 * Records which handle each member's chip carries. Pass `handles` (same order as
 * `memberIds`) with the handles the officer actually exported and wrote, so a
 * member renaming in between can't make the record claim a handle that was
 * never on the chip. Members who no longer hold that handle come back in
 * `skipped`.
 */
export async function adminMarkChipsWritten(
  memberIds: string[],
  handles?: string[],
): Promise<MarkChipsWrittenResult> {
  const { data, error } = await getSupabase().rpc("admin_mark_chips_written", {
    p_member_ids: memberIds,
    p_handles: handles ?? null,
  });
  if (error) throw error;
  return data as MarkChipsWrittenResult;
}

/**
 * Takes one handle away from a member -- current or old -- so it stops
 * redirecting to them and becomes claimable by anyone else, but never by them
 * again. Releasing the current handle moves the card to a newly suggested one.
 * Reason required; audited.
 */
export async function adminReleaseCardHandle(
  memberId: string,
  handle: string,
  reason: string,
): Promise<ReleaseCardHandleResult> {
  const { data, error } = await getSupabase().rpc("admin_release_card_handle", {
    p_member_id: memberId,
    p_handle: handle,
    p_reason: reason,
  });
  if (error) throw error;
  return data as ReleaseCardHandleResult;
}

export async function adminSetCardHidden(
  memberId: string,
  hidden: boolean,
  reason?: string | null,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_card_hidden", {
    p_member_id: memberId,
    p_hidden: hidden,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function adminResetCardHandle(
  memberId: string,
  reason: string,
): Promise<{ old_handle: string; handle: string }> {
  const { data, error } = await getSupabase().rpc("admin_reset_card_handle", {
    p_member_id: memberId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { old_handle: string; handle: string };
}

/** A blank or null title clears the position. */
export async function adminSetChapterPosition(
  memberId: string,
  title: string | null,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_chapter_position", {
    p_member_id: memberId,
    p_title: title,
  });
  if (error) throw error;
}

export async function adminSetCardsEnabled(enabled: boolean): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_cards_enabled", { p_enabled: enabled });
  if (error) throw error;
}

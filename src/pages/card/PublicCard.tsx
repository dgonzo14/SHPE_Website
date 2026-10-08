import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import type { PublicCardData, PublicCardLink } from "@/types/database";
import { BusinessCard } from "@/features/cards/BusinessCard";
import { isHandleShapeValid, normalizeHandleInput, parseCardSource } from "@/features/cards/model";
import { shareCard } from "@/features/cards/share";
import { resolveTheme } from "@/features/cards/themes";
import {
  PublicCardNotFound,
  PublicCardSkeleton,
  PublicCardUnavailable,
} from "@/features/cards/public/PublicCardStates";
import {
  cardMetaDescription,
  cardPageColor,
  cardPageTitle,
  classifyPublicCardResponse,
  claimCardView,
  loadVCardModule,
  prefetchVCardWhenIdle,
  publicCardRetryDelay,
  searchWithoutSource,
  shouldRetryPublicCard,
  SITE_NAME,
  type PublicCardOutcome,
} from "@/features/cards/public/publicCardPage";
import {
  useCanonicalLink,
  useMetaTag,
  usePageBackground,
} from "@/features/cards/public/useDocumentHead";
import { useToast } from "@/components/ui/useToast";
import { usePageMeta } from "@/hooks/usePageMeta";
import { isSupabaseConfigured } from "@/lib/config";
import { cardMediaUrl, cardUrl, fetchPublicCard, recordCardEvent } from "@/services/cards";
import { queryKeys } from "@/services/queryKeys";

/** Behind the skeleton and the notices, so the page never flashes white around them. */
const SKELETON_PAGE_COLOR = "#f3f4f6"; // gray-100
const NOTICE_PAGE_COLOR = "#e8ecf2"; // shpe-navy-soft

/** What the page is showing, worked out once per render. */
type View =
  | PublicCardOutcome
  | { kind: "loading" }
  | { kind: "error" }
  /** This build has no Supabase settings, so no card can ever load. */
  | { kind: "unconfigured" };

/**
 * /card/:handle — the page an NFC tap, a QR scan or a shared link opens.
 *
 * Full screen, no site navbar (the route sits outside PublicLayout), the card
 * centred on its own background. Someone is standing in front of the member
 * waiting for this to load, so it stays light: the vCard builder loads on
 * demand, nothing from the editor or the form libraries is reachable from
 * here, and the only backend call on the way in is get_public_card().
 *
 * The address bar is tidied as the page settles:
 *   - /card/Diego becomes /card/diego (handles are lowercase);
 *   - an old handle becomes the member's current one, keeping the query
 *     string, so a chip written before a rename still lands, still tagged;
 *   - once the visit is counted, ?src= comes off, so an address copied out of
 *     the browser counts as a shared link rather than another tap.
 *
 * Counting (record_card_event) is fire-and-forget and never in the way: a
 * view once per card per 30 minutes in a browser (see claimCardView), plus
 * contact saves, shares and link clicks, each tagged with how this visit
 * arrived.
 */
export function PublicCard() {
  const { handle: rawHandle = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const handle = normalizeHandleInput(rawHandle);
  const handleValid = isHandleShapeValid(handle);

  // How this visit arrived, read once. ?src= is stripped from the address bar
  // after the view is counted, and saves, shares and clicks later in the
  // visit should still be credited to the chip or QR code that brought it.
  // The component stays mounted through the redirects below, so an old
  // handle's ?src= survives them too.
  const [source] = useState(() => parseCardSource(new URLSearchParams(location.search).get("src")));

  // Kept as the title while loading. The card-meta edge function has usually
  // already written "Diego Gonzalez | WashU SHPE" into the page, and swapping
  // it for something generic until the card arrives would make the tab flicker.
  const [arrivalTitle] = useState(() => document.title || SITE_NAME);

  const query = useQuery({
    queryKey: queryKeys.cards.publicCard(handle),
    queryFn: () => fetchPublicCard(handle),
    // A handle that can't exist is not_found without a round trip. The
    // database normalises and checks shape the same way, so skipping the call
    // changes nothing but the wait.
    enabled: isSupabaseConfigured && handleValid,
    retry: shouldRetryPublicCard,
    retryDelay: (failureCount) => publicCardRetryDelay(failureCount),
    // A card changes when its owner saves, not while a visitor reads it.
    staleTime: 5 * 60_000,
  });

  let view: View;
  if (!isSupabaseConfigured) view = { kind: "unconfigured" };
  else if (!handleValid) view = { kind: "not_found" };
  else if (query.data !== undefined) view = classifyPublicCardResponse(query.data, handle);
  else if (query.isError) view = { kind: "error" };
  else view = { kind: "loading" };

  const card: PublicCardData | null = view.kind === "ok" ? view.card : null;
  const redirectTo = view.kind === "redirect" ? view.handle : null;
  const cardHandle = card?.handle ?? null;

  /* ── Address bar ───────────────────────────────────────────────────────── */

  const needsLowercasePath = handleValid && handle !== rawHandle;
  useEffect(() => {
    if (!needsLowercasePath) return;
    navigate(
      { pathname: `/card/${encodeURIComponent(handle)}`, search: location.search, hash: location.hash },
      { replace: true },
    );
  }, [needsLowercasePath, handle, location.search, location.hash, navigate]);

  useEffect(() => {
    if (!redirectTo) return;
    navigate(
      { pathname: `/card/${encodeURIComponent(redirectTo)}`, search: location.search, hash: location.hash },
      { replace: true },
    );
  }, [redirectTo, location.search, location.hash, navigate]);

  // Through the router rather than a bare history.replaceState (it still ends
  // in one), so the router's idea of the URL matches the address bar. Waits
  // for the lowercase fix above, which a cached card can arrive alongside, so
  // the two replacements don't undo each other.
  const strippedSearch =
    cardHandle && !needsLowercasePath ? searchWithoutSource(location.search) : location.search;
  useEffect(() => {
    if (strippedSearch === location.search) return;
    navigate(
      { pathname: location.pathname, search: strippedSearch, hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [strippedSearch, location.pathname, location.search, location.hash, location.state, navigate]);

  /* ── Counting ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!cardHandle) return;
    if (claimCardView(cardHandle)) void recordCardEvent(cardHandle, "view", source);
  }, [cardHandle, source]);

  // Have the vCard code on hand before anyone reaches for "Add to Contacts".
  useEffect(() => (cardHandle ? prefetchVCardWhenIdle() : undefined), [cardHandle]);

  /* ── <head> and the page behind the card ───────────────────────────────── */

  const theme = useMemo(() => (card ? resolveTheme(card.theme) : null), [card]);
  const pageColor = useMemo(() => {
    if (!card || !theme) {
      return view.kind === "loading" || view.kind === "redirect" ? SKELETON_PAGE_COLOR : NOTICE_PAGE_COLOR;
    }
    const hasImage =
      theme.background.type === "image" && !card.is_starter && cardMediaUrl(card.background_path) !== null;
    return cardPageColor(theme, hasImage);
  }, [card, theme, view.kind]);

  usePageMeta({
    title: card
      ? cardPageTitle(card.display_name)
      : view.kind === "not_found"
        ? `Card not available | ${SITE_NAME}`
        : view.kind === "error" || view.kind === "unconfigured" || view.kind === "invalid"
          ? `Card temporarily unavailable | ${SITE_NAME}`
          : arrivalTitle,
    // Search engines are opt-in per card: a student's phone number showing up
    // in Google is a bad default. Everything that isn't a live, opted-in card
    // is noindex too, so a not-found page can never be indexed under a handle.
    noindex: !card?.allow_indexing,
  });
  useMetaTag("description", card ? cardMetaDescription(card) : null);
  useMetaTag("theme-color", pageColor);
  // Folds ?src=, old handles and capitalisation into one search result. Only
  // for cards that asked to be found; the rest are noindex anyway.
  useCanonicalLink(card?.allow_indexing ? cardUrl(card.handle) : null);
  usePageBackground(pageColor);

  /* ── Actions ───────────────────────────────────────────────────────────── */

  const savingRef = useRef(false);
  const sharingRef = useRef(false);

  async function handleAddToContacts() {
    if (!card || savingRef.current) return;
    savingRef.current = true;
    try {
      const { downloadVCard } = await loadVCardModule();
      await downloadVCard(card, { cardUrl: cardUrl(card.handle) });
      void recordCardEvent(card.handle, "save", source);
    } catch {
      toast.error("Couldn't create the contact", "Check your connection, then try again.");
    } finally {
      savingRef.current = false;
    }
  }

  async function handleShare() {
    if (!card || sharingRef.current) return;
    sharingRef.current = true;
    // No ?src=: whoever opens a shared link arrived by "link".
    const url = cardUrl(card.handle);
    try {
      // share.ts is imported up front, not lazily: iOS only opens the share
      // sheet while the tap that asked for it is still fresh, and waiting on
      // a chunk first can use that up.
      const result = await shareCard({ url, title: cardPageTitle(card.display_name) });
      if (result === "shared" || result === "copied") void recordCardEvent(card.handle, "share", source);
      if (result === "copied") toast.success("Link copied", "Paste it anywhere to share this card.");
      if (result === "failed") toast.error("Couldn't share this card", `Copy this address instead: ${url}`);
    } finally {
      sharingRef.current = false;
    }
  }

  function handleLinkClick(link: PublicCardLink) {
    // Fire-and-forget: the link opens whether or not the count lands.
    if (card) void recordCardEvent(card.handle, "link_click", source, link.id);
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  switch (view.kind) {
    case "ok":
      return (
        <main className="flex min-h-dvh w-full flex-col">
          <BusinessCard
            card={view.card}
            mode="public"
            onAddToContacts={handleAddToContacts}
            onShare={handleShare}
            onLinkClick={handleLinkClick}
            className="min-h-dvh flex-1"
          />
        </main>
      );
    case "not_found":
      return <PublicCardNotFound />;
    case "unconfigured":
      return <PublicCardUnavailable />;
    case "error":
    case "invalid":
      return <PublicCardUnavailable onRetry={() => void query.refetch()} retrying={query.isFetching} />;
    case "redirect":
    case "loading":
      return (
        <PublicCardSkeleton
          notice={
            query.fetchStatus === "paused" ? "offline" : query.failureCount > 0 ? "slow" : null
          }
        />
      );
  }
}

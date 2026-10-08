import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  adminCreateCard,
  adminCreateMissingCards,
  adminMarkChipsWritten,
  adminReleaseCardHandle,
  adminResetCardHandle,
  adminSetCardHidden,
  adminSetCardsEnabled,
  adminSetChapterPosition,
  adminSuggestCardHandle,
  fetchAdminCards,
} from "@/services/cards";
import { queryKeys } from "@/services/queryKeys";
import type {
  AdminCreateCardResult,
  BulkCreateCardsResult,
  MarkChipsWrittenResult,
  ReleaseCardHandleResult,
} from "@/types/database";

/**
 * Officer hooks for Admin → Business Cards and the member detail page.
 *
 * Every mutation here is officer-only because the RPC says so (each starts
 * with require_officer() and writes an audit row), not because of this file.
 *
 * Mutations invalidate the whole "cards" key rather than just the admin list.
 * An officer acting on their own row changes "My Card" too, and hiding or
 * renaming a card changes what its public page returns; the prefix covers all
 * of it, and only queries on screen actually refetch.
 *
 * They invalidate when they settle, not only on success. The list is never
 * refetched on its own while the page is open (that's the app-wide default),
 * and the usual reason an officer action fails is that the row is stale:
 * another officer already made that card or reset that handle. Refreshing on
 * failure too stops the row from offering the same impossible action again.
 */

export function useAdminCards() {
  return useQuery({
    queryKey: queryKeys.cards.admin,
    queryFn: fetchAdminCards,
  });
}

/**
 * The handle a member would get. Not cached for long: it depends on which
 * handles are taken, which changes whenever anyone saves a card.
 */
export function useAdminCardSuggestion(memberId: string | null) {
  return useQuery({
    queryKey: queryKeys.cards.adminSuggestion(memberId ?? ""),
    queryFn: () => adminSuggestCardHandle(memberId ?? ""),
    enabled: Boolean(memberId),
    staleTime: 0,
    gcTime: 0,
  });
}

function useInvalidateCards() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.cards.all });
}

export function useSetCardsEnabled() {
  const queryClient = useQueryClient();
  const invalidateCards = useInvalidateCards();

  return useMutation<void, unknown, boolean>({
    mutationFn: (enabled) => adminSetCardsEnabled(enabled),
    onSettled: () => {
      // The portal nav reads app config; get_my_card() reports `enabled` too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.appConfig });
      void invalidateCards();
    },
  });
}

export function useCreateCard() {
  const invalidateCards = useInvalidateCards();

  return useMutation<
    AdminCreateCardResult,
    unknown,
    { memberId: string; handle: string | null; publish: boolean }
  >({
    mutationFn: ({ memberId, handle, publish }) => adminCreateCard(memberId, { handle, publish }),
    onSettled: () => void invalidateCards(),
  });
}

/**
 * The bulk preview: admin_create_missing_cards with dryRun, which writes
 * nothing. A mutation rather than a query because it's an RPC call made on
 * demand (when the dialog opens, and again when the publish choice changes),
 * not data worth caching; the observer follows only the latest call, so a slow
 * answer for an old choice can't overwrite a newer one.
 */
export function useCreateMissingCardsPreview() {
  return useMutation<BulkCreateCardsResult, unknown, { publish: boolean }>({
    mutationFn: ({ publish }) => adminCreateMissingCards({ publish, dryRun: true }),
  });
}

/** The real bulk run. Only ever called after the officer has seen the preview. */
export function useCreateMissingCards() {
  const invalidateCards = useInvalidateCards();

  return useMutation<BulkCreateCardsResult, unknown, { publish: boolean }>({
    mutationFn: ({ publish }) => adminCreateMissingCards({ publish, dryRun: false }),
    onSettled: () => void invalidateCards(),
  });
}

/** One chip: whose it is, and the handle written on it. */
export interface WrittenChip {
  memberId: string;
  handle: string;
}

/**
 * Records chips as written with the handle each one actually carries, as the
 * officer exported or saw it, not whatever the member's handle is by the time
 * the request lands. Members who no longer hold that handle come back in
 * `skipped` and nothing is recorded for them.
 */
export function useMarkChipsWritten() {
  const invalidateCards = useInvalidateCards();

  return useMutation<MarkChipsWrittenResult, unknown, WrittenChip[]>({
    mutationFn: (chips) =>
      adminMarkChipsWritten(
        chips.map((chip) => chip.memberId),
        chips.map((chip) => chip.handle),
      ),
    onSettled: () => void invalidateCards(),
  });
}

export function useSetCardHidden() {
  const invalidateCards = useInvalidateCards();

  return useMutation<
    void,
    unknown,
    { memberId: string; hidden: boolean; reason: string | null }
  >({
    mutationFn: ({ memberId, hidden, reason }) => adminSetCardHidden(memberId, hidden, reason),
    onSettled: () => void invalidateCards(),
  });
}

export function useResetCardHandle() {
  const invalidateCards = useInvalidateCards();

  return useMutation<
    { old_handle: string; handle: string },
    unknown,
    { memberId: string; reason: string }
  >({
    mutationFn: ({ memberId, reason }) => adminResetCardHandle(memberId, reason),
    onSettled: () => void invalidateCards(),
  });
}

export function useReleaseCardHandle() {
  const invalidateCards = useInvalidateCards();

  return useMutation<
    ReleaseCardHandleResult,
    unknown,
    { memberId: string; handle: string; reason: string }
  >({
    mutationFn: ({ memberId, handle, reason }) => adminReleaseCardHandle(memberId, handle, reason),
    onSettled: () => void invalidateCards(),
  });
}

export function useSetChapterPosition() {
  const queryClient = useQueryClient();
  const invalidateCards = useInvalidateCards();

  return useMutation<void, unknown, { memberId: string; title: string | null }>({
    mutationFn: ({ memberId, title }) => adminSetChapterPosition(memberId, title),
    onSettled: () => {
      // The same position is what Meet your officers lists.
      void queryClient.invalidateQueries({ queryKey: queryKeys.officers.board });
      void invalidateCards();
    },
  });
}

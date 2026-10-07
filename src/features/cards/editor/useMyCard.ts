import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  checkCardHandle,
  fetchMyCard,
  pruneCardMedia,
  saveMyCard,
  setMyCardPublished,
  suggestMyCardHandle,
} from "@/services/cards";
import { queryKeys } from "@/services/queryKeys";
import type { CardFormValues } from "@/lib/validation";
import type { HandleAvailability, MyCardState } from "@/types/database";
import { formValuesToInput } from "../viewModel";

/**
 * Data hooks for My Card. Components never call the services directly, so the
 * cache rules live here in one place.
 *
 * Both mutations write their result straight into the `cards.mine` cache (it's
 * the stored card, exactly what get_my_card() would return), then invalidate
 * every "cards" key: the admin list, insights and any cached public card all
 * describe the same row. Only queries on screen actually refetch.
 */

export function useMyCard() {
  return useQuery({
    queryKey: queryKeys.cards.mine,
    queryFn: fetchMyCard,
  });
}

/**
 * The handle pre-filled for a member who has no card yet. Asked once per
 * visit: re-asking mid-edit could change the field under someone's cursor,
 * and save_my_card() re-checks whatever they end up with anyway.
 */
export function useSuggestedHandle(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.cards.suggestedHandle,
    queryFn: suggestMyCardHandle,
    enabled,
    staleTime: Infinity,
  });
}

function useCardsCacheUpdate() {
  const queryClient = useQueryClient();
  return (next: MyCardState) => {
    queryClient.setQueryData(queryKeys.cards.mine, next);
    void queryClient.invalidateQueries({ queryKey: queryKeys.cards.all });
  };
}

export function useSaveMyCard() {
  const update = useCardsCacheUpdate();
  return useMutation<MyCardState, unknown, CardFormValues>({
    mutationFn: (values) => {
      const { card, links } = formValuesToInput(values);
      return saveMyCard(card, links);
    },
    onSuccess: update,
  });
}

/**
 * Once per visit to My Card, clears images in the member's folder that the
 * saved card doesn't use and that are over a week old (see pruneCardMedia).
 * Uploads abandoned in a closed tab would otherwise count toward the bucket's
 * 30-file cap forever. Keyed on the member, so re-renders and refetches don't
 * repeat it.
 */
export function usePruneOrphanedMedia(memberId: string | null, keep: readonly string[]) {
  const prunedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!memberId || prunedFor.current === memberId) return;
    prunedFor.current = memberId;
    void pruneCardMedia(memberId, [...keep]);
  }, [memberId, keep]);
}

export function useSetMyCardPublished() {
  const update = useCardsCacheUpdate();
  return useMutation<MyCardState, unknown, boolean>({
    mutationFn: (published) => setMyCardPublished(published),
    onSuccess: update,
  });
}

/* ── Handle availability ─────────────────────────────────────────────────── */

/** `value`, once it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export type HandleStatus = "idle" | "checking" | "error" | HandleAvailability;

/** Long enough that typing doesn't fire a request per keystroke. */
export const HANDLE_CHECK_DELAY_MS = 400;

/**
 * Live availability for a handle that already passes the client-side rules.
 * Pass null to check nothing (empty, malformed, or the card's current handle).
 *
 * Debounced, and cached briefly per handle so backspacing to a handle just
 * checked answers instantly. The answer is advice: someone can claim a handle
 * between this check and the save, and save_my_card() is what decides.
 */
export function useHandleAvailability(handle: string | null): HandleStatus {
  const queryClient = useQueryClient();
  const debounced = useDebouncedValue(handle, HANDLE_CHECK_DELAY_MS);
  const settled = debounced === handle;

  const query = useQuery({
    queryKey: queryKeys.cards.handleCheck(debounced ?? ""),
    queryFn: () => checkCardHandle(debounced ?? ""),
    enabled: debounced !== null && settled,
    staleTime: 30_000,
    retry: false,
  });

  if (handle === null) return "idle";
  if (!settled) {
    // Mid-typing: a handle answered moments ago doesn't need to wait out the delay.
    return (
      queryClient.getQueryData<HandleAvailability>(queryKeys.cards.handleCheck(handle)) ??
      "checking"
    );
  }
  if (query.isError) return "error";
  if (query.data) return query.data;
  return "checking";
}

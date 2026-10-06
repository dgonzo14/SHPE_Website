import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/services/queryKeys";
import {
  fetchLeaderboard,
  refreshLeaderboard,
  setLeaderboardEnabled,
} from "@/services/leaderboard";
import type { LeaderboardScope } from "@/types/database";

/**
 * The board is a snapshot the database rebuilds once a day, so refetching it
 * every minute would only re-download the same rows. Half an hour keeps a tab
 * left open overnight from showing yesterday's board for long, without asking
 * again on every visit.
 */
export function useLeaderboard(scope: LeaderboardScope) {
  return useQuery({
    queryKey: queryKeys.leaderboard.board(scope),
    queryFn: () => fetchLeaderboard(scope),
    staleTime: 30 * 60_000,
  });
}

/* ── Officer controls ─────────────────────────────────────────────────────── */

export function useSetLeaderboardEnabled() {
  const queryClient = useQueryClient();

  return useMutation<void, unknown, boolean>({
    mutationFn: (enabled) => setLeaderboardEnabled(enabled),
    onSuccess: () => {
      // The nav link reads app config; the board itself reports `enabled`.
      void queryClient.invalidateQueries({ queryKey: queryKeys.appConfig });
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard.all });
    },
  });
}

export function useRefreshLeaderboard() {
  const queryClient = useQueryClient();

  return useMutation<{ refreshed_at: string }, unknown, void>({
    mutationFn: () => refreshLeaderboard(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard.all });
    },
  });
}

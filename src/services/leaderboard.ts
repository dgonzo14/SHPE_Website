import { getSupabase } from "@/lib/supabase";
import type {
  LeaderboardBoard,
  LeaderboardResponse,
  LeaderboardScope,
} from "@/types/database";

/**
 * The points leaderboard.
 *
 * Thin wrappers over RPCs, like every other service: the rules live in the
 * database. get_points_leaderboard() decides who may see the board, hands a
 * member nothing but `{ enabled: false }` while it is hidden, and rebuilds the
 * daily snapshot on the first read after midnight. None of that is enforced
 * here, and the snapshot tables have no grants, so none of it can be bypassed
 * by calling the API directly.
 */

export async function fetchLeaderboard(scope: LeaderboardScope): Promise<LeaderboardResponse> {
  const { data, error } = await getSupabase().rpc("get_points_leaderboard", {
    p_scope: scope,
  });
  if (error) throw error;
  return data as LeaderboardResponse;
}

/**
 * A hidden board and an officer's preview of one both say `enabled: false`;
 * only the preview carries a board. This is the test that tells them apart.
 */
export function isLeaderboardBoard(
  response: LeaderboardResponse | undefined,
): response is LeaderboardBoard {
  return Boolean(response && response.scope !== undefined);
}

/* ── Officer controls ─────────────────────────────────────────────────────── */

export async function setLeaderboardEnabled(enabled: boolean): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_leaderboard_enabled", {
    p_enabled: enabled,
  });
  if (error) throw error;
}

/** Rebuilds the snapshot now rather than waiting for tonight. Audited. */
export async function refreshLeaderboard(): Promise<{ refreshed_at: string }> {
  const { data, error } = await getSupabase().rpc("admin_refresh_points_leaderboard");
  if (error) throw error;
  return data as { refreshed_at: string };
}

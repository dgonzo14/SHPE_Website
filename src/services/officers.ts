import { getSupabase } from "@/lib/supabase";
import leadersData from "@/data/leaders.json";
import type { ChapterOfficer } from "@/types/database";

/**
 * The executive board, as members see it in My SHPE.
 *
 * A member's position is the one in public.chapter_positions, the same title
 * their business card shows, set by an officer with admin_set_chapter_position()
 * (see services/cards.ts). A position is only a title: officer access is the
 * `officer` role under Roles, and nothing in the database reads a position to
 * decide what anyone may do.
 */

/**
 * The positions on the public Leadership page, in its order. Offered as the
 * choices when an officer sets a position, so the board and the public page use
 * the same titles. get_chapter_officers() sorts by the same list.
 */
export const BOARD_POSITIONS: readonly string[] = Array.from(
  new Set((leadersData as { position: string }[]).map((leader) => leader.position)),
);

/**
 * Position holders with their title and contact details, in board order.
 * get_chapter_officers() decides what that includes, and refuses a pending
 * account outright.
 */
export async function fetchChapterOfficers(): Promise<ChapterOfficer[]> {
  const { data, error } = await getSupabase().rpc("get_chapter_officers");
  if (error) throw error;
  return (data ?? []) as ChapterOfficer[];
}

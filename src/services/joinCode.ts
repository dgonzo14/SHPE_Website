import { getSupabase } from "@/lib/supabase";

/**
 * Join code: the route from 'pending' to 'active' without an email.
 *
 * Confirmation emails to @wustl.edu are removed from the mailbox by Microsoft
 * Defender after delivery, and the confirmation link is blocked on campus wifi
 * by Cisco Umbrella. Both were reproduced. So a new member lands as 'pending'
 * and gets in either by entering the code an officer reads out, or by an
 * officer approving them.
 *
 * Everything here is a thin wrapper over an RPC. The rules live in the
 * database: redeem_join_code() throttles, compares against a salted hash, and
 * writes the audit entry; the admin functions each call require_officer()
 * before doing anything. None of that is enforced in this file, and none of it
 * can be bypassed by calling the API directly.
 */

export type RedeemResultCode =
  | "ACTIVATED"
  | "ALREADY_ACTIVE"
  | "INVALID_CODE"
  | "RATE_LIMITED"
  | "JOIN_CODE_DISABLED"
  | "NOT_ELIGIBLE"
  | "UNAUTHORIZED";

export interface RedeemResult {
  ok: boolean;
  code: RedeemResultCode;
  membership_status?: string;
}

/** Redeem the chapter join code for the signed-in member. */
export async function redeemJoinCode(code: string): Promise<RedeemResult> {
  const { data, error } = await getSupabase().rpc("redeem_join_code", { p_code: code });
  if (error) throw error;
  return data as RedeemResult;
}

/**
 * Message for each outcome.
 *
 * Kept beside the type so a new result code from the database shows up as a
 * TypeScript error here rather than as an empty toast in front of a room full
 * of students.
 */
export const REDEEM_MESSAGES: Record<RedeemResultCode, { title: string; detail?: string }> = {
  ACTIVATED: { title: "You're in" },
  ALREADY_ACTIVE: { title: "You're already a member" },
  INVALID_CODE: {
    title: "That code didn't match",
    detail: "Check the code on the screen and try again. Spaces and dashes don't matter.",
  },
  RATE_LIMITED: {
    title: "Too many tries",
    detail: "Wait a few minutes and try again, or ask an officer to approve you directly.",
  },
  JOIN_CODE_DISABLED: {
    title: "There's no join code right now",
    detail: "Ask an officer to approve your account.",
  },
  NOT_ELIGIBLE: {
    title: "This account can't join with a code",
    detail: "Ask an officer for help with your membership status.",
  },
  UNAUTHORIZED: { title: "Sign in first" },
};

/* ── Officer controls ─────────────────────────────────────────────────────── */

export interface JoinCodeStatus {
  ok: boolean;
  /** Whether a code has ever been set. The code itself is never returned. */
  configured: boolean;
  enabled: boolean;
  rotated_at: string | null;
  failed_attempts_24h: number;
  pending_members: number;
}

export async function fetchJoinCodeStatus(): Promise<JoinCodeStatus> {
  const { data, error } = await getSupabase().rpc("admin_join_code_status");
  if (error) throw error;
  return data as JoinCodeStatus;
}

/**
 * Sets (or replaces) the join code.
 *
 * There is deliberately no way to read the current code back — the database
 * stores only a salted hash. An officer who forgets it sets a new one.
 */
export async function setJoinCode(code: string, enabled = true): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_join_code", {
    p_code: code,
    p_enabled: enabled,
  });
  if (error) throw error;
}

export async function setJoinCodeEnabled(enabled: boolean): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_join_code_enabled", {
    p_enabled: enabled,
  });
  if (error) throw error;
}

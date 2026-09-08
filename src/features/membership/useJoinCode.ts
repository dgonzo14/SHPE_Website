import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/useAuth";
import { queryKeys } from "@/services/queryKeys";
import {
  fetchJoinCodeStatus,
  redeemJoinCode,
  setJoinCode,
  setJoinCodeEnabled,
  type JoinCodeStatus,
  type RedeemResult,
} from "@/services/joinCode";

/**
 * Redeems the join code and re-reads the profile.
 *
 * The refresh is the important part. Activation happens inside the RPC's
 * transaction, but the member's cached profile still says 'pending', so
 * without it they would be told they are in and then be refused at check-in
 * until they reloaded. refreshProfile() is awaited so the success screen
 * renders against the new status rather than racing it.
 *
 * `throwOnError` stays off, matching useCheckIn: a wrong code is an expected
 * answer with a message attached, not an exception.
 */
export function useRedeemJoinCode() {
  const queryClient = useQueryClient();
  const { refreshProfile } = useAuth();

  return useMutation<RedeemResult, unknown, string>({
    mutationFn: (code) => redeemJoinCode(code),
    onSuccess: async (result) => {
      if (!result.ok) return;
      await refreshProfile();
      void queryClient.invalidateQueries({ queryKey: ["member"] });
    },
  });
}

/* ── Officer controls ─────────────────────────────────────────────────────── */

export function useJoinCodeStatus(enabled = true) {
  return useQuery<JoinCodeStatus>({
    queryKey: queryKeys.admin.joinCode,
    enabled,
    queryFn: fetchJoinCodeStatus,
    // The pending count on this screen is what an officer watches during a GBM
    // while people sign up in front of them, so it should not need a reload.
    refetchInterval: 30_000,
  });
}

export function useSetJoinCode() {
  const queryClient = useQueryClient();

  return useMutation<void, unknown, { code: string; enabled: boolean }>({
    mutationFn: ({ code, enabled }) => setJoinCode(code, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.joinCode });
    },
  });
}

export function useSetJoinCodeEnabled() {
  const queryClient = useQueryClient();

  return useMutation<void, unknown, boolean>({
    mutationFn: (enabled) => setJoinCodeEnabled(enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.joinCode });
    },
  });
}

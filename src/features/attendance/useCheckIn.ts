import { useMutation, useQueryClient } from "@tanstack/react-query";

import { checkInToEvent, checkInWithCode } from "@/services/points";
import type { CheckInResult } from "@/types/database";

export interface CheckInInput {
  code: string;
  /** Present when checking in from an event's own page. */
  eventId?: string;
}

/**
 * Runs a check-in and refreshes everything it can change.
 *
 * The RPC is transactional, so by the time this resolves the attendance row and
 * its point transaction both exist. What is stale is the client cache — points,
 * attendance history, the event's own "attended" badge and the dashboard — so
 * they are all invalidated here rather than at each call site, and the member
 * never has to reload the page to see the new total.
 *
 * `throwOnError` stays off: a wrong code is an expected outcome with a useful
 * message attached, not an exception.
 */
export function useCheckIn() {
  const queryClient = useQueryClient();

  return useMutation<CheckInResult, unknown, CheckInInput>({
    mutationFn: ({ code, eventId }) =>
      eventId ? checkInToEvent(eventId, code) : checkInWithCode(code),
    onSuccess: (result) => {
      if (!result.ok) return;
      void queryClient.invalidateQueries({ queryKey: ["member"] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

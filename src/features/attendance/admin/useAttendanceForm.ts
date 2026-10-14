import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchAttendanceLink, fetchWaitingSubmissions } from "@/services/attendanceForm";
import { queryKeys } from "@/services/queryKeys";

/**
 * Officer queries for an event's attendance form.
 *
 * Hooks rather than inline useQuery calls because the roster page and the
 * components on it read the same data (the waiting list feeds the section,
 * the count in the stats and the CSV), and one key in one place is what lets
 * react-query share a single request between them.
 *
 * Polling is opt-in per caller rather than built into the hooks. Every
 * observer of a query with refetchInterval runs its own timer, and the
 * observers on one page mount at different moments (the page's before the
 * event has loaded, the components' after), so two polling observers would
 * fetch twice per interval. One observer per query on the page asks to poll;
 * the rest just read the cache it keeps fresh.
 */

/**
 * How often a page showing the link re-reads it. Another officer may replace
 * the link mid-meeting (it leaked, say), and a laptop projecting the old QR
 * code full screen would otherwise go on showing a dead code until someone
 * reloads it. A minute is soon enough for that and costs next to nothing.
 */
export const LINK_REFRESH_MS = 60_000;

/**
 * How often the roster and the waiting list refresh themselves while people
 * are checking in, so an officer at the door sees each arrival without
 * reloading. The same pace as the join code's pending count.
 */
export const LIVE_REFRESH_MS = 30_000;

/**
 * The event's link, or { has_link: false }. Officers only (the RPC checks).
 * `watch` keeps it fresh while the page is open and the tab is visible:
 * react-query skips the interval in a hidden tab (refetchIntervalInBackground
 * is off by default), so a roster left open in a background tab costs nothing.
 */
export function useAttendanceLink(eventId: string, { watch = false }: { watch?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.events.attendanceLink(eventId),
    queryFn: () => fetchAttendanceLink(eventId),
    enabled: Boolean(eventId),
    refetchInterval: watch ? LINK_REFRESH_MS : false,
  });
}

/**
 * Form responses to the event still waiting for an account, oldest first.
 * `live` polls every LIVE_REFRESH_MS, for while the check-in window is open;
 * like the link, a hidden tab skips the polls.
 */
export function useWaitingSubmissions(eventId: string, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.events.waitingSubmissions(eventId),
    queryFn: () => fetchWaitingSubmissions(eventId),
    enabled: Boolean(eventId),
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

/**
 * Refreshes everything adding, linking or deleting a response can change: the
 * roster and the waiting list on this page, the member's own points and
 * history, and the recent check-ins on the admin dashboard.
 */
export function useInvalidateEventAttendance(eventId: string) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.events.attendance(eventId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.events.waitingSubmissions(eventId) });
    void queryClient.invalidateQueries({ queryKey: ["member"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.attendanceFeed });
  }, [queryClient, eventId]);
}

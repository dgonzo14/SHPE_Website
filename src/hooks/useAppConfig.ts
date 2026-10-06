import { useQuery } from "@tanstack/react-query";

import { fetchAppConfig } from "@/services/content";
import { queryKeys } from "@/services/queryKeys";

/**
 * The safe subset of chapter settings that get_app_config() exposes.
 *
 * Settings change when an officer changes them, which is rare, and the screens
 * that change them invalidate this key. So it is cached for a while rather than
 * refetched on every page.
 */
export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.appConfig,
    queryFn: fetchAppConfig,
    staleTime: 10 * 60_000,
  });
}

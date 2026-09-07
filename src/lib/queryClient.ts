import { QueryClient } from "@tanstack/react-query";

function isNotWorthRetrying(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";

  // Permission denied, an expired JWT, and a missing row will fail identically
  // on the third attempt as on the first.
  return (
    code === "42501" ||
    code === "PGRST301" ||
    code === "PGRST116" ||
    e.status === 401 ||
    e.status === 403 ||
    /not configured for this deployment/i.test(message)
  );
}

/**
 * Cache policy is deliberately calm: SHPE data changes on the timescale of a
 * meeting, not a stock ticker. Freshness where it matters comes from explicit
 * invalidation after mutations (see queryKeys), not from aggressive polling.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => !isNotWorthRetrying(error) && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

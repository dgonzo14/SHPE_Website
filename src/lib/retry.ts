/**
 * Retrying past Supabase Auth's per-IP burst limit.
 *
 * Measured against production: the sign-up limiter is a token bucket, not a
 * fixed window. It holds a burst of 30 and refills at the configured sustained
 * rate. A room of students on one campus NAT shares that bucket, so the first
 * 30 sign-ups go through instantly and the next ones are rejected outright —
 * even though capacity returns within seconds.
 *
 * That is a queue misreported as a failure. The request is rejected before
 * anything is created, so retrying is safe, and by the time a student has read
 * an error message the bucket has usually refilled anyway. Doing it here turns
 * a hard "too many attempts" into a slower success.
 *
 * Jitter is not decoration. Thirty clients rejected at the same instant will
 * retry at the same instant unless something separates them, and a synchronised
 * retry is the original burst again. Each delay is randomised across its whole
 * window so the retries arrive spread out.
 */

/** GoTrue answers a throttled request with 429 and "Request rate limit reached". */
export function isRateLimited(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; message?: unknown };
  if (e.status === 429) return true;
  if (e.code === "over_request_rate_limit") return true;
  return (
    typeof e.message === "string" &&
    /rate limit|too many requests|for security purposes/i.test(e.message)
  );
}

export interface RetryOptions {
  /** Attempts after the first. */
  retries?: number;
  /** Upper bound of the first backoff window, in ms; doubles each attempt. */
  baseDelayMs?: number;
  /** Injectable for tests, which must not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Called before each wait, so the UI can explain the delay. */
  onRetry?: (attempt: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `fn`, retrying only while it reports a rate limit.
 *
 * `fn` returns Supabase's `{ data, error }` rather than throwing, so this
 * inspects the error instead of catching one. Anything that is not a rate
 * limit — a duplicate address, a weak password, a network failure — is
 * returned immediately: retrying those just delays the message.
 *
 * The schedule is sized against the measured refill rate, not guessed. The
 * bucket refills at about one token every two seconds, so a queue of sixty
 * students takes roughly a minute to drain; a four-retry, fifteen-second budget
 * was tested against production and only got 36 of 60 through. Six retries
 * doubling from 800ms spans up to ~50s (about 25s on average once jitter is
 * accounted for), which covers the drain.
 *
 * Waiting that long is only acceptable because the alternative is an error
 * message telling someone to come back later. The register form says what is
 * happening while this runs.
 */
export async function retryOnRateLimit<T extends { error: unknown }>(
  fn: () => Promise<T>,
  {
    retries = 6,
    baseDelayMs = 800,
    sleep = defaultSleep,
    random = Math.random,
    onRetry,
  }: RetryOptions = {},
): Promise<T> {
  let result = await fn();

  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (!isRateLimited(result.error)) return result;
    onRetry?.(attempt + 1);
    // Full jitter: uniform across [0, window) rather than window/2 + jitter,
    // which still clusters.
    await sleep(random() * baseDelayMs * 2 ** attempt);
    result = await fn();
  }

  return result;
}

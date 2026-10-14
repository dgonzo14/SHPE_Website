import { useEffect, useState } from "react";

/**
 * How often officer pages re-read the clock. Officers keep the roster open
 * through a meeting, and "Opens at 6:30 PM" should turn into "Taking responses
 * now" (and the roster should start refreshing itself) without a reload. A few
 * seconds late is fine: the database decides what the form accepts, and this
 * only decides what the page says and when it starts or stops polling.
 */
export const CLOCK_TICK_MS = 15_000;

/** The current time, updated every CLOCK_TICK_MS. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

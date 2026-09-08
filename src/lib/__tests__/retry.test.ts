import { describe, expect, it, vi } from "vitest";

import { isRateLimited, retryOnRateLimit } from "../retry";

/**
 * These cover the two ways this can go wrong quietly.
 *
 * Retrying something that is not a rate limit turns a one-second "that email is
 * already registered" into a minute of spinning before the same message. Not
 * retrying a real rate limit is the bug this module exists to fix. Both look
 * fine in a manual test, because a manual test never hits the limiter.
 */
describe("isRateLimited", () => {
  it("recognises the shapes GoTrue actually returns", () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
    expect(isRateLimited({ code: "over_request_rate_limit" })).toBe(true);
    expect(isRateLimited({ message: "Request rate limit reached" })).toBe(true);
    // GoTrue's wording for the per-address cooldown on repeated sends.
    expect(
      isRateLimited({ message: "For security purposes, you can only request this after 51s" }),
    ).toBe(true);
  });

  it("does not treat ordinary failures as rate limits", () => {
    expect(isRateLimited(null)).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
    expect(isRateLimited({ message: "User already registered" })).toBe(false);
    expect(isRateLimited({ status: 400, message: "Password should be at least 8 characters" })).toBe(
      false,
    );
    // A 400 mentioning neither is still a 400.
    expect(isRateLimited({ status: 400 })).toBe(false);
  });
});

describe("retryOnRateLimit", () => {
  const sleep = () => Promise.resolve();

  it("returns a success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue({ error: null, data: "ok" });
    const result = await retryOnRateLimit(fn, { sleep });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.data).toBe("ok");
  });

  it("retries a rate limit until it clears", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ error: { status: 429 } })
      .mockResolvedValueOnce({ error: { status: 429 } })
      .mockResolvedValue({ error: null, data: "ok" });

    const result = await retryOnRateLimit(fn, { sleep });

    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.error).toBeNull();
  });

  it("does not retry other errors", async () => {
    const fn = vi.fn().mockResolvedValue({ error: { message: "User already registered" } });
    const result = await retryOnRateLimit(fn, { sleep });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.error).toEqual({ message: "User already registered" });
  });

  it("gives up after the configured number of retries and returns the last error", async () => {
    const fn = vi.fn().mockResolvedValue({ error: { status: 429 } });
    const result = await retryOnRateLimit(fn, { retries: 3, sleep });

    // First attempt plus three retries.
    expect(fn).toHaveBeenCalledTimes(4);
    expect(result.error).toEqual({ status: 429 });
  });

  it("backs off with full jitter, doubling each attempt", async () => {
    const waits: number[] = [];
    const fn = vi.fn().mockResolvedValue({ error: { status: 429 } });

    await retryOnRateLimit(fn, {
      retries: 4,
      baseDelayMs: 800,
      // random() at its maximum gives the top of each window, which is what
      // the doubling is easiest to see against.
      random: () => 1,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    expect(waits).toEqual([800, 1600, 3200, 6400]);
  });

  it("spreads retries across the window rather than clustering", async () => {
    // The whole point of full jitter: with random() at 0 the wait is 0, not
    // half the window. Thirty clients rejected together must not come back
    // together.
    const waits: number[] = [];
    const fn = vi.fn().mockResolvedValue({ error: { status: 429 } });

    await retryOnRateLimit(fn, {
      retries: 2,
      baseDelayMs: 800,
      random: () => 0,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    expect(waits).toEqual([0, 0]);
  });

  it("reports each retry so the UI can explain the delay", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ error: { status: 429 } })
      .mockResolvedValueOnce({ error: { status: 429 } })
      .mockResolvedValue({ error: null });

    await retryOnRateLimit(fn, { sleep, onRetry });

    expect(onRetry.mock.calls).toEqual([[1], [2]]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const remove = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ storage: { from: () => ({ list, remove }) } }),
}));

import { ORPHAN_MEDIA_MIN_AGE_MS, pruneCardMedia } from "../cards";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const file = (n: number) => `2222222${n}-2222-4222-8222-222222222222.webp`;
const path = (n: number) => `${MEMBER}/${file(n)}`;
const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

beforeEach(() => {
  list.mockReset();
  remove.mockReset();
  remove.mockResolvedValue({ data: [], error: null });
});

describe("pruneCardMedia", () => {
  it("removes only unused images older than a week", async () => {
    list.mockResolvedValue({
      data: [
        { name: file(1), created_at: ago(ORPHAN_MEDIA_MIN_AGE_MS * 3) }, // the saved avatar
        { name: file(2), created_at: ago(ORPHAN_MEDIA_MIN_AGE_MS * 2) }, // abandoned: goes
        { name: file(3), created_at: ago(60_000) }, // fresh, maybe unsaved in another tab
        { name: file(5), created_at: ago(3 * 24 * 60 * 60_000) }, // days old, still under a week
        { name: file(4) }, // no timestamp: no proof it's old
        { name: "notes.txt", created_at: ago(ORPHAN_MEDIA_MIN_AGE_MS * 9) }, // not a card path
      ],
      error: null,
    });

    const removed = await pruneCardMedia(MEMBER, [path(1), null], { now: NOW });

    expect(list).toHaveBeenCalledWith(MEMBER, { limit: 1000 });
    expect(remove).toHaveBeenCalledWith([path(2)]);
    expect(removed).toBe(1);
  });

  it("does nothing when everything is in use or recent", async () => {
    list.mockResolvedValue({
      data: [{ name: file(1), created_at: ago(ORPHAN_MEDIA_MIN_AGE_MS * 5) }],
      error: null,
    });
    expect(await pruneCardMedia(MEMBER, [path(1)], { now: NOW })).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it("never throws, whatever storage does", async () => {
    list.mockRejectedValue(new Error("network down"));
    await expect(pruneCardMedia(MEMBER, [], { now: NOW })).resolves.toBe(0);

    list.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(pruneCardMedia(MEMBER, [], { now: NOW })).resolves.toBe(0);

    list.mockResolvedValue({
      data: [{ name: file(2), created_at: ago(ORPHAN_MEDIA_MIN_AGE_MS * 2) }],
      error: null,
    });
    remove.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(pruneCardMedia(MEMBER, [], { now: NOW })).resolves.toBe(0);
  });
});

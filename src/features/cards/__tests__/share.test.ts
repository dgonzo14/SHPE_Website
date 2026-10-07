import { afterEach, describe, expect, it, vi } from "vitest";

import { canNativeShare, copyText, shareCard } from "../share";

const SHARE = { url: "https://washushpe.org/card/diego", title: "Diego Gonzalez", text: "My card" };

/** Installs (or removes, with undefined) a navigator/document property for one test. */
const installed: [object, string][] = [];
function install(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
  installed.push([target, key]);
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

afterEach(() => {
  for (const [target, key] of installed.splice(0)) {
    delete (target as Record<string, unknown>)[key];
  }
});

describe("canNativeShare", () => {
  it("follows navigator.share", () => {
    install(navigator, "share", undefined);
    expect(canNativeShare()).toBe(false);
    install(navigator, "share", vi.fn());
    expect(canNativeShare()).toBe(true);
  });
});

describe("copyText", () => {
  it("uses the async clipboard API when it's there", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    install(navigator, "clipboard", { writeText });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a hidden textarea and execCommand, and tidies up after", async () => {
    install(navigator, "clipboard", { writeText: vi.fn().mockRejectedValue(domError("NotAllowedError")) });
    let copied = "";
    install(
      document,
      "execCommand",
      vi.fn(() => {
        copied = document.querySelector("textarea")?.value ?? "";
        return true;
      }),
    );
    await expect(copyText("hello")).resolves.toBe(true);
    expect(copied).toBe("hello");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("returns false when neither path works", async () => {
    install(navigator, "clipboard", undefined);
    install(document, "execCommand", vi.fn(() => false));
    await expect(copyText("hello")).resolves.toBe(false);
  });
});

describe("shareCard", () => {
  it("opens the share sheet when there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    install(navigator, "share", share);
    await expect(shareCard(SHARE)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ url: SHARE.url, title: SHARE.title, text: SHARE.text });
  });

  it("treats dismissing the sheet as cancelled, without copying", async () => {
    install(navigator, "share", vi.fn().mockRejectedValue(domError("AbortError")));
    const writeText = vi.fn().mockResolvedValue(undefined);
    install(navigator, "clipboard", { writeText });
    await expect(shareCard(SHARE)).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the link when the share sheet refuses", async () => {
    install(navigator, "share", vi.fn().mockRejectedValue(domError("NotAllowedError")));
    const writeText = vi.fn().mockResolvedValue(undefined);
    install(navigator, "clipboard", { writeText });
    await expect(shareCard(SHARE)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(SHARE.url);
  });

  it("copies the link when canShare says the data can't be shared", async () => {
    const share = vi.fn();
    install(navigator, "share", share);
    install(navigator, "canShare", vi.fn(() => false));
    install(navigator, "clipboard", { writeText: vi.fn().mockResolvedValue(undefined) });
    await expect(shareCard(SHARE)).resolves.toBe("copied");
    expect(share).not.toHaveBeenCalled();
  });

  it("copies the link where there's no share sheet", async () => {
    install(navigator, "share", undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    install(navigator, "clipboard", { writeText });
    await expect(shareCard({ url: SHARE.url, title: SHARE.title })).resolves.toBe("copied");
  });

  it("reports failure when nothing works", async () => {
    install(navigator, "share", undefined);
    install(navigator, "clipboard", undefined);
    install(document, "execCommand", vi.fn(() => false));
    await expect(shareCard(SHARE)).resolves.toBe("failed");
  });

  it("leaves out empty text", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    install(navigator, "share", share);
    await shareCard({ url: SHARE.url, title: SHARE.title, text: "" });
    expect(share).toHaveBeenCalledWith({ url: SHARE.url, title: SHARE.title });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NfcWriteError, isNfcCancelled, isWebNfcSupported, writeUrlToTag } from "../webNfc";

const URL_TO_WRITE = "https://washushpe.org/card/diego-gonzalez?src=nfc";

const write = vi.fn<(message: unknown, options?: unknown) => Promise<void>>();

function installReader() {
  class FakeNDEFReader {
    write(message: unknown, options?: unknown) {
      return write(message, options);
    }
  }
  Object.defineProperty(window, "NDEFReader", { value: FakeNDEFReader, configurable: true, writable: true });
}

function setSecure(secure: boolean) {
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    expect(error).toBeInstanceOf(NfcWriteError);
    return (error as NfcWriteError).code;
  }
}

beforeEach(() => {
  setSecure(true);
  write.mockResolvedValue(undefined);
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).NDEFReader;
  delete (window as unknown as Record<string, unknown>).isSecureContext;
});

describe("isWebNfcSupported", () => {
  it("is false without NDEFReader", () => {
    expect(isWebNfcSupported()).toBe(false);
  });

  it("is true with NDEFReader in a secure context", () => {
    installReader();
    expect(isWebNfcSupported()).toBe(true);
  });

  it("is false outside a secure context, even with NDEFReader", () => {
    installReader();
    setSecure(false);
    expect(isWebNfcSupported()).toBe(false);
  });
});

describe("writeUrlToTag", () => {
  it("writes one URL record, overwriting the tag, with the caller's signal", async () => {
    installReader();
    const controller = new AbortController();
    await writeUrlToTag(URL_TO_WRITE, { signal: controller.signal });
    expect(write).toHaveBeenCalledWith(
      { records: [{ recordType: "url", data: URL_TO_WRITE }] },
      { overwrite: true, signal: controller.signal },
    );
  });

  it("refuses where Web NFC isn't available", async () => {
    expect(await codeOf(writeUrlToTag(URL_TO_WRITE))).toBe("not_supported");
  });

  it("says so when the page isn't secure", async () => {
    installReader();
    setSecure(false);
    expect(await codeOf(writeUrlToTag(URL_TO_WRITE))).toBe("insecure_context");
    expect(write).not.toHaveBeenCalled();
  });

  it("only writes https addresses", async () => {
    installReader();
    expect(await codeOf(writeUrlToTag("http://washushpe.org/card/diego"))).toBe("invalid_url");
    expect(await codeOf(writeUrlToTag("javascript:alert(1)"))).toBe("invalid_url");
    expect(write).not.toHaveBeenCalled();
  });

  it("doesn't start when already aborted", async () => {
    installReader();
    const controller = new AbortController();
    controller.abort();
    expect(await codeOf(writeUrlToTag(URL_TO_WRITE, { signal: controller.signal }))).toBe("cancelled");
    expect(write).not.toHaveBeenCalled();
  });

  it("reports an abort while waiting for a tag as cancelled", async () => {
    installReader();
    const controller = new AbortController();
    write.mockImplementation(
      () =>
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(domError("AbortError")));
        }),
    );
    const pending = writeUrlToTag(URL_TO_WRITE, { signal: controller.signal });
    controller.abort();
    const code = await codeOf(pending);
    expect(code).toBe("cancelled");
  });

  it.each([
    ["NotAllowedError", "permission_denied", /Allow NFC/],
    ["NotReadableError", "nfc_off", /turned off/],
    ["NotSupportedError", "not_writable", /locked or password-protected/],
    ["NetworkError", "transfer_failed", /Hold the card/],
    ["AbortError", "cancelled", /cancelled/],
    ["WeirdError", "unknown", /Try again/],
  ])("maps %s to %s with a member-facing message", async (name, code, message) => {
    installReader();
    write.mockRejectedValue(domError(name));
    const error = await writeUrlToTag(URL_TO_WRITE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NfcWriteError);
    expect((error as NfcWriteError).code).toBe(code);
    expect((error as NfcWriteError).message).toMatch(message);
    expect(isNfcCancelled(error)).toBe(code === "cancelled");
  });
});

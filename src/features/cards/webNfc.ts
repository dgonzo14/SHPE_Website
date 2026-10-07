/**
 * "Write to my card" with Web NFC: Chrome on Android only, as a progressive
 * enhancement. Everywhere else the Share tab shows NFC Tools instructions.
 *
 * The types are declared here rather than as a global augmentation: Web NFC
 * isn't in TypeScript's DOM lib, and a global `NDEFReader` declaration would
 * make it look available to every file in the app, which it mostly isn't.
 */

interface NdefRecordInit {
  recordType: "url";
  data: string;
}

interface NdefWriteOptions {
  overwrite?: boolean;
  signal?: AbortSignal;
}

interface NdefReaderLike {
  write(message: { records: NdefRecordInit[] }, options?: NdefWriteOptions): Promise<void>;
}

type NdefReaderConstructor = new () => NdefReaderLike;

export type NfcErrorCode =
  | "not_supported"
  | "insecure_context"
  | "invalid_url"
  | "permission_denied"
  | "nfc_off"
  | "not_writable"
  | "transfer_failed"
  | "cancelled"
  | "unknown";

/** A failed write, with a sentence that can be shown to the member as-is. */
export class NfcWriteError extends Error {
  readonly code: NfcErrorCode;

  constructor(code: NfcErrorCode, message: string) {
    super(message);
    this.name = "NfcWriteError";
    this.code = code;
  }
}

const MESSAGES: Record<NfcErrorCode, string> = {
  not_supported:
    "This browser can't write NFC cards. Use Chrome on an Android phone, or the NFC Tools app.",
  insecure_context: "NFC writing only works on the secure (https) version of the site.",
  invalid_url: "That card address can't be written to a chip.",
  permission_denied:
    "Chrome wasn't allowed to use NFC. Allow NFC for this site in Chrome's site settings, then try again.",
  nfc_off: "NFC looks turned off. Turn it on in your phone's settings, then try again.",
  not_writable:
    "That chip can't be written. It may be locked or password-protected; ask an officer to rewrite it.",
  transfer_failed:
    "The write didn't finish. Hold the card flat against the back of your phone until it confirms, then try again. If it keeps failing, the chip may be password-protected.",
  cancelled: "Writing was cancelled.",
  unknown: "Something went wrong writing the card. Try again.",
};

function nfcError(code: NfcErrorCode): NfcWriteError {
  return new NfcWriteError(code, MESSAGES[code]);
}

function readerConstructor(): NdefReaderConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const candidate = (window as unknown as { NDEFReader?: unknown }).NDEFReader;
  return typeof candidate === "function" ? (candidate as NdefReaderConstructor) : undefined;
}

/** Web NFC is present and usable here (it only exists in secure contexts). */
export function isWebNfcSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true && !!readerConstructor();
}

/**
 * Chrome reports failures as DOMExceptions, by name. A locked chip surfaces as
 * NotSupportedError (no writable NDEF) or NetworkError (the write was refused
 * mid-transfer, which is also what a card pulled away too early looks like).
 */
function mapError(error: unknown): NfcWriteError {
  if (error instanceof NfcWriteError) return error;
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  switch (name) {
    case "AbortError":
      return nfcError("cancelled");
    case "NotAllowedError":
    case "SecurityError":
      return nfcError("permission_denied");
    case "NotReadableError":
      return nfcError("nfc_off");
    case "NotSupportedError":
    case "InvalidStateError":
      return nfcError("not_writable");
    case "NetworkError":
      return nfcError("transfer_failed");
    case "SyntaxError":
    case "TypeError":
      return nfcError("invalid_url");
    default:
      return nfcError("unknown");
  }
}

/**
 * Writes one URL record to the next tag the phone touches, replacing whatever
 * the tag held. Resolves once the write has succeeded. Abort the signal to stop
 * waiting for a tag; that rejects with code "cancelled".
 */
export async function writeUrlToTag(url: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  const Reader = readerConstructor();
  if (typeof window !== "undefined" && Reader && window.isSecureContext !== true) {
    throw nfcError("insecure_context");
  }
  if (!Reader || !isWebNfcSupported()) throw nfcError("not_supported");
  if (!/^https:\/\/\S+$/i.test(url)) throw nfcError("invalid_url");
  if (opts.signal?.aborted) throw nfcError("cancelled");

  try {
    const reader = new Reader();
    await reader.write(
      { records: [{ recordType: "url", data: url }] },
      { overwrite: true, signal: opts.signal },
    );
  } catch (error) {
    throw opts.signal?.aborted ? nfcError("cancelled") : mapError(error);
  }
}

/** True for a write the member cancelled, which needs no error message. */
export function isNfcCancelled(error: unknown): boolean {
  return error instanceof NfcWriteError && error.code === "cancelled";
}

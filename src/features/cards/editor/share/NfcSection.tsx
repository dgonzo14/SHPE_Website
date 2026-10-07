import { useEffect, useRef, useState } from "react";
import { Copy, Nfc, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { formatDate } from "@/lib/datetime";
import { cardUrl } from "@/services/cards";
import { copyText } from "../../share";
import { NfcWriteError, isNfcCancelled, isWebNfcSupported, writeUrlToTag } from "../../webNfc";

type WriteState =
  | { status: "idle" }
  | { status: "waiting" }
  | { status: "done" }
  | { status: "error"; message: string };

/** Where an officer's record says the member's chip points. */
function ChipStatus({
  handle,
  chipHandle,
  chipHandleActive,
  chipWrittenAt,
}: {
  handle: string;
  chipHandle: string | null;
  chipHandleActive: boolean | null;
  chipWrittenAt: string | null;
}) {
  if (!chipHandle) {
    return (
      <p className="text-sm text-gray-600">
        No chip recorded yet. Officers record the chips they write at card night; chips you write
        yourself aren't recorded here.
      </p>
    );
  }
  const written = chipWrittenAt ? ` on ${formatDate(chipWrittenAt)}` : "";
  if (chipHandle === handle) {
    return (
      <Alert tone="success" title={`Your chip was written${written}`}>
        It opens <span className="break-all font-mono">{cardUrl(chipHandle, "nfc")}</span>, your
        current card. There's no need to rewrite it.
      </Alert>
    );
  }
  if (chipHandleActive === false) {
    // A removed handle is free for anyone else to claim, so the chip may now
    // open a stranger's card, not just an error page. Saying so is what makes
    // rewriting it feel as urgent as it is.
    return (
      <Alert tone="danger" title="Your chip no longer opens your card">
        It was written{written} with{" "}
        <span className="break-all font-mono">{cardUrl(chipHandle, "nfc")}</span>, a handle an
        officer removed from your card. A tap now shows “card not available”, or another member's
        card if someone has claimed that handle since. Rewrite the chip below, or ask an officer to
        at the next card night.
      </Alert>
    );
  }
  return (
    <Alert tone="info" title="Your chip points to your old handle">
      It was written{written} with <span className="break-all font-mono">{cardUrl(chipHandle, "nfc")}</span>.
      Old handles redirect to your current card, so it keeps working. To point it straight at{" "}
      <span className="font-mono">{handle}</span>, rewrite it below.
    </Alert>
  );
}

/**
 * Getting the card onto the member's NFC chip.
 *
 * Chrome on Android can write it from the page (Web NFC). Everywhere else,
 * notably every iPhone, the free NFC Tools app does it from a copied link, and
 * officers write chips for everyone at card night anyway. Either way the chip
 * gets the ?src=nfc address, so Insights can tell taps from scans and links.
 */
export function NfcSection({
  handle,
  chipHandle,
  chipHandleActive = null,
  chipWrittenAt,
}: {
  handle: string;
  chipHandle: string | null;
  /** false when an officer removed the chip's handle from the card, so the chip no longer opens it. */
  chipHandleActive?: boolean | null;
  chipWrittenAt: string | null;
}) {
  const toast = useToast();
  const chipUrl = cardUrl(handle, "nfc");
  // Checked once: support doesn't change while the page is open.
  const [supported] = useState(isWebNfcSupported);
  const [state, setState] = useState<WriteState>({ status: "idle" });

  const controllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Focus only follows the member's own actions, never the first render.
  const moveFocus = useRef(false);

  // Leaving the tab mid-write stops waiting for a tag.
  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const target = state.status === "waiting" ? "cancel" : state.status === "idle" ? "start" : "result";
    containerRef.current?.querySelector<HTMLElement>(`[data-nfc-focus="${target}"]`)?.focus();
  }, [state.status]);

  const write = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    moveFocus.current = true;
    setState({ status: "waiting" });
    try {
      await writeUrlToTag(chipUrl, { signal: controller.signal });
      if (controllerRef.current !== controller) return;
      moveFocus.current = true;
      setState({ status: "done" });
    } catch (error) {
      if (controllerRef.current !== controller) return;
      moveFocus.current = true;
      if (isNfcCancelled(error)) {
        setState({ status: "idle" });
      } else {
        setState({
          status: "error",
          message:
            error instanceof NfcWriteError ? error.message : "Something went wrong writing the card. Try again.",
        });
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const cancel = () => controllerRef.current?.abort();

  const copyChipLink = async () => {
    if (await copyText(chipUrl)) toast.success("Chip link copied", "Paste it into NFC Tools as a URL record.");
    else toast.error("Couldn't copy the link", "Select the link above and copy it yourself.");
  };

  return (
    <div ref={containerRef} className="space-y-5">
      <ChipStatus
        handle={handle}
        chipHandle={chipHandle}
        chipHandleActive={chipHandleActive}
        chipWrittenAt={chipWrittenAt}
      />

      <div className="space-y-2">
        <p className="text-sm font-medium text-shpe-navy">Your chip address</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all border border-shpe-rule bg-shpe-navy-soft px-3 py-2.5 text-sm text-shpe-navy">
            {chipUrl}
          </code>
          <Button variant="subtle" onClick={() => void copyChipLink()}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy chip link
          </Button>
        </div>
      </div>

      {supported ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-shpe-navy">Write it from this phone</h4>
          {state.status === "waiting" ? (
            <div className="space-y-3 border border-shpe-navy bg-shpe-navy-soft p-4">
              <p role="status" className="flex items-start gap-2 text-sm text-shpe-navy">
                <Smartphone className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>
                  Hold your card flat against the back of your phone, near the camera, and keep it
                  there until this says it's done.
                </span>
              </p>
              <Button variant="subtle" onClick={cancel} data-nfc-focus="cancel">
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                This replaces whatever is on the chip. Make sure NFC is turned on in your phone's
                settings.
              </p>
              <Button onClick={() => void write()} data-nfc-focus="start">
                <Nfc className="h-4 w-4" aria-hidden="true" />
                {state.status === "idle" ? "Write to my NFC card" : "Write again"}
              </Button>
            </>
          )}
          {state.status === "done" && (
            <div data-nfc-focus="result" tabIndex={-1} className="focus-visible:outline-[3px] focus-visible:outline-shpe-navy">
              <Alert tone="success" title="Your card is written">
                Tap it against your phone to check that it opens your card.
              </Alert>
            </div>
          )}
          {state.status === "error" && (
            <div data-nfc-focus="result" tabIndex={-1} className="focus-visible:outline-[3px] focus-visible:outline-shpe-navy">
              <Alert tone="danger" title="The card wasn't written">
                {state.message}
              </Alert>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-shpe-navy">On an iPhone</h4>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
              <li>
                Install <strong>NFC Tools</strong> (free) from the App Store.
              </li>
              <li>Tap <strong>Copy chip link</strong> above.</li>
              <li>
                In NFC Tools, tap <strong>Write</strong>, then <strong>Add a record</strong>, then{" "}
                <strong>URL</strong>. Paste the link and tap <strong>OK</strong>.
              </li>
              <li>
                Tap <strong>Write</strong> and hold the top of your iPhone against your card until it
                confirms.
              </li>
            </ol>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-shpe-navy">On Android</h4>
            <p className="mt-1 text-sm text-gray-700">
              Open this page in Chrome to write your card with one tap, or use NFC Tools the same way
              as on an iPhone.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-shpe-navy">At card night</h4>
            <p className="mt-1 text-sm text-gray-700">
              Officers write chips for everyone at card night, so you can also just bring your card.
            </p>
          </div>
        </div>
      )}

      <Alert tone="info" title="Protect your chip after writing it">
        An unprotected chip can be rewritten by any phone, which could turn your card into someone
        else's link. In NFC Tools, open <strong>Other</strong> and choose <strong>Set password</strong>.
        Keep the password somewhere safe: you'll need it to change the chip later.
      </Alert>
    </div>
  );
}

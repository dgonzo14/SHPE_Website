import { useState } from "react";
import { Contact, Copy, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, Input } from "@/components/ui/primitives";
import { EmptyState } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { errorText } from "@/lib/errors";
import { cardUrl } from "@/services/cards";
import type { MemberCard, PublicCardData } from "@/types/database";
import { canNativeShare, copyText, shareCard } from "../../share";
import { DesignSection } from "../design/parts";
import { NfcSection } from "./NfcSection";
import { QrSection } from "./QrSection";

interface ShareTabProps {
  /** The saved card, or null before the first save. */
  card: MemberCard | null;
  /** The editor's current state as the renderer sees it, unsaved changes included. */
  preview: PublicCardData;
  isDirty: boolean;
}

/**
 * The Share tab: the card's link, its QR code, the NFC chip, and a test of
 * Add to Contacts.
 *
 * Everything that points at the card uses the SAVED handle, because that is
 * the one that resolves; a handle typed into the editor but not saved yet
 * doesn't exist. The vCard test is the exception: it is built from the
 * preview, so a member can check unsaved contact details before publishing.
 */
export function ShareTab({ card, preview, isDirty }: ShareTabProps) {
  if (!card) {
    return (
      <EmptyState
        icon={Share2}
        title="Save your card first"
        description="Your link, QR code and NFC chip tools appear here once your card is saved."
      />
    );
  }
  return <ShareTools card={card} preview={preview} isDirty={isDirty} />;
}

function ShareTools({ card, preview, isDirty }: ShareTabProps & { card: MemberCard }) {
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  // Checked once: the share sheet doesn't appear or vanish while the page is open.
  const [nativeShare] = useState(canNativeShare);

  const link = cardUrl(card.handle);
  const handleChanging = preview.handle !== "" && preview.handle !== card.handle;

  const copy = async () => {
    if (await copyText(link)) toast.success("Link copied", "Paste it anywhere you'd share a link.");
    else toast.error("Couldn't copy the link", "Select the link and copy it yourself.");
  };

  const share = async () => {
    setSharing(true);
    try {
      const result = await shareCard({
        url: link,
        title: `${card.display_name} · WashU SHPE`,
        text: "My WashU SHPE business card",
      });
      if (result === "copied") toast.success("Link copied", "Your browser couldn't open a share sheet, so the link was copied instead.");
      else if (result === "failed") toast.error("Couldn't share the link", "Select the link and copy it yourself.");
    } finally {
      setSharing(false);
    }
  };

  const testContact = async () => {
    setSavingContact(true);
    try {
      // Loaded on demand: the vCard builder is only needed when someone taps this.
      const { downloadVCard } = await import("../../vcard");
      await downloadVCard(preview, { cardUrl: link });
    } catch (error) {
      toast.error("Couldn't make the contact file", errorText(error));
    } finally {
      setSavingContact(false);
    }
  };

  return (
    <div className="space-y-8">
      {(card.hidden_at || !card.is_published || isDirty || handleChanging) && (
        <div className="space-y-3">
          {card.hidden_at ? (
            <Alert tone="danger" title="Your card is hidden">
              An officer has hidden your card, so this link shows a “card not available” page until
              they restore it.
            </Alert>
          ) : (
            !card.is_published && (
              <Alert tone="info" title="Your card isn't published yet">
                Only you can see the preview until you publish it. Anyone else who opens your link,
                scans your QR code or taps your chip sees a “card not available” page.
              </Alert>
            )
          )}
          {isDirty && (
            <Alert tone="warning" title="You have unsaved changes">
              {handleChanging ? (
                <>
                  They aren't live yet. Your link, QR code and chip below still use{" "}
                  <span className="font-mono">{card.handle}</span> until you save your new handle,{" "}
                  <span className="font-mono">{preview.handle}</span>.
                </>
              ) : (
                <>They aren't live yet: save to update your card. Your link and QR code stay the same.</>
              )}
            </Alert>
          )}
        </div>
      )}

      <DesignSection
        title="Your link"
        description="The address of your card. Text it, put it in your email signature or on LinkedIn."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            value={link}
            aria-label="Your card's link"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void copy()} className="flex-1 sm:flex-none">
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy link
            </Button>
            {nativeShare && (
              <Button variant="outline" onClick={() => void share()} loading={sharing} className="flex-1 sm:flex-none">
                {!sharing && <Share2 className="h-4 w-4" aria-hidden="true" />}
                Share
              </Button>
            )}
          </div>
        </div>
      </DesignSection>

      <DesignSection
        title="QR code"
        description="For slides, posters, your laptop sticker, or anyone whose phone doesn't do NFC."
      >
        <QrSection handle={card.handle} displayName={card.display_name} theme={preview.theme} />
      </DesignSection>

      <DesignSection title="NFC card" description="Put your card on the chip, so a tap opens it.">
        <NfcSection
          handle={card.handle}
          chipHandle={card.chip_handle}
          chipHandleActive={card.chip_handle_active}
          chipWrittenAt={card.chip_written_at}
        />
      </DesignSection>

      <DesignSection
        title="Test Add to Contacts"
        description="Download the contact file a visitor gets when they tap Add to Contacts. It's built from what's in the editor now, unsaved changes included."
      >
        <Button variant="subtle" onClick={() => void testContact()} loading={savingContact}>
          {!savingContact && <Contact className="h-4 w-4" aria-hidden="true" />}
          Download contact file
        </Button>
      </DesignSection>
    </div>
  );
}

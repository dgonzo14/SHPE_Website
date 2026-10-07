import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test/renderWithProviders";
import type { MemberCard, PublicCardData } from "@/types/database";
import { NfcWriteError } from "../../../webNfc";
import { ShareTab } from "../ShareTab";

const SITE = "https://washushpe.org";

vi.mock("@/services/cards", () => ({
  cardUrl: (handle: string, source?: string) =>
    `${SITE}/card/${handle}${source && source !== "link" ? `?src=${source}` : ""}`,
}));

const share = vi.hoisted(() => ({
  canNativeShare: vi.fn(() => false),
  copyText: vi.fn(async () => true),
  shareCard: vi.fn(async () => "shared" as const),
}));
vi.mock("../../../share", () => share);

const qr = vi.hoisted(() => ({
  qrSvg: vi.fn((text: string, opts?: { fg?: string; bg?: string }) => `<svg data-text="${text}" data-fg="${opts?.fg}" data-bg="${opts?.bg}"/>`),
  qrPngBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
  downloadBlob: vi.fn(),
}));
vi.mock("../../../qr", () => qr);

const nfc = vi.hoisted(() => ({
  isWebNfcSupported: vi.fn(() => false),
  writeUrlToTag: vi.fn<(url: string, opts?: { signal?: AbortSignal }) => Promise<void>>(),
}));
vi.mock("../../../webNfc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../webNfc")>()),
  isWebNfcSupported: () => nfc.isWebNfcSupported(),
  writeUrlToTag: (url: string, opts?: { signal?: AbortSignal }) => nfc.writeUrlToTag(url, opts),
}));

const vcard = vi.hoisted(() => ({ downloadVCard: vi.fn(async () => {}) }));
vi.mock("../../../vcard", () => vcard);

const MEMBER = "11111111-1111-4111-8111-111111111111";

const card: MemberCard = {
  member_id: MEMBER,
  handle: "ana-rivera",
  is_published: true,
  allow_indexing: false,
  hidden_at: null,
  hidden_reason: null,
  created_by_officer: false,
  member_opened_at: "2026-09-20T15:00:00Z",
  chip_handle: null,
  chip_handle_active: null,
  chip_written_at: null,
  display_name: "Ana Rivera",
  pronouns: null,
  headline: null,
  organization: "Washington University in St. Louis",
  status_line: null,
  bio: null,
  location: null,
  skills: [],
  languages: [],
  avatar_path: null,
  banner_path: null,
  background_path: null,
  show_major: true,
  show_graduation_year: true,
  show_member_since: false,
  show_national_member: true,
  show_chapter_position: true,
  theme: { preset: "shpe-classic" },
  sections: ["status", "links"],
  created_at: "2026-09-20T15:00:00Z",
  updated_at: "2026-09-20T15:00:00Z",
};

const preview: PublicCardData = {
  handle: "ana-rivera",
  display_name: "Ana Rivera",
  pronouns: null,
  headline: null,
  organization: "Washington University in St. Louis",
  status_line: null,
  bio: null,
  location: null,
  skills: [],
  languages: [],
  avatar_path: null,
  banner_path: null,
  background_path: null,
  theme: { preset: "shpe-classic" },
  sections: ["status", "links"],
  allow_indexing: false,
  is_starter: false,
  education: null,
  shpe: { position: null, member_since: null, national_member_verified: false, is_alumni: false },
  links: [{ id: "l1", kind: "email", label: null, value: "ana@example.com", is_featured: false }],
};

function setup(props: { card?: MemberCard | null; preview?: PublicCardData; isDirty?: boolean } = {}) {
  const user = userEvent.setup();
  renderWithProviders(
    <ShareTab
      card={props.card === undefined ? card : props.card}
      preview={props.preview ?? preview}
      isDirty={props.isDirty ?? false}
    />,
    { route: "/portal/card" },
  );
  return { user };
}

beforeEach(() => {
  share.canNativeShare.mockReturnValue(false);
  share.copyText.mockResolvedValue(true);
  share.shareCard.mockResolvedValue("shared");
  nfc.isWebNfcSupported.mockReturnValue(false);
});

describe("ShareTab", () => {
  it("asks for a save first when there is no card", () => {
    setup({ card: null });
    expect(screen.getByText("Save your card first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
    expect(qr.qrSvg).not.toHaveBeenCalled();
  });

  it("shows the saved card's link and copies it", async () => {
    const { user } = setup();
    expect(screen.getByLabelText("Your card's link")).toHaveValue(`${SITE}/card/ana-rivera`);

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(share.copyText).toHaveBeenCalledWith(`${SITE}/card/ana-rivera`);
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("says so when copying fails", async () => {
    share.copyText.mockResolvedValue(false);
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument();
  });

  it("offers the share sheet only where there is one", async () => {
    setup();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("opens the share sheet with the card's link", async () => {
    share.canNativeShare.mockReturnValue(true);
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(share.shareCard).toHaveBeenCalledWith({
      url: `${SITE}/card/ana-rivera`,
      title: "Ana Rivera · WashU SHPE",
      text: "My WashU SHPE business card",
    });
  });

  it("explains an unpublished card, and unsaved changes", () => {
    setup({ card: { ...card, is_published: false }, isDirty: true });
    expect(screen.getByText("Your card isn't published yet")).toBeInTheDocument();
    expect(screen.getByText(/Only you can see the preview until you publish it/)).toBeInTheDocument();
    expect(screen.getByText("You have unsaved changes")).toBeInTheDocument();
    expect(screen.getByText(/They aren't live yet/)).toBeInTheDocument();
  });

  it("points out that a new handle isn't live until it's saved", () => {
    setup({ preview: { ...preview, handle: "ana-r" }, isDirty: true });
    const alert = screen.getByText("You have unsaved changes").closest("[role=status]") as HTMLElement;
    expect(within(alert).getByText("ana-rivera")).toBeInTheDocument();
    expect(within(alert).getByText("ana-r")).toBeInTheDocument();
    // Everything still points at the saved handle.
    expect(screen.getByLabelText("Your card's link")).toHaveValue(`${SITE}/card/ana-rivera`);
  });

  it("warns when an officer has hidden the card", () => {
    setup({ card: { ...card, hidden_at: "2026-10-01T00:00:00Z", hidden_reason: "Spam" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Your card is hidden");
  });
});

describe("ShareTab: QR code", () => {
  it("draws the ?src=qr address in the card's colors, as an image", () => {
    setup();
    expect(qr.qrSvg).toHaveBeenLastCalledWith(
      `${SITE}/card/ana-rivera?src=qr`,
      expect.objectContaining({ fg: "#1b365d", bg: "#ffffff" }),
    );
    const img = screen.getByRole("img", { name: /QR code that opens your card/ });
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain('data-fg="#1b365d"');
  });

  it("switches to black and white", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "Black and white" }));
    expect(qr.qrSvg).toHaveBeenLastCalledWith(
      `${SITE}/card/ana-rivera?src=qr`,
      expect.objectContaining({ fg: "#000000", bg: "#ffffff" }),
    );
  });

  it("downloads the SVG and the PNG", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Download SVG" }));
    const [svgBlob, svgName] = qr.downloadBlob.mock.calls[0];
    expect(svgName).toBe("ana-rivera-qr.svg");
    expect((svgBlob as Blob).type).toBe("image/svg+xml");
    expect(await (svgBlob as Blob).text()).toContain("?src=qr");

    await user.click(screen.getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(qr.downloadBlob).toHaveBeenCalledTimes(2));
    expect(qr.qrPngBlob).toHaveBeenCalledWith(
      `${SITE}/card/ana-rivera?src=qr`,
      expect.objectContaining({ fg: "#1b365d", bg: "#ffffff", margin: 4 }),
    );
    expect(qr.downloadBlob.mock.calls[1][1]).toBe("ana-rivera-qr.png");
  });

  it("explains a PNG that couldn't be made", async () => {
    qr.qrPngBlob.mockRejectedValueOnce(new Error("Your browser couldn't draw the QR code. Try the SVG download instead."));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Download PNG" }));
    expect(await screen.findByText("Couldn't make the PNG")).toBeInTheDocument();
    expect(qr.downloadBlob).not.toHaveBeenCalled();
  });
});

describe("ShareTab: NFC", () => {
  it("gives iPhone and card-night instructions without Web NFC, and copies the chip link", async () => {
    const { user } = setup();
    expect(screen.queryByRole("button", { name: "Write to my NFC card" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "On an iPhone" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "At card night" })).toBeInTheDocument();
    expect(screen.getByText("Protect your chip after writing it")).toBeInTheDocument();
    expect(screen.getByText(`${SITE}/card/ana-rivera?src=nfc`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy chip link" }));
    expect(share.copyText).toHaveBeenCalledWith(`${SITE}/card/ana-rivera?src=nfc`);
    expect(await screen.findByText("Chip link copied")).toBeInTheDocument();
  });

  it("writes the ?src=nfc address with Web NFC", async () => {
    nfc.isWebNfcSupported.mockReturnValue(true);
    let finish!: () => void;
    nfc.writeUrlToTag.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = setup();
    expect(screen.queryByRole("heading", { name: "On an iPhone" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Write to my NFC card" }));

    expect(nfc.writeUrlToTag).toHaveBeenCalledWith(
      `${SITE}/card/ana-rivera?src=nfc`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(/Hold your card flat against the back of your phone/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    finish();
    expect(await screen.findByText("Your card is written")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write again" })).toBeInTheDocument();
  });

  it("cancels a write through its AbortController", async () => {
    nfc.isWebNfcSupported.mockReturnValue(true);
    nfc.writeUrlToTag.mockImplementation(
      (_url, opts) =>
        new Promise<void>((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () =>
            reject(new NfcWriteError("cancelled", "Writing was cancelled.")),
          );
        }),
    );
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Write to my NFC card" }));
    const signal = nfc.writeUrlToTag.mock.calls[0][1]?.signal;
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: "Write to my NFC card" })).toHaveFocus();
    expect(screen.queryByText("The card wasn't written")).not.toBeInTheDocument();
  });

  it("shows why a write failed", async () => {
    nfc.isWebNfcSupported.mockReturnValue(true);
    nfc.writeUrlToTag.mockRejectedValue(
      new NfcWriteError("not_writable", "That chip can't be written. It may be locked or password-protected; ask an officer to rewrite it."),
    );
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Write to my NFC card" }));

    expect(await screen.findByText("The card wasn't written")).toBeInTheDocument();
    expect(screen.getByText(/It may be locked or password-protected/)).toBeInTheDocument();
  });

  it("reports the chip an officer recorded", () => {
    setup({ card: { ...card, chip_handle: "ana-rivera", chip_written_at: "2026-10-01T23:00:00Z" } });
    expect(screen.getByText("Your chip was written on October 1, 2026")).toBeInTheDocument();
  });

  it("warns when the chip carries an old handle", () => {
    setup({ card: { ...card, chip_handle: "ana", chip_written_at: "2026-10-01T23:00:00Z" } });
    expect(screen.getByText("Your chip points to your old handle")).toBeInTheDocument();
    expect(screen.getByText(`${SITE}/card/ana?src=nfc`)).toBeInTheDocument();
  });

  it("says plainly when the chip's handle was reset and the chip is dead", () => {
    setup({
      card: {
        ...card,
        chip_handle: "ana",
        chip_handle_active: false,
        chip_written_at: "2026-10-01T23:00:00Z",
      },
    });
    const alert = screen.getByText("Your chip no longer opens your card").closest("[role=alert], [role=status]");
    expect(screen.queryByText("Your chip points to your old handle")).not.toBeInTheDocument();
    // Freed handles can be claimed by someone else, so a tap may open their card.
    expect(alert).toHaveTextContent(/A tap now shows \u201ccard not available\u201d/);
    expect(alert).toHaveTextContent(/or another member's card if someone has claimed that handle since/);
    expect(alert).not.toHaveTextContent(/opens nothing/);
  });

  it("says when no chip is recorded", () => {
    setup();
    expect(screen.getByText(/No chip recorded yet/)).toBeInTheDocument();
  });
});

describe("ShareTab: Add to Contacts test", () => {
  it("downloads the vCard built from the preview", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Download contact file" }));
    await waitFor(() =>
      expect(vcard.downloadVCard).toHaveBeenCalledWith(preview, { cardUrl: `${SITE}/card/ana-rivera` }),
    );
  });

  it("explains a contact file that couldn't be made", async () => {
    vcard.downloadVCard.mockRejectedValueOnce(new Error("boom"));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Download contact file" }));
    expect(await screen.findByText("Couldn't make the contact file")).toBeInTheDocument();
  });
});

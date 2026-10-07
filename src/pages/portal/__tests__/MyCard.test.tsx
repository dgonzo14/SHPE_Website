import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseFormReturn } from "react-hook-form";

import { MyCard } from "../MyCard";
import { renderWithProviders } from "@/test/renderWithProviders";
import { queryKeys } from "@/services/queryKeys";
import type { AuthContextValue } from "@/auth/authContext";
import { formValuesToInput, cardToFormValues } from "@/features/cards/viewModel";
import type { CardFormValues } from "@/lib/validation";
import type {
  CardLink,
  CardLinkInput,
  CardProfileFields,
  HandleAvailability,
  MemberCard,
  MemberCardInput,
  MyCardResponse,
  MyCardState,
  PublicCardData,
} from "@/types/database";

/*
 * The page with the database replaced by a small in-memory stand-in, so the
 * save → reset → refetch cycle runs as it would for real. The renderer, the
 * image uploader and the Design/Share/Insights tabs (other agents' work, with
 * their own tests) are stubs that expose just enough to drive the editor.
 */

const MEMBER = "11111111-1111-4111-8111-111111111111";
const OLD_AVATAR = `${MEMBER}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
const NEW_AVATAR = `${MEMBER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`;

const api = vi.hoisted(() => ({
  fetchMyCard: vi.fn<() => Promise<MyCardResponse>>(),
  suggestMyCardHandle: vi.fn<() => Promise<string | null>>(),
  checkCardHandle: vi.fn<(handle: string) => Promise<HandleAvailability>>(),
  saveMyCard: vi.fn<(card: MemberCardInput, links: CardLinkInput[]) => Promise<MyCardState>>(),
  setMyCardPublished: vi.fn<(published: boolean) => Promise<MyCardState>>(),
  removeCardImages: vi.fn<(paths: (string | null | undefined)[]) => Promise<void>>(),
}));

vi.mock("@/services/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cards")>()),
  ...api,
}));

vi.mock("@/features/cards/BusinessCard", () => ({
  BusinessCard: ({ card }: { card: PublicCardData }) => (
    <div data-testid="card-preview">
      {card.display_name} | {card.headline ?? ""} | {card.links.map((l) => l.kind).join(",")} | pos=
      {card.shpe?.position ?? "none"} | major={card.education?.major ?? "none"}
    </div>
  ),
}));

vi.mock("@/features/cards/ImageField", () => ({
  ImageField: ({ label, onChange }: { label: string; onChange: (path: string | null) => void }) => (
    <button
      type="button"
      onClick={() =>
        onChange(`${"11111111-1111-4111-8111-111111111111"}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`)
      }
    >
      Upload {label.toLowerCase()}
    </button>
  ),
}));

vi.mock("@/features/cards/editor/design/DesignTab", () => ({
  DesignTab: ({ form }: { form: UseFormReturn<CardFormValues> }) => (
    <div>
      <p>Design tab</p>
      <button
        type="button"
        onClick={() =>
          form.setValue(
            "theme",
            { preset: "shpe-classic", colors: { text: "#ffffff", surface: "#ffffff" } },
            { shouldDirty: true },
          )
        }
      >
        Use unreadable colors
      </button>
    </div>
  ),
}));

vi.mock("@/features/cards/editor/share/ShareTab", () => ({
  ShareTab: ({ card, isDirty }: { card: MemberCard | null; isDirty: boolean }) => (
    <p>
      Share tab for {card ? card.handle : "no card"}, {isDirty ? "unsaved" : "saved"}
    </p>
  ),
}));

vi.mock("@/features/cards/editor/insights/InsightsTab", () => ({
  InsightsTab: ({ hasCard }: { hasCard: boolean }) => <p>Insights tab, has card: {String(hasCard)}</p>,
}));

/* ── Fixtures and the stand-in database ─────────────────────────────────── */

const PROFILE: CardProfileFields = {
  first_name: "Ana",
  last_name: "Rivera",
  major: "Computer Science",
  secondary_major: null,
  graduation_year: 2028,
  degree_level: "undergraduate",
  member_since: "2025-08-25",
  national_member_verified: false,
  membership_status: "active",
};

function memberCard(overrides: Partial<MemberCard> = {}): MemberCard {
  return {
    member_id: MEMBER,
    handle: "ana-rivera",
    is_published: false,
    allow_indexing: false,
    hidden_at: null,
    hidden_reason: null,
    created_by_officer: false,
    member_opened_at: "2026-09-20T15:00:00.000Z",
    chip_handle: null,
    chip_handle_active: null,
    chip_written_at: null,
    display_name: "Ana Rivera",
    pronouns: "she/her",
    headline: "CS student",
    organization: "Washington University in St. Louis",
    status_line: null,
    bio: null,
    location: null,
    skills: ["Python"],
    languages: [],
    avatar_path: OLD_AVATAR,
    banner_path: null,
    background_path: null,
    show_major: true,
    show_graduation_year: true,
    show_member_since: false,
    show_national_member: true,
    show_chapter_position: true,
    theme: { preset: "shpe-classic" },
    sections: ["status", "featured", "links", "about", "education", "shpe"],
    created_at: "2026-09-20T15:00:00.000Z",
    updated_at: "2026-09-20T15:00:00.000Z",
    ...overrides,
  };
}

const LINKEDIN: CardLink = {
  id: "44444444-4444-4444-8444-444444444444",
  kind: "linkedin",
  label: null,
  value: "https://www.linkedin.com/in/ana-rivera",
  sort_order: 0,
  is_featured: false,
  is_visible: true,
};

let server: MyCardState;
let nextLinkId = 0;

function setServer(overrides: Partial<MyCardState> = {}) {
  server = { enabled: true, card: null, links: [], position: null, profile: PROFILE, ...overrides };
}

beforeEach(() => {
  nextLinkId = 0;
  setServer({ card: memberCard(), links: [LINKEDIN] });
  api.fetchMyCard.mockImplementation(async () => structuredClone(server));
  api.suggestMyCardHandle.mockResolvedValue("ana-rivera");
  api.checkCardHandle.mockResolvedValue("available");
  api.removeCardImages.mockResolvedValue();
  // Like save_my_card(): store what was sent, give new links ids, return the card.
  api.saveMyCard.mockImplementation(async (input, links) => {
    const card: MemberCard = {
      ...(server.card ?? memberCard({ created_at: "2026-10-06T12:00:00.000Z" })),
      ...input,
      member_opened_at: server.card?.member_opened_at ?? "2026-10-06T12:00:00.000Z",
      updated_at: "2026-10-06T12:00:00.000Z",
    };
    server = {
      ...server,
      card,
      links: links.map((link, index) => ({
        id: link.id ?? `99999999-9999-4999-8999-${String(++nextLinkId).padStart(12, "0")}`,
        kind: link.kind,
        label: link.label,
        value: link.value,
        sort_order: index,
        is_featured: link.is_featured,
        is_visible: link.is_visible,
      })),
    };
    return structuredClone(server);
  });
  api.setMyCardPublished.mockImplementation(async (published) => {
    if (!server.card) throw { code: "22023", message: "Save your card first" };
    server = { ...server, card: { ...server.card, is_published: published } };
    return structuredClone(server);
  });
});

function renderPage(auth: Partial<AuthContextValue> = {}) {
  const user = userEvent.setup();
  const utils = renderWithProviders(<MyCard />, { route: "/portal/card", auth });
  return { user, ...utils };
}

const saveButton = () => screen.getByRole("button", { name: /^save (changes|my card)$/i });
const publishSwitch = () => screen.getByRole("switch", { name: "Publish my card" });

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("My Card: switched off", () => {
  it("explains calmly that business cards aren't open yet", async () => {
    api.fetchMyCard.mockResolvedValue({ enabled: false });
    renderPage();

    expect(await screen.findByText("Business cards aren't open yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute(
      "href",
      "/portal",
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(api.suggestMyCardHandle).not.toHaveBeenCalled();
  });

  it("lets an officer set up their card before launch, and says nobody can see it yet", async () => {
    setServer({ enabled: false, card: memberCard(), links: [] });
    renderPage({ isOfficer: true, roles: ["member", "officer"] });

    expect(await screen.findByText("Business cards are switched off for members")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin › Cards" })).toHaveAttribute("href", "/admin/cards");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});

describe("My Card: loading fails", () => {
  it("offers a retry when the card can't be loaded at all", async () => {
    api.fetchMyCard.mockRejectedValue(new Error("offline"));
    const { user } = renderPage();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    api.fetchMyCard.mockImplementation(async () => structuredClone(server));
    await user.click(retry);
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
  });
});

describe("My Card: a member's first card", () => {
  beforeEach(() => setServer({ card: null, links: [] }));

  it("starts from the profile name and the suggested handle, and checks it", async () => {
    renderPage();

    const handle = await screen.findByLabelText(/^handle/i);
    expect(handle).toHaveValue("ana-rivera");
    expect(screen.getByLabelText(/name on your card/i)).toHaveValue("Ana Rivera");
    expect(screen.getByText("Set up your card")).toBeInTheDocument();
    expect(await screen.findByText("Available. Saving your card claims it.")).toBeInTheDocument();
    expect(api.checkCardHandle).toHaveBeenCalledWith("ana-rivera");
    expect(screen.getAllByTestId("card-preview")[0]).toHaveTextContent("Ana Rivera");
  });

  it("can't be published until it has been saved", async () => {
    const { user } = renderPage();
    await screen.findByLabelText(/^handle/i);

    expect(publishSwitch()).toBeDisabled();
    expect(screen.getByText("Save your card first. Then you can publish it.")).toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(() => expect(publishSwitch()).toBeEnabled());
    expect(api.saveMyCard).toHaveBeenCalledTimes(1);
    expect(api.saveMyCard.mock.calls[0][0]).toMatchObject({
      handle: "ana-rivera",
      display_name: "Ana Rivera",
    });
    expect(await screen.findByText("Your card is saved")).toBeInTheDocument();
  });

  it("falls back to an empty handle when no suggestion comes back", async () => {
    api.suggestMyCardHandle.mockRejectedValue(new Error("offline"));
    renderPage();

    expect(await screen.findByLabelText(/^handle/i)).toHaveValue("");
  });
});

describe("My Card: an existing card", () => {
  it("loads the stored card and its links", async () => {
    const { user } = renderPage();

    expect(await screen.findByLabelText(/^handle/i)).toHaveValue("ana-rivera");
    expect(screen.getByText("This is your card's current address.")).toBeInTheDocument();
    expect(screen.getByLabelText("Headline")).toHaveValue("CS student");
    expect(screen.getByLabelText("Pronouns")).toHaveValue("she/her");
    expect(screen.getByRole("list", { name: "Your skills" })).toHaveTextContent("Python");
    expect(screen.getByText("Your card is a draft")).toBeInTheDocument();
    // The current handle is never sent off to be checked.
    expect(api.checkCardHandle).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Links" }));
    expect(screen.getByLabelText("LinkedIn link")).toHaveValue(LINKEDIN.value);
  });

  it("saves exactly what save_my_card expects, then resets to what came back", async () => {
    const { user } = renderPage();
    const headline = await screen.findByLabelText("Headline");

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();

    await user.clear(headline);
    await user.type(headline, "  SWE intern at Boeing ");
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(() => expect(api.saveMyCard).toHaveBeenCalledTimes(1));
    const expected = formValuesToInput({
      ...cardToFormValues(memberCard(), [LINKEDIN]),
      headline: "  SWE intern at Boeing ",
      avatar_path: NEW_AVATAR,
    });
    expect(api.saveMyCard).toHaveBeenCalledWith(expected.card, expected.links);
    expect(expected.card.headline).toBe("SWE intern at Boeing");
    expect(expected.links[0].id).toBe(LINKEDIN.id);

    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    expect(screen.getByLabelText("Headline")).toHaveValue("SWE intern at Boeing");
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    // The photo it replaced is cleaned up; the new one is kept.
    expect(api.removeCardImages).toHaveBeenCalledWith([OLD_AVATAR]);
  });

  it("keeps the ids the database gives new links, so the next save updates them", async () => {
    const { user } = renderPage();
    await screen.findByLabelText(/^handle/i);
    await user.click(screen.getByRole("tab", { name: "Links" }));

    await user.click(screen.getByRole("button", { name: "Add a link" }));
    await user.click(screen.getByRole("button", { name: "Add GitHub" }));
    await user.type(screen.getByLabelText("GitHub link"), "ana-codes");
    await user.click(saveButton());
    await waitFor(() => expect(api.saveMyCard).toHaveBeenCalledTimes(1));
    expect(api.saveMyCard.mock.calls[0][1][1]).toMatchObject({
      id: null,
      kind: "github",
      value: "https://github.com/ana-codes",
    });
    await screen.findByText("All changes saved.");

    await user.type(screen.getByLabelText("GitHub link"), "-2");
    await user.click(saveButton());
    await waitFor(() => expect(api.saveMyCard).toHaveBeenCalledTimes(2));
    expect(api.saveMyCard.mock.calls[1][1][1]).toMatchObject({
      id: "99999999-9999-4999-8999-000000000001",
      kind: "github",
    });
  });

  it("refuses to save unreadable colors and points to the Design tab", async () => {
    const { user } = renderPage();
    await screen.findByLabelText(/^handle/i);

    await user.click(screen.getByRole("tab", { name: "Design" }));
    await user.click(screen.getByRole("button", { name: "Use unreadable colors" }));
    expect(screen.getByRole("tab", { name: "Design, needs attention" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /content/i }));
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/too hard to read/i);
    expect(api.saveMyCard).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Fix colors on Design" }));
    expect(screen.getByRole("tab", { name: /design/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Design tab")).toBeInTheDocument();
  });

  it("opens the tab holding an invalid field and focuses it", async () => {
    const { user } = renderPage();
    await screen.findByLabelText(/^handle/i);
    await user.click(screen.getByRole("tab", { name: "Links" }));
    await user.clear(screen.getByLabelText("LinkedIn link"));
    await user.click(screen.getByRole("tab", { name: /content/i }));

    await user.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /links/i })).toHaveAttribute("aria-selected", "true"),
    );
    await waitFor(() => expect(screen.getByLabelText("LinkedIn link")).toHaveFocus());
    expect(screen.getByText("Add the link or remove this row")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Some fields need fixing");
    expect(api.saveMyCard).not.toHaveBeenCalled();
  });

  it("shows the database's own message when a save is refused", async () => {
    api.saveMyCard.mockRejectedValue({ code: "22023", message: "That handle is taken" });
    const { user } = renderPage();
    const headline = await screen.findByLabelText("Headline");
    await user.type(headline, "!");

    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save your card. That handle is taken",
    );
    expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();
    expect(api.removeCardImages).not.toHaveBeenCalled();
  });

  it("discards changes back to the saved card", async () => {
    const { user } = renderPage();
    const headline = await screen.findByLabelText("Headline");
    await user.type(headline, " and more");

    await user.click(screen.getByRole("button", { name: "Discard" }));
    const dialog = screen.getByRole("dialog", { name: "Discard your changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));

    expect(screen.getByLabelText("Headline")).toHaveValue("CS student");
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();
    // Discard vanished with the changes; focus lands on the panel, not the page.
    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveFocus());
  });

  it("keeps the editor and what's been typed when a background refresh fails", async () => {
    const { user, queryClient } = renderPage();
    const headline = await screen.findByLabelText("Headline");
    await user.type(headline, " (draft)");

    api.fetchMyCard.mockRejectedValue(new Error("offline"));
    await queryClient.refetchQueries({ queryKey: queryKeys.cards.mine }).catch(() => {});

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.cards.mine)?.status).toBe("error"),
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Headline")).toHaveValue("CS student (draft)");
  });

  it("updates the preview as the member types", async () => {
    const { user } = renderPage();
    const name = await screen.findByLabelText(/name on your card/i);

    await user.clear(name);
    await user.type(name, "Ana R.");

    await waitFor(() =>
      expect(screen.getAllByTestId("card-preview")[0]).toHaveTextContent("Ana R. | CS student | linkedin"),
    );
  });

  it("refills the name from the profile without touching anything else", async () => {
    const { user } = renderPage();
    const name = await screen.findByLabelText(/name on your card/i);
    await user.clear(name);
    await user.type(name, "A. Rivera");

    await user.click(screen.getByRole("button", { name: "Start from my profile" }));

    expect(name).toHaveValue("Ana Rivera");
    expect(screen.getByLabelText("Headline")).toHaveValue("CS student");
  });
});

describe("My Card: publishing", () => {
  it("publishes a saved card and shows where it lives", async () => {
    const { user } = renderPage();
    await screen.findByLabelText(/^handle/i);

    expect(publishSwitch()).toHaveAttribute("aria-checked", "false");
    await user.click(publishSwitch());

    await waitFor(() => expect(publishSwitch()).toHaveAttribute("aria-checked", "true"));
    expect(api.setMyCardPublished).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Your card is published")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /card\/ana-rivera/ })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("asks to save first when there are unsaved changes, then saves and publishes", async () => {
    const { user } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), " (new)");

    await user.click(publishSwitch());
    const dialog = screen.getByRole("dialog", { name: "Save your changes first?" });
    expect(api.setMyCardPublished).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Save and publish" }));

    await waitFor(() => expect(api.setMyCardPublished).toHaveBeenCalledWith(true));
    expect(api.saveMyCard).toHaveBeenCalledTimes(1);
    expect(api.saveMyCard.mock.invocationCallOrder[0]).toBeLessThan(
      api.setMyCardPublished.mock.invocationCallOrder[0],
    );
    expect(api.saveMyCard.mock.calls[0][0].headline).toBe("CS student (new)");
  });

  it("unpublishes without asking, even with unsaved changes", async () => {
    setServer({ card: memberCard({ is_published: true }), links: [LINKEDIN] });
    const { user } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), "!");

    await user.click(publishSwitch());

    await waitFor(() => expect(api.setMyCardPublished).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("My Card: banners", () => {
  it("tells a member an officer set up their card, and where their chip points", async () => {
    setServer({
      card: memberCard({
        created_by_officer: true,
        member_opened_at: null,
        chip_handle: "ana-rivera",
        chip_written_at: "2026-10-21T00:00:00.000Z",
        created_at: "2026-10-20T17:00:00.000Z",
        headline: null,
        pronouns: null,
        skills: [],
        avatar_path: null,
      }),
      links: [],
    });
    renderPage();

    const banner = (await screen.findByText("Your card is ready to finish")).closest("[role=status]");
    expect(banner).toHaveTextContent("An officer set up your card on October 20, 2026.");
    expect(banner).toHaveTextContent(/Your NFC card points to \S*\/card\/ana-rivera\./);
    expect(banner).toHaveTextContent("Add your links and publish it.");
  });

  it("explains a hidden card, with the officer's reason", async () => {
    setServer({
      card: memberCard({
        is_published: true,
        hidden_at: "2026-10-01T00:00:00.000Z",
        hidden_reason: "Impersonating an officer",
      }),
      links: [],
    });
    renderPage();

    const banner = (await screen.findByText("An officer has hidden your card")).closest(
      "[role=status]",
    );
    expect(banner).toHaveTextContent("“Impersonating an officer”");
    expect(banner).toHaveTextContent("Only an officer can unhide it");
  });
});

describe("My Card: Share and Insights", () => {
  it("hands the stored card and the unsaved state to Share, and the card's existence to Insights", async () => {
    const { user } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), "!");

    await user.click(screen.getByRole("tab", { name: "Share" }));
    expect(screen.getByText("Share tab for ana-rivera, unsaved")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Insights" }));
    expect(screen.getByText("Insights tab, has card: true")).toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys", async () => {
    const { user } = renderPage();
    await screen.findByLabelText(/^handle/i);

    const content = screen.getByRole("tab", { name: "Content" });
    content.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Links" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Links" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Links");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Insights" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Content" })).toHaveFocus();
  });
});

/** Holds save_my_card() until `finish` is called, then stores as usual. */
function holdSaves(): { finish: () => void } {
  const store = api.saveMyCard.getMockImplementation();
  if (!store) throw new Error("saveMyCard has no stand-in");
  const held = { finish: () => {} };
  api.saveMyCard.mockImplementation(
    (card, links) =>
      new Promise((resolve) => {
        held.finish = () => resolve(store(card, links));
      }),
  );
  return held;
}

describe("My Card: when the stored card changes mid-edit", () => {
  it("takes the stored value for every field the member hasn't changed, and keeps the ones they have", async () => {
    const { user, queryClient } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), " (draft)");

    // Meanwhile an officer resets the handle, and another device replaces the
    // photo, changes the pronouns and edits the headline too.
    server = {
      ...server,
      card: {
        ...memberCard(),
        handle: "ana-zulu",
        avatar_path: NEW_AVATAR,
        pronouns: "they/them",
        headline: "Changed elsewhere",
      },
    };
    await queryClient.refetchQueries({ queryKey: queryKeys.cards.mine });

    await waitFor(() => expect(screen.getByLabelText(/^handle/i)).toHaveValue("ana-zulu"));
    expect(screen.getByLabelText("Pronouns")).toHaveValue("they/them");
    expect(screen.getByLabelText("Headline")).toHaveValue("CS student (draft)");
    // Still unsaved, measured against the new stored card: Save stays on and
    // the leave-page guard stays up.
    expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(() => expect(api.saveMyCard).toHaveBeenCalledTimes(1));
    expect(api.saveMyCard.mock.calls[0][0]).toMatchObject({
      handle: "ana-zulu",
      avatar_path: NEW_AVATAR,
      pronouns: "they/them",
      headline: "CS student (draft)",
    });
    // The photo the other device put up is the live one; it's never deleted.
    await screen.findByText("All changes saved.");
    for (const [paths] of api.removeCardImages.mock.calls) expect(paths).not.toContain(NEW_AVATAR);
  });

  it("doesn't bring back a handle an officer removed when the member publishes with unsaved changes", async () => {
    const { user } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), "!");
    server = { ...server, card: { ...memberCard(), handle: "ana-zulu" } };

    await user.click(publishSwitch());
    const dialog = screen.getByRole("dialog", { name: "Save your changes first?" });
    await user.click(within(dialog).getByRole("button", { name: "Publish last saved" }));

    await waitFor(() => expect(publishSwitch()).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByLabelText(/^handle/i)).toHaveValue("ana-zulu");
    expect(screen.getByLabelText("Headline")).toHaveValue("CS student!");

    await user.click(saveButton());
    await waitFor(() => expect(api.saveMyCard).toHaveBeenCalledTimes(1));
    expect(api.saveMyCard.mock.calls[0][0]).toMatchObject({ handle: "ana-zulu", headline: "CS student!" });
  });

  it("keeps the member's links whole, never mixed row by row with a list changed elsewhere", async () => {
    const { user, queryClient } = renderPage();
    await screen.findByLabelText(/^handle/i);
    await user.click(screen.getByRole("tab", { name: "Links" }));
    const linkedin = screen.getByLabelText("LinkedIn link");
    await user.clear(linkedin);
    await user.type(linkedin, "https://www.linkedin.com/in/ana-r");

    // Another device added a GitHub link above LinkedIn and changed the headline.
    const github: CardLink = {
      id: "55555555-5555-4555-8555-555555555555",
      kind: "github",
      label: null,
      value: "https://github.com/ana-codes",
      sort_order: 0,
      is_featured: false,
      is_visible: true,
    };
    server = {
      ...server,
      card: { ...memberCard(), headline: "Changed elsewhere" },
      links: [github, { ...LINKEDIN, sort_order: 1 }],
    };
    await queryClient.refetchQueries({ queryKey: queryKeys.cards.mine });

    await waitFor(() =>
      expect(screen.getAllByTestId("card-preview")[0]).toHaveTextContent("Changed elsewhere | linkedin |"),
    );
    // The open Links tab still shows the member's list, as they left it.
    expect(screen.getByLabelText("LinkedIn link")).toHaveValue("https://www.linkedin.com/in/ana-r");
    expect(screen.queryByLabelText("GitHub link")).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(() => expect(api.saveMyCard).toHaveBeenCalledTimes(1));
    // Not GitHub's id and kind wrapped round the LinkedIn address.
    expect(api.saveMyCard.mock.calls[0][1]).toEqual([
      expect.objectContaining({ id: LINKEDIN.id, kind: "linkedin", value: "https://www.linkedin.com/in/ana-r" }),
    ]);
    expect(api.saveMyCard.mock.calls[0][0].headline).toBe("Changed elsewhere");
  });

  it("puts a new chapter position in the preview as soon as it arrives", async () => {
    const { queryClient } = renderPage();
    await screen.findByLabelText(/^handle/i);
    expect(screen.getAllByTestId("card-preview")[0]).toHaveTextContent("pos=none");

    server = { ...server, position: "Treasurer" };
    await queryClient.refetchQueries({ queryKey: queryKeys.cards.mine });

    await waitFor(() =>
      expect(screen.getAllByTestId("card-preview")[0]).toHaveTextContent("pos=Treasurer"),
    );
    expect(screen.getByText(/“Treasurer”, assigned by an officer/)).toBeInTheDocument();
  });

  it("puts a profile change in the preview mid-edit, keeping what's been typed", async () => {
    const { user, queryClient } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), " (draft)");

    server = { ...server, profile: { ...PROFILE, major: "Mechanical Engineering" } };
    await queryClient.refetchQueries({ queryKey: queryKeys.cards.mine });

    await waitFor(() =>
      expect(screen.getAllByTestId("card-preview")[0]).toHaveTextContent("major=Mechanical Engineering"),
    );
    expect(screen.getAllByTestId("card-preview")[0]).toHaveTextContent("CS student (draft)");
  });
});

describe("My Card: while a save is in flight", () => {
  it("disables the fields, so nothing typed is wiped when the save comes back", async () => {
    const held = holdSaves();
    const { user } = renderPage();
    const headline = await screen.findByLabelText("Headline");
    await user.type(headline, "!");
    await user.click(saveButton());

    const bio = screen.getByLabelText("Bio");
    await waitFor(() => expect(bio).toBeDisabled());
    expect(headline).toBeDisabled();
    expect(screen.getByLabelText(/^handle/i)).toBeDisabled();
    await user.type(bio, "typed during save");
    expect(bio).toHaveValue("");

    held.finish();

    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    expect(bio).toBeEnabled();
    expect(headline).toHaveValue("CS student!");
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();
  });

  it("hands focus back to the field that had it when the save started", async () => {
    const held = holdSaves();
    const { user } = renderPage();
    const headline = await screen.findByLabelText("Headline");
    await user.type(headline, "!");

    // A submit from inside the form, with focus still in the field.
    fireEvent.submit(headline.closest("form") as HTMLFormElement);
    await waitFor(() => expect(headline).toBeDisabled());
    // What a browser does with focus on a control that becomes disabled.
    // (jsdom won't blur a disabled control, so focus is moved to the body.)
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
    expect(document.activeElement).toBe(document.body);

    held.finish();

    await screen.findByText("All changes saved.");
    await waitFor(() => expect(headline).toHaveFocus());
  });
});

describe("My Card: what a save says", () => {
  it("tells a member with a live card that it's updated, and where it lives", async () => {
    setServer({ card: memberCard({ is_published: true }), links: [LINKEDIN] });
    const { user } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), "!");
    await user.click(saveButton());

    expect(await screen.findByText("Your card is updated")).toBeInTheDocument();
    expect(screen.getByText(/^It's live at \S*\/card\/ana-rivera\.$/)).toBeInTheDocument();
  });

  it("tells a member with a draft to publish when they're ready", async () => {
    const { user } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), "!");
    await user.click(saveButton());

    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    expect(screen.getByText("Publish it when you're ready, with the switch at the top.")).toBeInTheDocument();
    expect(screen.queryByText(/It's live at/)).not.toBeInTheDocument();
  });

  it("doesn't tell a member whose card is hidden to publish it, or that it's live", async () => {
    setServer({
      card: memberCard({ is_published: true, hidden_at: "2026-10-01T00:00:00.000Z", hidden_reason: "Spam" }),
      links: [LINKEDIN],
    });
    const { user } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), "!");
    await user.click(saveButton());

    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    expect(
      screen.getByText("An officer has hidden your card, so nobody can see it until they unhide it."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Publish it when you're ready/)).not.toBeInTheDocument();
    expect(screen.queryByText("Your card is updated")).not.toBeInTheDocument();
  });

  it("doesn't call an officer's card live while cards are switched off", async () => {
    setServer({ enabled: false, card: memberCard({ is_published: true }), links: [LINKEDIN] });
    const { user } = renderPage({ isOfficer: true, roles: ["member", "officer"] });
    await user.type(await screen.findByLabelText("Headline"), "!");
    await user.click(saveButton());

    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    expect(
      screen.getByText("Your card is published, and it goes live when business cards are switched on."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your card is updated")).not.toBeInTheDocument();
  });

  it("says only that the card is published after Save and publish", async () => {
    const { user } = renderPage();
    await user.type(await screen.findByLabelText("Headline"), "!");
    await user.click(publishSwitch());
    const dialog = screen.getByRole("dialog", { name: "Save your changes first?" });
    await user.click(within(dialog).getByRole("button", { name: "Save and publish" }));

    expect(await screen.findByText("Your card is published")).toBeInTheDocument();
    expect(api.saveMyCard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Changes saved")).not.toBeInTheDocument();
    expect(screen.queryByText(/Publish it when you're ready/)).not.toBeInTheDocument();
  });
});

describe("My Card: focus after a control goes away", () => {
  it("moves focus to the field once its hidden block is shown", async () => {
    const { user } = renderPage();
    await screen.findByLabelText(/^handle/i);

    await user.click(screen.getByRole("button", { name: "Show Skills on my card" }));

    expect(screen.queryByRole("button", { name: "Show Skills on my card" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Skills")).toHaveFocus());
  });
});

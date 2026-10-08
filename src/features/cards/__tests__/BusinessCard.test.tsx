import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BusinessCard, type BusinessCardProps } from "../BusinessCard";
import { CARD_LAYOUTS, CARD_PRESET_IDS, type CardLayout, type CardTheme } from "../model";
import { storedThemeShowsPhoto, visiblePhotoPath } from "../photoVisibility";
import { CARD_PRESETS } from "../themes";
import type { PublicCardData, PublicCardLink } from "@/types/database";

// The renderer only needs paths turned into URLs; keep Supabase out of it.
vi.mock("@/services/cards", () => ({
  cardMediaUrl: (path: string | null) => (path ? `https://media.test/${path}` : null),
}));

const MEMBER = "11111111-1111-4111-8111-111111111111";
const AVATAR = `${MEMBER}/22222222-2222-4222-8222-222222222222.webp`;
const BANNER = `${MEMBER}/33333333-3333-4333-8333-333333333333.webp`;
const BACKGROUND = `${MEMBER}/44444444-4444-4444-8444-444444444444.webp`;

const LINKS: PublicCardLink[] = [
  { id: "l-linkedin", kind: "linkedin", label: null, value: "https://www.linkedin.com/in/diego", is_featured: false },
  { id: "l-email", kind: "email", label: null, value: "diego@wustl.edu", is_featured: false },
  { id: "l-calendly", kind: "calendly", label: "Book a coffee chat", value: "https://calendly.com/diego", is_featured: true },
  { id: "l-phone", kind: "phone", label: null, value: "+1 (314) 555-0123", is_featured: false },
];

function makeCard(overrides: Partial<PublicCardData> = {}): PublicCardData {
  return {
    handle: "diego-gonzalez",
    display_name: "Diego Gonzalez",
    pronouns: "he/him",
    headline: "SWE Intern @ Boeing",
    organization: "Washington University in St. Louis",
    status_line: "Seeking Summer 2027 internships",
    bio: "Line one\nLine two <b>not bold</b>",
    location: "St. Louis, MO",
    skills: ["Python", "SolidWorks"],
    languages: ["English", "Español"],
    avatar_path: AVATAR,
    banner_path: BANNER,
    background_path: null,
    theme: { preset: "shpe-classic" },
    sections: ["status", "featured", "links", "about", "education", "shpe", "skills", "languages"],
    allow_indexing: false,
    is_starter: false,
    education: {
      major: "Computer Science",
      secondary_major: "Economics",
      graduation_year: 2027,
      degree_level: "undergraduate",
    },
    shpe: { position: "President", member_since: "2025-08-25", national_member_verified: true, is_alumni: false },
    links: LINKS,
    ...overrides,
  };
}

function renderCard(props: Partial<BusinessCardProps> & { card?: PublicCardData } = {}) {
  const { card = makeCard(), mode = "public", ...rest } = props;
  const utils = render(<BusinessCard card={card} mode={mode} {...rest} />);
  const root = utils.container.querySelector<HTMLElement>("[data-card-root]")!;
  const sectionOrder = () =>
    [...utils.container.querySelectorAll<HTMLElement>("[data-section]")].map((el) => el.dataset.section);
  return { ...utils, root, sectionOrder };
}

/**
 * Clicks and reports whether the card cancelled the click. The window
 * listener runs after React's, records the verdict, then cancels the click
 * itself so jsdom doesn't try (and fail noisily) to follow a mailto: link.
 */
function clickWasCancelled(element: Element): boolean {
  let cancelled = false;
  const listener = (event: Event) => {
    cancelled = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener("click", listener);
  fireEvent.click(element);
  window.removeEventListener("click", listener);
  return cancelled;
}

function withTheme(theme: CardTheme, overrides: Partial<PublicCardData> = {}) {
  return makeCard({ theme, ...overrides });
}

describe("BusinessCard header", () => {
  it("shows the name as the page heading, with pronouns, headline, school and location", () => {
    renderCard();
    expect(screen.getByRole("heading", { level: 1, name: "Diego Gonzalez" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Diego Gonzalez" })).toBeInTheDocument();
    expect(screen.getByText("he/him")).toBeInTheDocument();
    expect(screen.getByText("SWE Intern @ Boeing")).toBeInTheDocument();
    expect(screen.getByText("Washington University in St. Louis")).toBeInTheDocument();
    expect(screen.getByText("St. Louis, MO")).toBeInTheDocument();
  });

  it("shows the verified position line with an accessible label", () => {
    renderCard();
    const line = screen.getByText("WashU SHPE · President").closest("p")!;
    expect(within(line).getByRole("img", { name: "Verified by chapter officers" })).toBeInTheDocument();
  });

  it("only takes the verified line from the officer-assigned position", () => {
    renderCard({
      card: makeCard({
        headline: "President of WashU SHPE",
        shpe: { position: null, member_since: null, national_member_verified: false, is_alumni: false },
      }),
    });
    // The headline is shown, as plain text with no badge.
    expect(screen.getByText("President of WashU SHPE")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /verified by chapter officers/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/WashU SHPE ·/)).not.toBeInTheDocument();
  });

  it("marks alumni", () => {
    renderCard({
      card: makeCard({ shpe: { position: null, member_since: null, national_member_verified: false, is_alumni: true } }),
    });
    expect(screen.getByText("Alumni")).toBeInTheDocument();
  });

  it("loads the photo through resolveMedia", () => {
    const resolveMedia = vi.fn((path: string | null) => (path ? `https://cdn.example/${path}` : null));
    const { container } = renderCard({ resolveMedia });
    const img = container.querySelector<HTMLImageElement>('[data-part="avatar"] img')!;
    expect(img.getAttribute("src")).toBe(`https://cdn.example/${AVATAR}`);
    expect(img).toHaveAttribute("alt", "");
    expect(resolveMedia).toHaveBeenCalledWith(AVATAR);
  });

  it("falls back to initials when there's no photo, or it can't be resolved", () => {
    const { container } = renderCard({ resolveMedia: () => null });
    const avatar = container.querySelector('[data-part="avatar"]')!;
    expect(avatar.querySelector("img")).toBeNull();
    expect(avatar).toHaveTextContent("DG");
  });

  it("falls back to initials when the photo fails to load", () => {
    const { container } = renderCard();
    const img = container.querySelector('[data-part="avatar"] img')!;
    fireEvent.error(img);
    expect(container.querySelector('[data-part="avatar"] img')).toBeNull();
    expect(container.querySelector('[data-part="avatar"]')).toHaveTextContent("DG");
  });

  it("hides the photo when the avatar shape is hidden", () => {
    const { container } = renderCard({ card: withTheme({ preset: "shpe-classic", avatar: { shape: "hidden" } }) });
    expect(container.querySelector('[data-part="avatar"]')).toBeNull();
  });
});

describe("BusinessCard layouts", () => {
  it.each(CARD_LAYOUTS)("renders the %s layout", (layout: CardLayout) => {
    const { root, container } = renderCard({ card: withTheme({ preset: "shpe-classic", layout }) });
    expect(root.dataset.cardLayout).toBe(layout);
    expect(screen.getByRole("heading", { level: 1, name: "Diego Gonzalez" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add to contacts/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /member of washu shpe/i })).toBeInTheDocument();

    const avatar = container.querySelector('[data-part="avatar"]');
    const banner = container.querySelector('[data-part="banner"]');
    const slot = container.querySelector('[data-part="lanyard-slot"]');
    expect(Boolean(avatar)).toBe(layout !== "minimal");
    expect(Boolean(banner)).toBe(layout === "banner");
    expect(Boolean(slot)).toBe(layout === "badge");
  });

  it("puts the banner image on the banner layout", () => {
    const { container } = renderCard({ card: withTheme({ preset: "sunrise" }) });
    const banner = container.querySelector('[data-part="banner"]')!;
    expect(banner.querySelector("img")?.getAttribute("src")).toBe(`https://media.test/${BANNER}`);
    expect(banner).toHaveAttribute("aria-hidden", "true");
  });

  it("uses an accent band when there's no banner image", () => {
    const { container } = renderCard({ card: withTheme({ preset: "sunrise" }, { banner_path: null }) });
    const banner = container.querySelector('[data-part="banner"]')!;
    expect(banner.querySelector("img")).toBeNull();
    expect(banner).not.toHaveAttribute("data-has-image");
  });

  it("follows the preset's layout when none is set", () => {
    expect(renderCard({ card: withTheme({ preset: "paper" }) }).root.dataset.cardLayout).toBe("minimal");
  });

  // Add to Contacts and the link-preview edge function decide from the stored
  // theme whether they may use the photo. Whatever they decide must match
  // what the card itself draws, or a hidden face leaks out through them.
  it("draws the photo exactly when the shared photo rule says it shows", () => {
    const themes: CardTheme[] = [
      ...CARD_PRESET_IDS.map((preset) => ({ preset })),
      ...CARD_LAYOUTS.map((layout) => ({ preset: "paper" as const, layout })),
      { preset: "shpe-classic", avatar: { shape: "hidden" } },
      { preset: "sunrise", avatar: { shape: "hidden", ring: true } },
      { preset: "engineer", avatar: { shape: "rounded" } },
    ];
    for (const theme of themes) {
      const { container, unmount } = renderCard({ card: withTheme(theme) });
      const drawn = container.querySelector('[data-part="avatar"] img') !== null;
      expect(drawn, JSON.stringify(theme)).toBe(storedThemeShowsPhoto(theme));
      expect(visiblePhotoPath(withTheme(theme)) !== null, JSON.stringify(theme)).toBe(drawn);
      unmount();
    }
  });

  it("renders a junk theme as SHPE Classic instead of failing", () => {
    const { root } = renderCard({ card: withTheme({ preset: "nope", layout: 7 } as unknown as CardTheme) });
    expect(root.dataset.cardPreset).toBe("shpe-classic");
    expect(root.dataset.cardLayout).toBe("classic");
    expect(root.style.getPropertyValue("--card-accent")).toBe("#c43e12");
  });

  it("sets the theme as CSS custom properties on the root", () => {
    const { root } = renderCard({ card: withTheme({ preset: "midnight", colors: { accent: "#22D3EE" } }) });
    expect(root.style.getPropertyValue("--card-surface")).toBe("#0f172a");
    expect(root.style.getPropertyValue("--card-accent")).toBe("#22d3ee");
  });

  it("only loads a background photo through resolveMedia", () => {
    const resolveMedia = vi.fn((path: string | null) => (path ? `https://cdn.example/${path}` : null));
    renderCard({
      card: withTheme({ preset: "glass", background: { type: "image", dim: 30 } }, { background_path: BACKGROUND }),
      resolveMedia,
    });
    expect(resolveMedia).toHaveBeenCalledWith(BACKGROUND);
  });

  it("loads the theme's web fonts", () => {
    renderCard({ card: withTheme({ preset: "paper" }) });
    expect(document.head.querySelector('link[data-card-font="playfair-display"]')).not.toBeNull();
    expect(document.head.querySelector('link[data-card-font="inter"]')).not.toBeNull();
  });
});

describe("BusinessCard sections", () => {
  it("renders sections in the card's order and hides the ones not listed", () => {
    const { sectionOrder } = renderCard({ card: makeCard({ sections: ["skills", "about", "status", "links"] }) });
    expect(sectionOrder()).toEqual(["skills", "about", "status", "links"]);
    expect(screen.queryByText("Computer Science ’27")).not.toBeInTheDocument();
    expect(screen.queryByText(/member since/i)).not.toBeInTheDocument();
  });

  it("renders every block with its content", () => {
    const { sectionOrder } = renderCard();
    expect(sectionOrder()).toEqual([
      "status",
      "featured",
      "links",
      "about",
      "education",
      "shpe",
      "skills",
      "languages",
    ]);
    expect(screen.getByRole("heading", { name: "Currently" })).toBeInTheDocument();
    expect(screen.getByText("Seeking Summer 2027 internships")).toBeInTheDocument();
    expect(screen.getByText("Computer Science ’27")).toBeInTheDocument();
    expect(screen.getByText("Second major: Economics")).toBeInTheDocument();
    expect(screen.getByText("Undergraduate")).toBeInTheDocument();
    expect(screen.getByText("Member since August 2025")).toBeInTheDocument();
    expect(screen.getByText(/SHPE National member/)).toBeInTheDocument();
    const skills = screen.getByRole("heading", { name: "Skills" }).closest("section")!;
    expect(within(skills).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Python", "SolidWorks"]);
    const languages = screen.getByRole("heading", { name: "Languages" }).closest("section")!;
    expect(within(languages).getByText("Español")).toBeInTheDocument();
  });

  it("skips sections that have nothing to show", () => {
    const { sectionOrder } = renderCard({
      card: makeCard({
        status_line: null,
        bio: "   ",
        skills: [],
        education: null,
        shpe: { position: "President", member_since: null, national_member_verified: false, is_alumni: false },
      }),
    });
    expect(sectionOrder()).toEqual(["featured", "links", "languages"]);
  });

  it("tolerates junk in the section list", () => {
    const { sectionOrder } = renderCard({
      card: makeCard({ sections: ["about", "bogus", "about", "skills"] as unknown as PublicCardData["sections"] }),
    });
    expect(sectionOrder()).toEqual(["about", "skills"]);
  });

  it("keeps the bio as text, line breaks included, never HTML", () => {
    const { container } = renderCard();
    const about = screen.getByRole("heading", { name: "About" }).closest("section")!;
    const paragraph = about.querySelector("p")!;
    expect(paragraph.textContent).toBe("Line one\nLine two <b>not bold</b>");
    expect(paragraph.className).toMatch(/whitespace-pre-line/);
    expect(container.querySelector("b")).toBeNull();
  });

  it("shows the class year alone when the major is hidden", () => {
    renderCard({
      card: makeCard({
        education: { major: null, secondary_major: null, graduation_year: 2028, degree_level: null },
      }),
    });
    expect(screen.getByText("Class of 2028")).toBeInTheDocument();
  });
});

describe("BusinessCard links", () => {
  function linksSection(container: HTMLElement) {
    return container.querySelector<HTMLElement>('[data-section="links"]')!;
  }
  function featuredSection(container: HTMLElement) {
    return container.querySelector<HTMLElement>('[data-section="featured"]');
  }

  it("lifts the featured link out of the list when the Featured block is shown", () => {
    const { container } = renderCard();
    const featured = featuredSection(container)!;
    expect(within(featured).getByRole("link", { name: /book a coffee chat/i })).toBeInTheDocument();
    const list = linksSection(container);
    expect(within(list).queryByRole("link", { name: /book a coffee chat/i })).not.toBeInTheDocument();
    expect(within(list).getAllByRole("link")).toHaveLength(3);
  });

  it("keeps the featured link in the list when the Featured block is hidden", () => {
    const { container } = renderCard({ card: makeCard({ sections: ["links"] }) });
    expect(featuredSection(container)).toBeNull();
    const list = linksSection(container);
    expect(within(list).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "LinkedIn (opens in a new tab)",
      "Email",
      "Book a coffee chat (opens in a new tab)",
      "Phone",
    ]);
  });

  it("shows nothing for the Featured block when no link is featured", () => {
    const { container } = renderCard({
      card: makeCard({ links: LINKS.map((link) => ({ ...link, is_featured: false })) }),
    });
    expect(featuredSection(container)).toBeNull();
    expect(within(linksSection(container)).getAllByRole("link")).toHaveLength(4);
  });

  it("opens web links in a new tab, and email and phone in place", () => {
    renderCard();
    const linkedin = screen.getByRole("link", { name: /linkedin/i });
    expect(linkedin).toHaveAttribute("href", "https://www.linkedin.com/in/diego");
    expect(linkedin).toHaveAttribute("target", "_blank");
    expect(linkedin).toHaveAttribute("rel", "noopener noreferrer");

    const email = screen.getByRole("link", { name: "Email" });
    expect(email).toHaveAttribute("href", "mailto:diego@wustl.edu");
    expect(email).not.toHaveAttribute("target");

    const phone = screen.getByRole("link", { name: "Phone" });
    expect(phone).toHaveAttribute("href", "tel:+13145550123");
    expect(phone).not.toHaveAttribute("target");
  });

  it("reports every link click on a public card without stopping it", () => {
    const onLinkClick = vi.fn();
    renderCard({ onLinkClick });
    expect(clickWasCancelled(screen.getByRole("link", { name: "Email" }))).toBe(false);
    expect(clickWasCancelled(screen.getByRole("link", { name: /book a coffee chat/i }))).toBe(false);
    expect(onLinkClick).toHaveBeenNthCalledWith(1, LINKS[1]);
    expect(onLinkClick).toHaveBeenNthCalledWith(2, LINKS[2]);
  });

  it("counts a middle-click as a click", () => {
    const onLinkClick = vi.fn();
    renderCard({ onLinkClick });
    fireEvent(
      screen.getByRole("link", { name: /linkedin/i }),
      new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
    );
    expect(onLinkClick).toHaveBeenCalledWith(LINKS[0]);
  });

  it("drops links that can't be made safe from a public card", () => {
    const card = makeCard({
      sections: ["links"],
      links: [
        { id: "bad", kind: "website", label: "Click me", value: "javascript:alert(1)", is_featured: false },
        { id: "bad2", kind: "custom", label: "Data", value: "data:text/html,<script>x</script>", is_featured: false },
        LINKS[0],
      ],
    });
    const { container } = renderCard({ card });
    expect(screen.queryByText("Click me")).not.toBeInTheDocument();
    expect(screen.queryByText("Data")).not.toBeInTheDocument();
    const anchors = linksSection(container).querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    for (const a of anchors) {
      expect(a.getAttribute("href")).toMatch(/^(https:|mailto:|tel:)/);
    }
  });

  it("arranges links as an icon grid when asked", () => {
    const { container } = renderCard({
      card: withTheme({ preset: "shpe-classic", buttons: { arrangement: "icon-grid" } }, { sections: ["links"] }),
    });
    const list = linksSection(container);
    expect(list.dataset.arrangement).toBe("icon-grid");
    expect(within(list).getByRole("link", { name: /linkedin/i })).toHaveAttribute("title", "LinkedIn");
    expect(within(list).getAllByRole("link")).toHaveLength(4);
  });

  // A tile is about 66px wide on a phone and every custom link has the same
  // icon, so a caption cut to one line can leave two links looking identical.
  it("wraps icon-grid captions onto two lines instead of cutting them to one", () => {
    const poster = "Undergraduate research symposium poster"; // 39 characters
    const links: PublicCardLink[] = [
      { id: "l-poster", kind: "custom", label: poster, value: "https://example.com/poster", is_featured: false },
      { id: "l-paper", kind: "custom", label: "Research paper", value: "https://example.com/paper", is_featured: false },
    ];
    const { container } = renderCard({
      card: withTheme({ preset: "shpe-classic", buttons: { arrangement: "icon-grid" } }, { sections: ["links"], links }),
    });
    const list = linksSection(container);

    const captions = [...list.querySelectorAll<HTMLElement>('[data-part="tile-label"]')];
    expect(captions.map((el) => el.textContent)).toEqual([poster, "Research paper"]);
    for (const caption of captions) {
      expect(caption).toHaveClass("line-clamp-2", "[overflow-wrap:anywhere]");
      expect(caption).not.toHaveClass("truncate");
      expect(caption.className).not.toMatch(/\b(?:whitespace-nowrap|text-ellipsis|line-clamp-1)\b/);
    }

    // Clamping only hides text visually: the whole label is still the link's
    // name for screen readers, and its tooltip for mouse users.
    const namedFor = (label: string) => (name: string) => name.startsWith(label);
    const posterLink = within(list).getByRole("link", { name: namedFor(poster) });
    expect(posterLink).toHaveAttribute("title", poster);
    expect(within(list).getByRole("link", { name: namedFor("Research paper") })).toHaveAttribute(
      "title",
      "Research paper",
    );
  });

  it("uses labelled buttons for a grid without icons", () => {
    const { container } = renderCard({
      card: withTheme(
        { preset: "shpe-classic", buttons: { arrangement: "icon-grid", icons: false } },
        { sections: ["links"] },
      ),
    });
    expect(linksSection(container).dataset.arrangement).toBe("grid");
    expect(linksSection(container).querySelector("svg")).toBeNull();
  });
});

describe("BusinessCard actions and footer", () => {
  it("always offers Add to Contacts and Share, even with no sections", () => {
    const onAddToContacts = vi.fn();
    const onShare = vi.fn();
    renderCard({ card: makeCard({ sections: [] }), onAddToContacts, onShare });
    fireEvent.click(screen.getByRole("button", { name: /add to contacts/i }));
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(onAddToContacts).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it("works from the keyboard", async () => {
    const user = userEvent.setup();
    const onAddToContacts = vi.fn();
    renderCard({ onAddToContacts });
    screen.getByRole("button", { name: /add to contacts/i }).focus();
    await user.keyboard("{Enter}");
    expect(onAddToContacts).toHaveBeenCalledTimes(1);
  });

  it("links the footer to the chapter's home page", () => {
    renderCard();
    const footer = screen.getByRole("link", { name: /member of washu shpe/i });
    expect(footer.getAttribute("href")).toMatch(/^https?:\/\/[^/]+\/$/);
    expect(footer).not.toHaveAttribute("target");
  });
});

describe("BusinessCard preview mode", () => {
  it("lets nothing navigate but still fires the handlers", () => {
    const onLinkClick = vi.fn();
    const onAddToContacts = vi.fn();
    const onShare = vi.fn();
    renderCard({ mode: "preview", onLinkClick, onAddToContacts, onShare });

    for (const link of screen.getAllByRole("link")) {
      expect(clickWasCancelled(link), link.textContent ?? "").toBe(true);
    }
    // Every card link reported, the footer is just inert.
    expect(onLinkClick).toHaveBeenCalledTimes(LINKS.length);
    expect(onLinkClick).toHaveBeenCalledWith(LINKS[0]);

    fireEvent.click(screen.getByRole("button", { name: /add to contacts/i }));
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(onAddToContacts).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it("cancels middle-clicks too", () => {
    renderCard({ mode: "preview" });
    const notCancelled = fireEvent(
      screen.getByRole("link", { name: /linkedin/i }),
      new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
    );
    expect(notCancelled).toBe(false);
  });

  it("keeps real hrefs so hovering shows where a link goes", () => {
    renderCard({ mode: "preview" });
    expect(screen.getByRole("link", { name: /linkedin/i })).toHaveAttribute(
      "href",
      "https://www.linkedin.com/in/diego",
    );
  });

  it("shows an incomplete link as not yet working instead of dropping it", () => {
    renderCard({
      mode: "preview",
      card: makeCard({
        sections: ["links"],
        links: [{ id: "p-0", kind: "website", label: "My site", value: "my site", is_featured: false }],
      }),
    });
    const row = screen.getByRole("link", { name: "My site" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).not.toHaveAttribute("href");
  });
});

describe("BusinessCard starter cards", () => {
  const starter = makeCard({
    is_starter: true,
    // Whatever the row holds, a starter card shows none of this.
    pronouns: "he/him",
    headline: "Headline",
    status_line: "Status",
    bio: "Bio text",
    location: "St. Louis, MO",
    skills: ["Python"],
    languages: ["English"],
  });

  it("shows only the name, school, education, position, Add to Contacts and the footer", () => {
    const { container, sectionOrder } = renderCard({ card: starter });
    expect(screen.getByRole("heading", { level: 1, name: "Diego Gonzalez" })).toBeInTheDocument();
    expect(screen.getByText("Washington University in St. Louis")).toBeInTheDocument();
    expect(screen.getByText("WashU SHPE · President")).toBeInTheDocument();
    expect(screen.getByText("Computer Science ’27")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add to contacts/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /member of washu shpe/i })).toBeInTheDocument();
    expect(sectionOrder()).toEqual(["education"]);

    expect(screen.queryByRole("button", { name: /share/i })).not.toBeInTheDocument();
    for (const text of ["he/him", "Headline", "Status", "Bio text", "St. Louis, MO", "Python", "English"]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole("link")).toHaveLength(1); // the footer
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-part="avatar"]')).toBeNull();
  });
});

function linksBlock(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-section="links"]')!;
}

describe("BusinessCard professional presets", () => {
  const PROFESSIONAL = ["executive", "editorial", "studio", "slate", "heritage", "signature"] as const;

  it.each(PROFESSIONAL)("draws %s in its own layout, with Add to Contacts, Share and the footer", (preset) => {
    const { root, container } = renderCard({ card: withTheme({ preset }) });
    expect(root.dataset.cardPreset).toBe(preset);
    expect(root.dataset.cardLayout).toBe(CARD_PRESETS[preset].theme.layout);
    expect(screen.getByRole("heading", { level: 1, name: "Diego Gonzalez" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add to contacts/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /member of washu shpe/i })).toBeInTheDocument();
    // Name first, then role, then affiliation.
    const header = container.querySelector<HTMLElement>('[data-part="header"]')!;
    const text = header.textContent ?? "";
    expect(text.indexOf("SWE Intern @ Boeing")).toBeGreaterThan(-1);
    if (preset !== "heritage") {
      // Heritage sets the school above the name, like headed paper.
      expect(text.indexOf("Diego Gonzalez")).toBeLessThan(text.indexOf("SWE Intern @ Boeing"));
      expect(text.indexOf("SWE Intern @ Boeing")).toBeLessThan(text.indexOf("Washington University in St. Louis"));
    }
    expect(within(header).getByRole("img", { name: "Verified by chapter officers" })).toBeInTheDocument();
  });

  it("steps a long name down rather than letting it sprawl", () => {
    for (const preset of PROFESSIONAL) {
      const regular = renderCard({ card: withTheme({ preset }) });
      expect(regular.container.querySelector('[data-part="header"]')).toHaveAttribute("data-name-length", "regular");
      regular.unmount();
      const long = renderCard({
        card: withTheme({ preset }, { display_name: "Maria Guadalupe Hernández-Villanueva" }),
      });
      const header = long.container.querySelector('[data-part="header"]')!;
      expect(header).toHaveAttribute("data-name-length", "longest");
      const longSize = header.querySelector("h1")!.className.match(/text-\[([\d.]+)rem\]/)?.[1];
      long.unmount();
      const short = renderCard({ card: withTheme({ preset }) });
      const shortSize = short.container.querySelector("h1")!.className.match(/text-\[([\d.]+)rem\]/)?.[1];
      short.unmount();
      expect(Number(longSize), preset).toBeLessThan(Number(shortSize));
    }
  });

  it("collapses missing content without leaving rules, ornaments or empty groups behind", () => {
    for (const preset of PROFESSIONAL) {
      const { container, unmount } = renderCard({
        card: withTheme(
          { preset },
          {
            pronouns: null,
            headline: null,
            organization: null,
            location: null,
            avatar_path: null,
            links: [],
            status_line: null,
            bio: null,
            skills: [],
            languages: [],
            education: null,
            shpe: { position: null, member_since: null, national_member_verified: false, is_alumni: false },
          },
        ),
      });
      const header = container.querySelector('[data-part="header"]')!;
      expect(header.querySelector('[data-part="affiliations"]'), preset).toBeNull();
      expect(header.querySelector('[data-part="ornament"]'), preset).toBeNull();
      expect(header.querySelector('[data-part="divider"]'), preset).toBeNull();
      expect(header.querySelector('[data-part="affiliation"]'), preset).toBeNull();
      expect(container.querySelector("[data-section]"), preset).toBeNull();
      expect(container.querySelector('[data-part="sections"]')!.children, preset).toHaveLength(0);
      unmount();
    }
  });

  it("uses the text colour for Executive's main button, and the accent for Studio's", () => {
    const executive = renderCard({ card: withTheme({ preset: "executive" }) });
    expect(executive.root.style.getPropertyValue("--card-primary")).toBe(CARD_PRESETS.executive.theme.colors.text);
    executive.unmount();
    const studio = renderCard({ card: withTheme({ preset: "studio" }) });
    expect(studio.root.style.getPropertyValue("--card-primary")).toBe(CARD_PRESETS.studio.theme.colors.accent);
  });

  it("keeps the check beside the last word of a long chapter position", () => {
    renderCard({
      card: withTheme(
        { preset: "executive" },
        { shpe: { position: "External Representative and Corporate Relations Chair", member_since: null, national_member_verified: false, is_alumni: false } },
      ),
    });
    const text = screen.getByText("WashU SHPE · External Representative and Corporate Relations Chair");
    const glue = text.parentElement!;
    expect(glue).toHaveClass("whitespace-nowrap");
    expect(text).toHaveClass("whitespace-normal");
    expect(within(glue).getByRole("img", { name: "Verified by chapter officers" })).toBeInTheDocument();
  });
});

describe("BusinessCard monogram", () => {
  it("shows the photo when there is one", () => {
    const { container } = renderCard({ card: withTheme({ preset: "signature" }) });
    expect(container.querySelector('[data-part="avatar"] img')).not.toBeNull();
  });

  it("sets the initials as a monogram when there's no photo", () => {
    const { container } = renderCard({ card: withTheme({ preset: "signature" }, { avatar_path: null }) });
    const avatar = container.querySelector('[data-part="avatar"]')!;
    expect(avatar).toHaveAttribute("data-initials", "monogram");
    expect(avatar).toHaveTextContent("DG");
    expect(avatar.querySelector("img")).toBeNull();
  });

  it("shows just the name when the photo is switched off", () => {
    const { container } = renderCard({ card: withTheme({ preset: "signature", avatar: { shape: "hidden" } }) });
    expect(container.querySelector('[data-part="avatar"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Diego Gonzalez" })).toBeInTheDocument();
    expect(visiblePhotoPath(withTheme({ preset: "signature", avatar: { shape: "hidden" } }))).toBeNull();
  });

  it("keeps initial tiles for the other layouts, in the main button's colours", () => {
    const { container } = renderCard({ card: withTheme({ preset: "executive" }, { avatar_path: null }) });
    expect(container.querySelector('[data-part="avatar"]')).toHaveAttribute("data-initials", "tile");
  });
});

describe("BusinessCard link arrangements", () => {
  const MANY: PublicCardLink[] = [
    { id: "l-github", kind: "github", label: null, value: "https://github.com/diego", is_featured: false },
    { id: "l-linkedin", kind: "linkedin", label: null, value: "https://www.linkedin.com/in/diego", is_featured: false },
    { id: "l-email", kind: "email", label: null, value: "diego@wustl.edu", is_featured: false },
    { id: "l-insta", kind: "instagram", label: null, value: "https://www.instagram.com/diego", is_featured: false },
    { id: "l-site", kind: "portfolio", label: "Design work", value: "https://diego.design", is_featured: false },
  ];

  it("lays rows out with each link's address underneath, in the member's order", () => {
    const { container } = renderCard({
      card: withTheme({ preset: "executive" }, { sections: ["links"], links: MANY }),
    });
    const section = linksBlock(container);
    expect(section.dataset.arrangement).toBe("rows");
    expect(within(section).getByRole("heading", { level: 2, name: "Links" })).toBeVisible();
    const labels = [...section.querySelectorAll('[data-part="row-label"]')].map((el) => el.textContent);
    expect(labels).toEqual(["GitHub", "LinkedIn", "Email", "Instagram", "Design work"]);
    const details = [...section.querySelectorAll('[data-part="row-detail"]')].map((el) => el.textContent);
    expect(details).toEqual([
      "github.com/diego",
      "linkedin.com/in/diego",
      "diego@wustl.edu",
      "instagram.com/diego",
      "diego.design",
    ]);
    // Still real links, named by label then address, with a pause between.
    // (jsdom trims the space after the comma at the element boundary; browsers keep it.)
    expect(within(section).getByRole("link", { name: /^Email,\s?diego@wustl\.edu/ })).toHaveAttribute(
      "href",
      "mailto:diego@wustl.edu",
    );
  });

  it("numbers Editorial's rows like a contents page, without reading the numbers out", () => {
    const { container } = renderCard({
      card: withTheme({ preset: "editorial" }, { sections: ["links"], links: MANY }),
    });
    const first = within(linksBlock(container)).getAllByRole("link")[0];
    const number = first.querySelector('[aria-hidden="true"]')!;
    expect(number).toHaveTextContent("01");
    expect(first).toHaveAccessibleName(/^GitHub,\s?github\.com\/diego/);
  });

  it("groups links into work, professional and social, titled only when there's more than one group", () => {
    const { container, unmount } = renderCard({
      card: withTheme({ preset: "studio" }, { sections: ["links"], links: MANY }),
    });
    const section = linksBlock(container);
    expect(section.dataset.arrangement).toBe("grouped");
    expect([...section.querySelectorAll("[data-group]")].map((el) => (el as HTMLElement).dataset.group)).toEqual([
      "work",
      "professional",
      "social",
    ]);
    expect(within(section).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Work",
      "Professional",
      "Social",
    ]);
    const work = within(section).getByRole("list", { name: "Work" });
    expect(within(work).getAllByRole("link").map((a) => a.dataset.linkKind)).toEqual(["github", "portfolio"]);
    unmount();

    const onlyWork = renderCard({
      card: withTheme({ preset: "studio" }, { sections: ["links"], links: [MANY[0], MANY[4]] }),
    });
    const single = linksBlock(onlyWork.container);
    expect(within(single).queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(within(single).getAllByRole("link")).toHaveLength(2);
  });

  it("puts compact buttons in two columns, an odd last one across both", () => {
    const { container } = renderCard({
      card: withTheme({ preset: "heritage" }, { sections: ["links"], links: MANY }),
    });
    const section = linksBlock(container);
    expect(section.dataset.arrangement).toBe("compact");
    const items = section.querySelectorAll("li");
    expect(items).toHaveLength(5);
    expect(items[4].className).toMatch(/\[&:last-child:nth-child\(odd\)\]:col-\[1\/-1\]/);
    for (const link of within(section).getAllByRole("link")) expect(link.className).toMatch(/\bmin-h-11\b/);
  });

  it("works any arrangement with any preset, including the originals", () => {
    for (const arrangement of ["rows", "compact", "grouped"] as const) {
      const { container, unmount } = renderCard({
        card: withTheme({ preset: "sunrise", buttons: { arrangement } }, { sections: ["links"], links: MANY }),
      });
      const section = linksBlock(container);
      expect(section.dataset.arrangement).toBe(arrangement);
      expect(within(section).getAllByRole("link")).toHaveLength(5);
      unmount();
    }
  });
});

describe("BusinessCard featured link", () => {
  const featuredLink = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-section="featured"] a')!;

  it.each(["executive", "editorial", "studio", "slate", "heritage", "signature"] as const)(
    "lets Add to Contacts lead in %s: the featured link is outlined, at the same height",
    (preset) => {
      const { container } = renderCard({ card: withTheme({ preset }) });
      const block = container.querySelector<HTMLElement>('[data-section="featured"]')!;
      expect(block).toHaveAttribute("data-emphasis", "secondary");
      const link = featuredLink(container);
      expect(link).toHaveClass("border-(--card-accent)", "text-(--card-text)", "min-h-(--card-button-h)");
      expect(link).not.toHaveClass("bg-(--card-primary)");
      expect(link.className).not.toMatch(/min-h-\[calc/);
      expect(link).toHaveAccessibleName(/^Book a coffee chat/);
    },
  );

  it.each(["shpe-classic", "sunrise", "midnight", "paper", "washu", "engineer", "glass"] as const)(
    "keeps %s's featured link as the big filled button it was",
    (preset) => {
      const { container } = renderCard({ card: withTheme({ preset }) });
      expect(container.querySelector('[data-section="featured"]')).toHaveAttribute("data-emphasis", "primary");
      const link = featuredLink(container);
      expect(link).toHaveClass("bg-(--card-primary)", "text-lg");
      expect(link.className).toMatch(/min-h-\[calc\(var\(--card-button-h\)\+0\.75rem\)\]/);
    },
  );
});

describe("BusinessCard professional details", () => {
  it("rounds Executive's card more tightly than its buttons would", () => {
    const { container } = renderCard({ card: withTheme({ preset: "executive" }) });
    expect(container.querySelector("article")!.className).toMatch(/rounded-\[min\(var\(--card-radius\),0\.75rem\)\]/);
    const classic = renderCard({ card: withTheme({ preset: "shpe-classic" }) });
    expect(classic.container.querySelector("article")!.className).not.toMatch(/0\.75rem\)\]/);
  });

  it("puts the class year in Editorial's running head, and nothing when the card doesn't show one", () => {
    const { container, unmount } = renderCard({ card: withTheme({ preset: "editorial" }) });
    const masthead = container.querySelector('[data-part="masthead"]')!;
    expect(masthead).toHaveTextContent("WashU SHPE");
    expect(masthead.querySelector('[data-part="class-year"]')).toHaveTextContent("Class of 2027");
    expect(masthead).not.toHaveTextContent(/member profile/i);
    unmount();

    const noYear = renderCard({
      card: withTheme(
        { preset: "editorial" },
        { education: { major: "Computer Science", secondary_major: null, graduation_year: null, degree_level: null } },
      ),
    });
    const bare = noYear.container.querySelector('[data-part="masthead"]')!;
    expect(bare).toHaveTextContent(/^WashU SHPE$/);
    expect(bare.querySelector('[data-part="class-year"]')).toBeNull();
  });

  it("sets Studio's school as a line under the role, leaving location and chapter as the tags", () => {
    const { container } = renderCard({ card: withTheme({ preset: "studio" }) });
    const header = container.querySelector<HTMLElement>('[data-part="header"]')!;
    const tags = within(header).getByRole("list");
    expect(within(tags).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "St. Louis, MO",
      "WashU SHPE · President",
    ]);
    expect(tags).not.toHaveTextContent("Washington University in St. Louis");
    const school = within(header).getByText("Washington University in St. Louis");
    expect(school.tagName).toBe("P");
    // Role first, then school.
    const text = header.textContent ?? "";
    expect(text.indexOf("SWE Intern @ Boeing")).toBeLessThan(text.indexOf("Washington University in St. Louis"));
  });

  it("closes up the spaced capitals of a long affiliation, in Letterhead and Monogram", () => {
    for (const preset of ["heritage", "signature"] as const) {
      const short = renderCard({ card: withTheme({ preset }) });
      const shortLine = short.container.querySelector('[data-part="affiliation"]')!;
      expect(shortLine, preset).toHaveAttribute("data-length", "short");
      expect(shortLine, preset).toHaveClass("tracking-[0.2em]");
      short.unmount();

      const long = renderCard({
        card: withTheme(
          { preset },
          { organization: "McKelvey School of Engineering, Washington University in St. Louis" },
        ),
      });
      const longLine = long.container.querySelector('[data-part="affiliation"]')!;
      expect(longLine, preset).toHaveAttribute("data-length", "long");
      expect(longLine, preset).toHaveClass("tracking-[0.1em]");
      long.unmount();
    }
  });

  it("closes Letterhead with the double rule it opens with; every other layout keeps the hairline", () => {
    const heritage = renderCard({ card: withTheme({ preset: "heritage" }) });
    const footer = heritage.container.querySelector("footer")!;
    expect(footer.querySelector('[data-part="footer-rule"]')).toHaveAttribute("aria-hidden", "true");
    expect(footer).not.toHaveClass("border-t");
    expect(within(footer).getByRole("link", { name: /member of washu shpe/i })).toBeInTheDocument();
    heritage.unmount();

    for (const preset of ["executive", "shpe-classic"] as const) {
      const { container, unmount } = renderCard({ card: withTheme({ preset }) });
      const plain = container.querySelector("footer")!;
      expect(plain.querySelector('[data-part="footer-rule"]'), preset).toBeNull();
      expect(plain, preset).toHaveClass("border-t");
      unmount();
    }
  });

  it("uses a font stylesheet the page already has instead of adding a second", () => {
    // What the card-meta edge function writes into <head> before the app runs.
    for (const el of document.head.querySelectorAll("link[data-card-font]")) el.remove();
    const early = document.createElement("link");
    early.rel = "stylesheet";
    early.href = "https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap";
    early.dataset.cardFont = "instrument-serif";
    document.head.appendChild(early);

    renderCard({ card: withTheme({ preset: "editorial" }) });
    expect(document.head.querySelectorAll('link[data-card-font="instrument-serif"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('link[data-card-font="instrument-sans"]')).toHaveLength(1);
  });
});

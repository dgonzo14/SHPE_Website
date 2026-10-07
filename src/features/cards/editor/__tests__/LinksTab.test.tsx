import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { renderWithProviders } from "@/test/renderWithProviders";
import { cardFormSchema, type CardFormValues, type CardLinkFormValues } from "@/lib/validation";
import { emptyCardFormValues } from "../../viewModel";
import { CARD_LIMITS } from "../../model";
import { LinksTab } from "../LinksTab";

function link(overrides: Partial<CardLinkFormValues> & Pick<CardLinkFormValues, "kind" | "value">): CardLinkFormValues {
  return { id: null, label: "", is_featured: false, is_visible: true, ...overrides };
}

const THREE_LINKS = [
  link({ id: "l1", kind: "linkedin", value: "https://www.linkedin.com/in/ana" }),
  link({ id: "l2", kind: "github", value: "https://github.com/ana", is_featured: true }),
  link({ id: "l3", kind: "website", value: "https://ana.dev", label: "My site" }),
];

/** The form's links as JSON, so tests can assert on what would be saved. */
function Values({ control }: { control: Control<CardFormValues> }) {
  const links = useWatch({ name: "links", control });
  return <div data-testid="links">{JSON.stringify(links)}</div>;
}

function Harness({ links, sections }: { links: CardLinkFormValues[]; sections?: CardFormValues["sections"] }) {
  const base = emptyCardFormValues({ first_name: "Ana", last_name: "Rivera" }, "ana-rivera");
  const form = useForm<CardFormValues>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: { ...base, links, sections: sections ?? base.sections },
    mode: "onTouched",
  });
  return (
    <>
      <LinksTab form={form} />
      <Values control={form.control} />
    </>
  );
}

function setup(links: CardLinkFormValues[] = [], sections?: CardFormValues["sections"]) {
  const user = userEvent.setup();
  renderWithProviders(<Harness links={links} sections={sections} />, { route: "/portal/card" });
  const values = () => JSON.parse(screen.getByTestId("links").textContent ?? "[]") as CardLinkFormValues[];
  return { user, values };
}

describe("LinksTab: adding", () => {
  it("opens the picker straight away when there are no links, and focuses the new field", async () => {
    const { user, values } = setup();

    expect(screen.getByRole("button", { name: "Add a link" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Add LinkedIn" }));

    const field = screen.getByLabelText("LinkedIn link");
    await waitFor(() => expect(field).toHaveFocus());
    expect(values()).toEqual([link({ kind: "linkedin", value: "" })]);
    expect(screen.getByRole("button", { name: "Add a link" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Added a LinkedIn link.")).toBeInTheDocument();
  });

  it("offers all sixteen kinds, each with its name", async () => {
    const { user } = setup(THREE_LINKS);
    await user.click(screen.getByRole("button", { name: "Add a link" }));

    const picker = screen.getByRole("list", { name: "What kind of link?" });
    expect(within(picker).getAllByRole("button")).toHaveLength(16);
    expect(within(picker).getByRole("button", { name: "Add Résumé" })).toBeInTheDocument();
  });

  it("tidies a username into the full link when the field is left", async () => {
    const { user, values } = setup();
    await user.click(screen.getByRole("button", { name: "Add LinkedIn" }));

    await user.type(screen.getByLabelText("LinkedIn link"), "ana-rivera");
    await user.tab();

    expect(screen.getByLabelText("LinkedIn link")).toHaveValue("https://www.linkedin.com/in/ana-rivera");
    expect(values()[0].value).toBe("https://www.linkedin.com/in/ana-rivera");
    // A tidied value is valid, so no error flashes.
    expect(screen.queryByText(/Enter a full link/)).not.toBeInTheDocument();
  });

  it("explains a value that can't be made into a link", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Add Website" }));

    await user.type(screen.getByLabelText("Website link"), "javascript:alert(1)");
    await user.tab();

    expect(await screen.findByText("Enter a full link starting with https://")).toBeInTheDocument();
  });

  it("warns plainly that an email address or phone number on the card is public", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Add Email" }));
    expect(screen.getByText(/Everything on your card is public.*can see this address/)).toBeInTheDocument();
    // Heard with the field too, not only shown beside it.
    expect(screen.getByLabelText("Email address")).toHaveAccessibleDescription(
      /Everything on your card is public/,
    );

    await user.click(screen.getByRole("button", { name: "Add a link" }));
    await user.click(screen.getByRole("button", { name: "Add Phone" }));
    expect(screen.getByText(/Everything on your card is public.*can see this number/)).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveAccessibleDescription(/can see this number/);
  });

  it(`stops at ${CARD_LIMITS.links} links`, () => {
    const many = Array.from({ length: CARD_LIMITS.links }, (_, i) =>
      link({ id: `id-${i}`, kind: "custom", value: `https://example.com/${i}`, label: `Link ${i}` }),
    );
    setup(many);

    expect(screen.getByRole("button", { name: "Add a link" })).toBeDisabled();
    expect(screen.getByText(/That's the most a card can hold \(20 links\)/)).toBeInTheDocument();
  });
});

describe("LinksTab: arranging", () => {
  it("moves a link up and down, and says where it went", async () => {
    const { user, values } = setup(THREE_LINKS);

    await user.click(screen.getByRole("button", { name: "Move My site up" }));
    expect(values().map((l) => l.id)).toEqual(["l1", "l3", "l2"]);
    expect(screen.getByText("My site moved to position 2 of 3.")).toBeInTheDocument();
    // The same button, now in its new row, keeps focus.
    expect(screen.getByRole("button", { name: "Move My site up" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Move LinkedIn down" }));
    expect(values().map((l) => l.id)).toEqual(["l3", "l1", "l2"]);
  });

  it("keeps the end buttons focusable but inert", async () => {
    const { user, values } = setup(THREE_LINKS);
    const up = screen.getByRole("button", { name: "Move LinkedIn up" });

    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(up).toBeEnabled();
    await user.click(up);

    expect(values().map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
    expect(screen.getByRole("button", { name: "Move My site down" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("features one link at a time", async () => {
    const { user, values } = setup(THREE_LINKS);
    const linkedin = screen.getByRole("listitem", { name: /LinkedIn, link 1 of 3/ });

    await user.click(within(linkedin).getByRole("checkbox", { name: /^Feature this link/ }));

    expect(values().map((l) => l.is_featured)).toEqual([true, false, false]);
    expect(within(linkedin).getByText("Featured")).toBeInTheDocument();
    expect(screen.getByText("LinkedIn is now your featured link.")).toBeInTheDocument();

    await user.click(within(linkedin).getByRole("checkbox", { name: /^Feature this link/ }));
    expect(values().map((l) => l.is_featured)).toEqual([false, false, false]);
  });

  it("notes when the Featured block is off, so a featured link sits with the others", () => {
    setup(THREE_LINKS, ["links", "about"]);
    const github = screen.getByRole("listitem", { name: /GitHub, link 2 of 3/ });

    expect(within(github).getByText(/Your Featured block is turned off/)).toBeInTheDocument();
  });

  it("hides a link without deleting it", async () => {
    const { user, values } = setup(THREE_LINKS);
    const site = screen.getByRole("listitem", { name: /My site, link 3 of 3/ });

    await user.click(within(site).getByRole("checkbox", { name: /^Show on my card/ }));

    expect(values()[2]).toMatchObject({ id: "l3", is_visible: false });
    expect(within(site).getByText("Hidden")).toBeInTheDocument();
  });

  it("removes a link and moves focus to the next one", async () => {
    const { user, values } = setup(THREE_LINKS);

    await user.click(screen.getByRole("button", { name: "Remove GitHub" }));

    expect(values().map((l) => l.id)).toEqual(["l1", "l3"]);
    expect(screen.getByText(/GitHub removed\. Save to make it permanent/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /My site, link 2 of 2/ })).toHaveFocus(),
    );
  });

  it("moves focus to Add a link when the last link goes", async () => {
    const { user, values } = setup([THREE_LINKS[0]]);

    await user.click(screen.getByRole("button", { name: "Remove LinkedIn" }));

    expect(values()).toEqual([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add a link" })).toHaveFocus());
  });

  it("uses a custom label as the link's name everywhere", async () => {
    const { user } = setup([THREE_LINKS[0]]);

    await user.type(screen.getByLabelText("Button text"), "Let's connect");

    expect(screen.getByRole("button", { name: "Remove Let's connect" })).toBeInTheDocument();
  });
});

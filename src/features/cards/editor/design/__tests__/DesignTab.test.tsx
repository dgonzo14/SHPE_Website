import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { renderWithProviders } from "@/test/renderWithProviders";
import { cardFormSchema, cardThemeSchema, type CardFormValues } from "@/lib/validation";
import type { ImageFieldProps } from "../../../ImageField";
import { emptyCardFormValues } from "../../../viewModel";
import type { CardTheme } from "../../../model";
import { resolveTheme, themeContrastIssues } from "../../../themes";
import { DesignTab } from "../DesignTab";
import { applyThemePatch, contrastFix } from "../themeEdit";

const MEMBER = "11111111-1111-4111-8111-111111111111";

/** True when no value anywhere in the object is undefined (JSON would drop it silently). */
function hasNoUndefined(value: unknown): boolean {
  if (value === undefined) return false;
  if (value && typeof value === "object") return Object.values(value).every(hasNoUndefined);
  return true;
}
const BACKGROUND = `${MEMBER}/33333333-3333-4333-8333-333333333333.webp`;

// The uploader has its own tests; here it only has to hand back a path.
vi.mock("../../../ImageField", () => ({
  ImageField: (props: ImageFieldProps) => (
    <div>
      <p>{props.label}</p>
      <p data-testid="image-value">{props.value ?? "none"}</p>
      <button type="button" onClick={() => props.onChange(BACKGROUND)}>
        Fake upload
      </button>
    </div>
  ),
}));

// The editor renders the Design tab inside its <form>, with a submit button
// (Save). No control on the tab may submit it.
const submitted = vi.fn();
afterEach(() => {
  expect(submitted).not.toHaveBeenCalled();
});

function Harness({
  initial,
  onForm,
  nationalMemberVerified,
}: {
  initial: Partial<CardFormValues>;
  onForm: (form: UseFormReturn<CardFormValues>) => void;
  nationalMemberVerified?: boolean;
}) {
  const form = useForm<CardFormValues>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: { ...emptyCardFormValues({ first_name: "Ana", last_name: "Rivera" }, "ana-rivera"), ...initial },
  });
  useEffect(() => {
    onForm(form);
  }, [form, onForm]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitted();
      }}
    >
      <output data-testid="dirty">{String(form.formState.isDirty)}</output>
      <DesignTab form={form} memberId={MEMBER} nationalMemberVerified={nationalMemberVerified} />
      <button type="submit">Save</button>
    </form>
  );
}

function setup(initial: Partial<CardFormValues> = {}, { nationalMemberVerified = false } = {}) {
  const ref: { form: UseFormReturn<CardFormValues> | null } = { form: null };
  const user = userEvent.setup();
  renderWithProviders(
    <Harness
      initial={initial}
      onForm={(form) => (ref.form = form)}
      nationalMemberVerified={nationalMemberVerified}
    />,
    { route: "/portal/card" },
  );
  const form = () => {
    if (!ref.form) throw new Error("form not ready");
    return ref.form;
  };
  return { user, form, theme: () => form().getValues("theme") };
}

describe("DesignTab: presets", () => {
  it("applies a preset straight away when nothing has been customised", async () => {
    const { user, theme } = setup();
    expect(screen.getByRole("button", { name: "SHPE Classic" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Midnight" }));

    expect(theme()).toEqual({ preset: "midnight" });
    expect(screen.getByRole("button", { name: "Midnight" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms before a preset replaces the member's overrides, and resets them", async () => {
    const { user, theme } = setup({
      theme: { preset: "shpe-classic", layout: "split", colors: { accent: "#0b5cad" } },
    });

    await user.click(screen.getByRole("button", { name: "Sunrise" }));
    const dialog = screen.getByRole("dialog", { name: "Switch to Sunrise?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(theme()).toEqual({ preset: "shpe-classic", layout: "split", colors: { accent: "#0b5cad" } });

    await user.click(screen.getByRole("button", { name: "Sunrise" }));
    await user.click(screen.getByRole("button", { name: "Use Sunrise" }));
    expect(theme()).toEqual({ preset: "sunrise" });
  });

  it("offers a reset back to the current preset once something is customised", async () => {
    const { user, theme } = setup({ theme: { preset: "paper", density: "compact" } });

    await user.click(screen.getByRole("button", { name: "Reset to Paper" }));
    await user.click(screen.getByRole("button", { name: "Reset design" }));

    expect(theme()).toEqual({ preset: "paper" });
    expect(screen.queryByRole("button", { name: "Reset to Paper" })).not.toBeInTheDocument();
    // Reset went away with the overrides; focus lands on the preset just restored.
    await waitFor(() => expect(screen.getByRole("button", { name: "Paper" })).toHaveFocus());
  });

  it("returns focus to the preset chosen when switching with overrides", async () => {
    const { user } = setup({ theme: { preset: "paper", density: "compact" } });
    await user.click(screen.getByRole("button", { name: "Sunrise" }));
    await user.click(screen.getByRole("button", { name: "Use Sunrise" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sunrise" })).toHaveFocus());
  });

  it("groups the presets: the professional collection, then the seven originals", () => {
    setup();
    const names = (group: HTMLElement) => within(group).getAllByRole("button").map((b) => b.textContent);
    const professional = screen.getByRole("group", { name: "Professional" });
    const originals = screen.getByRole("group", { name: "Originals" });
    expect(within(professional).getAllByRole("button").map((b) => b.getAttribute("data-preset"))).toEqual([
      "executive",
      "editorial",
      "studio",
      "slate",
      "heritage",
      "signature",
    ]);
    expect(within(originals).getAllByRole("button").map((b) => b.getAttribute("data-preset"))).toEqual([
      "shpe-classic",
      "sunrise",
      "midnight",
      "paper",
      "washu",
      "engineer",
      "glass",
    ]);
    // Each says what it's for, and draws a miniature of its own layout.
    const executive = within(professional).getByRole("button", { name: "Executive" });
    expect(executive).toHaveAccessibleDescription(/navy and ivory/i);
    expect(executive.querySelector("[data-miniature]")).toHaveAttribute("data-miniature", "profile");
    expect(names(originals)).toHaveLength(7);
  });

  it("applies a professional preset straight away, keeping the content as it is", async () => {
    const { user, theme, form } = setup({ headline: "SWE Intern", avatar_path: null });
    await user.click(screen.getByRole("button", { name: "Signature" }));
    expect(theme()).toEqual({ preset: "signature" });
    expect(screen.getByRole("button", { name: "Signature" })).toHaveAttribute("aria-pressed", "true");
    expect(form().getValues("headline")).toBe("SWE Intern");
    // The member's name is drawn into the miniatures.
    expect(within(screen.getByRole("button", { name: "Signature" })).getByText("Ana Rivera")).toBeInTheDocument();
  });

  it("marks a customised preset as such, and resets it to its own defaults", async () => {
    const { user, theme } = setup({ theme: { preset: "executive" } });
    await user.click(within(screen.getByRole("group", { name: "Add to Contacts" })).getByRole("radio", { name: /Accent color/ }));
    expect(theme()).toEqual({ preset: "executive", buttons: { primary: "accent" } });
    expect(within(screen.getByRole("button", { name: "Executive" })).getByText("Customized")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset to Executive" }));
    await user.click(screen.getByRole("button", { name: "Reset design" }));
    expect(theme()).toEqual({ preset: "executive" });
    expect(within(screen.getByRole("button", { name: "Executive" })).getByText("Selected")).toBeInTheDocument();
  });
});

describe("DesignTab: the professional design options", () => {
  it("picks any of the new layouts for any preset", async () => {
    const { user, theme } = setup();
    for (const [label, layout] of [
      ["Profile", "profile"],
      ["Editorial", "editorial"],
      ["Studio", "studio"],
      ["Layered", "layered"],
      ["Letterhead", "letterhead"],
      ["Monogram", "monogram"],
    ] as const) {
      await user.click(screen.getByRole("radio", { name: label }));
      expect(theme()).toEqual({ preset: "shpe-classic", layout });
    }
  });

  it("chooses the main button colour, hairline buttons and the new arrangements", async () => {
    const { user, theme } = setup();
    await user.click(within(screen.getByRole("group", { name: "Add to Contacts" })).getByRole("radio", { name: /Text color/ }));
    await user.click(screen.getByRole("radio", { name: "Hairline" }));
    await user.click(screen.getByRole("radio", { name: "Rows" }));
    expect(theme().buttons).toEqual({ primary: "ink", style: "hairline", arrangement: "rows" });

    await user.click(screen.getByRole("radio", { name: "Two columns" }));
    expect(theme().buttons?.arrangement).toBe("compact");
    await user.click(screen.getByRole("radio", { name: "Grouped" }));
    expect(theme().buttons?.arrangement).toBe("grouped");
  });

  it("offers spacious spacing", async () => {
    const { user, theme } = setup();
    await user.click(screen.getByRole("radio", { name: "Spacious" }));
    expect(theme()).toEqual({ preset: "shpe-classic", density: "spacious" });
    expect(cardThemeSchema.safeParse(theme()).success).toBe(true);
  });

  it("explains the monogram's photo choices", async () => {
    const { user } = setup({ theme: { preset: "signature" } });
    expect(screen.getByText(/Without one, the Monogram layout shows your initials/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Profile" }));
    expect(screen.queryByText(/Without one, the Monogram layout shows your initials/)).not.toBeInTheDocument();
  });
});

describe("DesignTab: colors", () => {
  it("writes a typed hex colour to theme.colors", async () => {
    const { user, theme } = setup();
    const hex = screen.getByLabelText("Accent, hex code");

    await user.clear(hex);
    await user.type(hex, "#0B5");
    // Shorthand waits for blur, so half-typed text never reaches the card.
    expect(theme().colors).toBeUndefined();
    await user.type(hex, "CAD");

    expect(theme()).toEqual({ preset: "shpe-classic", colors: { accent: "#0b5cad" } });
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
  });

  it("expands three-digit shorthand on blur", async () => {
    const { user, theme } = setup();
    const hex = screen.getByLabelText("Text, hex code");

    await user.clear(hex);
    await user.type(hex, "123");
    await user.tab();

    expect(theme().colors).toEqual({ text: "#112233" });
    expect(hex).toHaveValue("#112233");
  });

  it("applies a colour on Enter without submitting the editor's form", async () => {
    const { user, theme } = setup();
    const hex = screen.getByLabelText("Accent, hex code");

    await user.clear(hex);
    await user.type(hex, "#fa0{Enter}");

    expect(theme().colors).toEqual({ accent: "#ffaa00" });
    // afterEach checks the form wasn't submitted.
  });

  it("proves the harness would catch a submit", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submitted).toHaveBeenCalledTimes(1);
    submitted.mockClear();
  });

  it("writes the colour picker's value", () => {
    const { theme } = setup();
    fireEvent.change(screen.getByLabelText("Text, color picker"), { target: { value: "#222222" } });
    expect(theme().colors).toEqual({ text: "#222222" });
  });

  it("explains an invalid hex on blur and writes nothing", async () => {
    const { user, theme } = setup();
    const hex = screen.getByLabelText("Card, hex code");

    await user.clear(hex);
    await user.type(hex, "navy");
    await user.tab();

    expect(screen.getByText("Use a hex color like #1b365d")).toBeInTheDocument();
    expect(hex).toHaveAttribute("aria-invalid", "true");
    expect(theme()).toEqual({ preset: "shpe-classic" });
  });

  it("resets one colour to the preset", async () => {
    const { user, theme } = setup({ theme: { preset: "washu", colors: { accent: "#111111", text: "#222222" } } });

    await user.click(screen.getByRole("button", { name: "Reset accent to the preset color" }));

    expect(theme()).toEqual({ preset: "washu", colors: { text: "#222222" } });
    expect(screen.queryByRole("button", { name: "Reset accent to the preset color" })).not.toBeInTheDocument();
    // Reset went away; focus is on the hex box showing the colour put back.
    expect(screen.getByLabelText("Accent, hex code")).toHaveFocus();
  });

  it("lists contrast problems live and applies a suggested colour", async () => {
    const { user, theme } = setup();
    expect(screen.queryByRole("region", { name: /hard to read/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Card, color picker"), { target: { value: "#2a4a70" } });

    const panel = screen.getByRole("region", { name: /hard to read/ });
    const fixes = within(panel).getAllByRole("button", { name: /^Use #[0-9a-f]{6} for / });
    expect(fixes.length).toBeGreaterThan(0);
    expect(screen.getByText(/Readability check: \d colors? needs? fixing/)).toBeInTheDocument();

    // Apply suggestions until the panel is satisfied; each one fixes its own rule.
    for (let guard = 0; guard < 10 && screen.queryByRole("region", { name: /hard to read/ }); guard += 1) {
      const [first] = within(screen.getByRole("region", { name: /hard to read/ })).getAllByRole("button", {
        name: /^Use #/,
      });
      await user.click(first);
    }

    expect(screen.queryByRole("region", { name: /hard to read/ })).not.toBeInTheDocument();
    expect(themeContrastIssues(resolveTheme(theme()))).toEqual([]);
    expect(screen.getByText("Readability check: every color passes.")).toBeInTheDocument();
  });

  it("moves focus to the next problem after a fix, and to Colors after the last", async () => {
    const { user } = setup({ theme: { preset: "shpe-classic", colors: { surface: "#2a4a70" } } });
    const region = () => screen.queryByRole("region", { name: /hard to read/ });
    const fixButtons = () => within(region() as HTMLElement).getAllByRole("button", { name: /^Use #/ });
    expect(fixButtons().length).toBeGreaterThan(1);

    await user.click(fixButtons()[0]);

    // The button pressed went with its problem; the next problem's fix has focus.
    await waitFor(() => expect(fixButtons()[0]).toHaveFocus());

    for (let guard = 0; guard < 10 && region(); guard += 1) {
      await user.click(fixButtons()[0]);
      await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    }

    expect(region()).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Colors" })).toHaveFocus();
  });

  it("applies exactly the suggested colour to the colour it names", async () => {
    const { user, theme } = setup({ theme: { preset: "shpe-classic", colors: { muted: "#d1d5db" } } });
    const panel = screen.getByRole("region", { name: "One color is hard to read" });
    const fix = within(panel).getByRole("button", { name: /for secondary text$/ });
    const suggested = fix.getAttribute("aria-label")?.match(/#[0-9a-f]{6}/)?.[0];

    await user.click(fix);

    expect(theme().colors?.muted).toBe(suggested);
    expect(screen.queryByRole("region", { name: /hard to read/ })).not.toBeInTheDocument();
  });
  it("offers the preset's colors when no single change can fix a problem", async () => {
    // A frosted card over a bright page: once the easy fixes are applied, the
    // last problem can't be solved by changing any one colour.
    let stuck: CardTheme = {
      preset: "glass",
      colors: { background: "#27fcd3", surface: "#a7a518", muted: "#f05855", accent: "#0a92e6" },
    };
    for (let i = 0; i < 10; i += 1) {
      const fix = themeContrastIssues(resolveTheme(stuck))
        .map((issue) => contrastFix(stuck, issue))
        .find(Boolean);
      if (!fix) break;
      stuck = applyThemePatch(stuck, { colors: { [fix.key]: fix.color } });
    }
    expect(themeContrastIssues(resolveTheme(stuck)).length).toBeGreaterThan(0);

    const { user, theme } = setup({ theme: stuck });
    expect(screen.getByText(/No single color change fixes this one/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use Glass's colors" }));

    expect(theme()).toEqual({ preset: "glass" });
    expect(screen.queryByRole("region", { name: /hard to read/ })).not.toBeInTheDocument();
  });
});

describe("DesignTab: layout, background, fonts, buttons", () => {
  it("chooses a layout from a radio group", async () => {
    const { user, theme } = setup();
    const group = screen.getByRole("group", { name: "Layout" });
    expect(within(group).getByRole("radio", { name: "Classic" })).toBeChecked();

    await user.click(within(group).getByRole("radio", { name: "Banner" }));

    expect(theme()).toEqual({ preset: "shpe-classic", layout: "banner" });
    expect(within(group).getByRole("radio", { name: "Banner" })).toBeChecked();
  });

  it("switches to a gradient and sets its angle", async () => {
    const { user, theme } = setup();
    await user.click(screen.getByRole("radio", { name: "Gradient" }));
    expect(theme().background).toEqual({ type: "gradient" });

    const angle = screen.getByRole("slider", { name: "Angle" });
    expect(angle).toHaveAttribute("aria-valuetext", "135 degrees");
    fireEvent.change(angle, { target: { value: "90" } });

    expect(theme().background).toEqual({ type: "gradient", angle: 90 });
  });

  it("uses a background photo through the image field, with a dim slider", async () => {
    const { user, form, theme } = setup();
    await user.click(screen.getByRole("radio", { name: "Photo" }));
    expect(screen.getByText("Background photo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fake upload" }));
    expect(form().getValues("background_path")).toBe(BACKGROUND);
    expect(screen.getByTestId("image-value")).toHaveTextContent(BACKGROUND);

    fireEvent.change(screen.getByRole("slider", { name: "Darken the photo" }), { target: { value: "60" } });
    expect(theme().background).toEqual({ type: "image", dim: 60 });
  });

  it("picks a pattern", async () => {
    const { user, theme } = setup();
    await user.click(screen.getByRole("radio", { name: "Pattern" }));
    await user.click(screen.getByRole("radio", { name: "Blueprint grid" }));
    expect(theme().background).toEqual({ type: "pattern", pattern: "grid" });
  });

  it("chooses fonts, with each option named", async () => {
    const { user, theme } = setup();
    const heading = screen.getByLabelText("Name font");
    expect(within(heading).getByRole("option", { name: "Libre Franklin (preset)" })).toBeInTheDocument();

    await user.selectOptions(heading, "playfair-display");
    await user.selectOptions(screen.getByLabelText("Text font"), "inter");

    expect(theme().font).toEqual({ heading: "playfair-display", body: "inter" });
    expect(document.head.querySelector('link[data-card-font="playfair-display"]')).not.toBeNull();
  });

  it("sets button shape, style, arrangement and icons", async () => {
    const { user, theme } = setup();
    const [buttonShape] = screen.getAllByRole("group", { name: "Shape" });
    await user.click(within(buttonShape).getByRole("radio", { name: "Pill" }));
    await user.click(screen.getByRole("radio", { name: "Soft" }));
    await user.click(screen.getByRole("radio", { name: "Icon grid" }));
    await user.click(screen.getByRole("checkbox", { name: /Show icons on buttons/ }));

    expect(theme().buttons).toEqual({ shape: "pill", style: "soft", arrangement: "icon-grid", icons: false });
  });

  it("sets the photo shape and ring, and the spacing", async () => {
    const { user, theme } = setup();
    const [, photoShape] = screen.getAllByRole("group", { name: "Shape" });
    await user.click(within(photoShape).getByRole("radio", { name: "Rounded" }));
    expect(theme().avatar).toEqual({ shape: "rounded" });
    await user.click(screen.getByRole("checkbox", { name: /Ring around the photo/ }));
    expect(theme().avatar).toEqual({ shape: "rounded", ring: false });

    await user.click(within(photoShape).getByRole("radio", { name: "No photo" }));
    expect(screen.getByRole("checkbox", { name: /Ring around the photo/ })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Compact" }));

    expect(theme()).toEqual({
      preset: "shpe-classic",
      avatar: { shape: "hidden", ring: false },
      density: "compact",
    });
  });

  it("leaves the whole form valid after a run of edits, with no undefined keys in the theme", async () => {
    const { user, form, theme } = setup();
    await user.click(screen.getByRole("radio", { name: "Split" }));
    await user.click(screen.getByRole("radio", { name: "Gradient" }));
    fireEvent.change(screen.getByLabelText("Gradient start, color picker"), { target: { value: "#000000" } });
    await user.selectOptions(screen.getByLabelText("Name font"), "jetbrains-mono");
    // Setting values back to the preset's must remove the keys, not leave them undefined.
    await user.click(screen.getByRole("radio", { name: "Classic" }));
    await user.click(screen.getByRole("radio", { name: "Solid color" }));
    fireEvent.change(screen.getByLabelText("Accent, color picker"), { target: { value: "#0b5cad" } });
    await user.click(screen.getByRole("button", { name: "Reset accent to the preset color" }));

    const stored = theme();
    expect(cardThemeSchema.safeParse(stored).success).toBe(true);
    expect(hasNoUndefined(stored)).toBe(true);
    // What reaches the database is exactly what the form holds.
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
    expect(stored).toEqual({
      preset: "shpe-classic",
      background: { type: "solid", from: "#000000" },
      font: { heading: "jetbrains-mono" },
    });
    expect(await form().trigger()).toBe(true);
  });
});

describe("DesignTab: block order", () => {
  it("moves a block, keeping focus on the button pressed", async () => {
    const { user, form } = setup();
    const up = screen.getByRole("button", { name: "Move Links up" });

    await user.click(up);

    expect(form().getValues("sections")).toEqual(["status", "links", "featured", "about", "education", "shpe"]);
    expect(screen.getByRole("button", { name: "Move Links up" })).toHaveFocus();
    expect(screen.getByText("Links moved to position 2 of 6.")).toBeInTheDocument();
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
  });

  it("moves focus to the other arrow when a block reaches the top", async () => {
    const { user, form } = setup({ sections: ["status", "links"] });
    await user.click(screen.getByRole("button", { name: "Move Links up" }));

    expect(form().getValues("sections")).toEqual(["links", "status"]);
    expect(screen.getByRole("button", { name: "Move Links up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Links down" })).toHaveFocus();
  });

  it("hides a block and shows it again at the end", async () => {
    const { user, form } = setup();

    await user.click(screen.getByRole("button", { name: "Hide About" }));
    expect(form().getValues("sections")).toEqual(["status", "featured", "links", "education", "shpe"]);
    expect(screen.getByRole("button", { name: "Show About" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Show Skills" }));
    expect(form().getValues("sections")).toEqual(["status", "featured", "links", "education", "shpe", "skills"]);
    expect(screen.getByRole("button", { name: "Move Skills up" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Move Skills down" })).toBeDisabled();
  });

  it("explains the fixed parts and the blocks that would be empty", () => {
    setup();
    expect(screen.getByText(/Always on your card, whatever you choose here/)).toBeInTheDocument();
    expect(screen.getByText("Empty for now: star a link on the Links tab.")).toBeInTheDocument();
  });

  const shpeRow = () => screen.getByText("SHPE", { selector: "p" }).closest("li") as HTMLElement;

  it("says the SHPE block holds member-since and the National badge, not the chapter position", () => {
    setup();
    expect(shpeRow()).toHaveTextContent("Your member-since date and verified National badge.");
    // Hiding the block leaves the position under the name; the toggle that removes it is named.
    expect(shpeRow()).toHaveTextContent(/chapter position shows under your name/);
    expect(shpeRow()).toHaveTextContent(/“Show my chapter position” on the Content tab/);
    expect(shpeRow()).not.toHaveTextContent(/Your chapter position, member-since/);
  });

  it("notes when the SHPE block would show nothing", () => {
    setup({ show_member_since: false, show_national_member: true });
    expect(shpeRow()).toHaveTextContent(/Empty for now: turn on “Show when I joined WashU SHPE”/);
    expect(shpeRow()).toHaveTextContent(/once an officer verifies your membership/);
  });

  it("points a verified member whose badge is switched off at both toggles", () => {
    setup({ show_member_since: false, show_national_member: false }, { nationalMemberVerified: true });
    expect(shpeRow()).toHaveTextContent(/“Show my SHPE National membership”/);
  });

  it("has no empty note for the SHPE block once something in it shows", () => {
    setup({ show_member_since: true });
    expect(shpeRow()).not.toHaveTextContent(/Empty for now/);
  });

  it("has no empty note for the SHPE block when the verified badge shows", () => {
    setup({ show_member_since: false, show_national_member: true }, { nationalMemberVerified: true });
    expect(shpeRow()).not.toHaveTextContent(/Empty for now/);
  });
});

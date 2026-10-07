import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { renderWithProviders } from "@/test/renderWithProviders";
import { cardFormSchema, type CardFormValues } from "@/lib/validation";
import type { HandleAvailability } from "@/types/database";
import { emptyCardFormValues } from "../../viewModel";
import { HandleField } from "../HandleField";

const checkCardHandle = vi.hoisted(() => vi.fn<(handle: string) => Promise<HandleAvailability>>());

vi.mock("@/services/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cards")>()),
  checkCardHandle,
}));

function Harness({
  handle,
  savedHandle = null,
  chipHandle = null,
  chipHandleActive = null,
}: {
  handle: string;
  savedHandle?: string | null;
  chipHandle?: string | null;
  chipHandleActive?: boolean | null;
}) {
  const form = useForm<CardFormValues>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: { ...emptyCardFormValues({ first_name: "Ana", last_name: "Rivera" }, null), handle },
    mode: "onTouched",
  });
  return (
    <HandleField
      control={form.control}
      savedHandle={savedHandle}
      chipHandle={chipHandle}
      chipHandleActive={chipHandleActive}
    />
  );
}

function setup(props: Parameters<typeof Harness>[0]) {
  const user = userEvent.setup();
  renderWithProviders(<Harness {...props} />, { route: "/portal/card" });
  return { user, input: screen.getByLabelText(/^handle/i) };
}

beforeEach(() => {
  checkCardHandle.mockReset();
  checkCardHandle.mockResolvedValue("available");
});

describe("HandleField", () => {
  it("lowercases what's typed, turns spaces into hyphens, and shows the address", async () => {
    const { user, input } = setup({ handle: "" });

    await user.type(input, "Ana Rivera");

    expect(input).toHaveValue("ana-rivera");
    expect(screen.getByText(/card\/ana-rivera$/)).toBeInTheDocument();
    expect(await screen.findByText("Available. Saving your card claims it.")).toBeInTheDocument();
  });

  it("waits for typing to pause before asking, and asks once", async () => {
    const { user, input } = setup({ handle: "" });

    await user.type(input, "ana-codes");

    await screen.findByText("Available. Saving your card claims it.");
    expect(checkCardHandle).toHaveBeenCalledTimes(1);
    expect(checkCardHandle).toHaveBeenCalledWith("ana-codes");
  });

  it.each<[HandleAvailability, RegExp]>([
    ["taken", /Someone else has this handle/],
    ["reserved", /kept for the chapter/],
    ["invalid", /isn't allowed/],
    ["yours", /You've used this handle before, so it's still yours/],
    ["removed", /An officer removed this handle from your card, so you can't use it again/],
  ])("explains a %s handle", async (answer, message) => {
    checkCardHandle.mockResolvedValue(answer);
    setup({ handle: "ana-rivera" });

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("marks the field invalid when the handle can't be used", async () => {
    checkCardHandle.mockResolvedValue("taken");
    const { input } = setup({ handle: "ana-rivera" });

    await screen.findByText(/Someone else has this handle/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    // The answer is in a live region the field points at, so it's heard in place.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Someone else has this handle/);
    expect(input.getAttribute("aria-describedby")).toContain(status.id);
  });

  it("flags a malformed handle straight away, without asking the server", async () => {
    const { user, input } = setup({ handle: "" });

    await user.type(input, "ana_r");

    expect(
      screen.getByText(/Use letters, numbers and single hyphens/),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(checkCardHandle).not.toHaveBeenCalled();
  });

  it("doesn't nag about length on the first keystroke", async () => {
    const { user, input } = setup({ handle: "" });

    await user.type(input, "a");
    expect(screen.queryByText("Use at least 3 characters")).not.toBeInTheDocument();

    await user.tab();
    expect(await screen.findByText("Use at least 3 characters")).toBeInTheDocument();
  });

  it("calls a reserved word reserved before the server is asked", async () => {
    const { user, input } = setup({ handle: "" });

    await user.type(input, "president");

    expect(screen.getByText("That handle is reserved")).toBeInTheDocument();
    expect(checkCardHandle).not.toHaveBeenCalled();
  });

  it("doesn't check the card's own current handle", async () => {
    setup({ handle: "ana-rivera", savedHandle: "ana-rivera" });

    expect(screen.getByText("This is your card's current address.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkCardHandle).not.toHaveBeenCalled();
  });

  it("says the old address keeps forwarding when renaming a saved card", async () => {
    const { user, input } = setup({ handle: "ana-rivera", savedHandle: "ana-rivera" });

    await user.clear(input);
    await user.type(input, "ana-r");

    expect(await screen.findByText(/After you save, your old address forwards here/)).toBeInTheDocument();
  });

  it("says when the handle couldn't be checked, without blocking the save", async () => {
    checkCardHandle.mockRejectedValue(new Error("offline"));
    const { input } = setup({ handle: "ana-rivera" });

    expect(await screen.findByText(/We couldn't check this handle just now/)).toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("marks a removed handle unusable, so the member picks another", async () => {
    checkCardHandle.mockResolvedValue("removed");
    const { input } = setup({ handle: "ana-rivera", savedHandle: "ana-codes" });

    await screen.findByText(/An officer removed this handle from your card/);
    expect(screen.getByRole("status")).toHaveTextContent(/Try another one\./);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("tells the member a chip on a reset handle needs rewriting, not that it forwards", async () => {
    setup({
      handle: "ana-codes",
      savedHandle: "ana-codes",
      chipHandle: "ana-rivera",
      chipHandleActive: false,
    });
    const alert = (await screen.findByText("Your NFC card needs rewriting")).closest("[role=status]");
    expect(screen.queryByText("Your NFC card has your old address")).not.toBeInTheDocument();
    // Freed handles can be claimed by someone else, so a tap may open their card.
    expect(alert).toHaveTextContent(/A tap now shows \u201ccard not available\u201d/);
    expect(alert).toHaveTextContent(/or another member's card if someone has claimed that handle since/);
    expect(alert).not.toHaveTextContent(/opens nothing/);
  });

  it("reminds the member their chip still carries the old handle, and that it keeps working", async () => {
    const { user, input } = setup({
      handle: "ana-rivera",
      savedHandle: "ana-rivera",
      chipHandle: "ana-rivera",
    });
    expect(screen.queryByText("Your NFC card has your old address")).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "ana-codes");

    const reminder = (await screen.findByText("Your NFC card has your old address")).closest(
      "[role=status]",
    );
    expect(reminder).toHaveTextContent(/card\/ana-rivera/);
    expect(reminder).toHaveTextContent(/forwards to your new one/);

    await user.clear(input);
    await user.type(input, "ana-rivera");
    await waitFor(() =>
      expect(screen.queryByText("Your NFC card has your old address")).not.toBeInTheDocument(),
    );
  });
});

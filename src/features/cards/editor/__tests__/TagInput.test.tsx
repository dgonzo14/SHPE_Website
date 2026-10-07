import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TagInput } from "../TagInput";

function Harness({ initial = [], maxItems = 5 }: { initial?: string[]; maxItems?: number }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <>
      <TagInput
        label="Skills"
        value={value}
        onChange={setValue}
        maxItems={maxItems}
        maxLength={12}
        noun="skill"
      />
      <div data-testid="value">{JSON.stringify(value)}</div>
      <button type="button">Elsewhere</button>
    </>
  );
}

function setup(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  return {
    user,
    input: screen.getByLabelText("Skills"),
    value: () => JSON.parse(screen.getByTestId("value").textContent ?? "[]") as string[],
  };
}

describe("TagInput", () => {
  it("adds a tag on Enter and announces it", async () => {
    const { user, input, value } = setup();

    await user.type(input, "Python{Enter}");

    expect(value()).toEqual(["Python"]);
    expect(input).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Added Python. 1 of 5 skills.");
    expect(screen.getByRole("list", { name: "Your skills" })).toHaveTextContent("Python");
  });

  it("adds on a comma, which also splits a pasted list", async () => {
    const { user, input, value } = setup();

    await user.type(input, "CAD,");
    expect(value()).toEqual(["CAD"]);

    await user.click(input);
    await user.paste("SQL, MATLAB,  Rust");
    expect(value()).toEqual(["CAD", "SQL", "MATLAB"]);
    expect(input).toHaveValue("Rust");
  });

  it("adds whatever is typed when the field is left, so it isn't lost", async () => {
    const { user, input, value } = setup();

    await user.type(input, "SolidWorks");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(value()).toEqual(["SolidWorks"]);
  });

  it("has an Add button for touch keyboards", async () => {
    const { user, input, value } = setup();
    expect(screen.getByRole("button", { name: "Add skill" })).toBeDisabled();

    await user.type(input, "Java");
    await user.click(screen.getByRole("button", { name: "Add skill" }));

    expect(value()).toEqual(["Java"]);
  });

  it("refuses duplicates whatever their case", async () => {
    const { user, input, value } = setup({ initial: ["Python"] });

    await user.type(input, "python{Enter}");

    expect(value()).toEqual(["Python"]);
    // Shown with the field, and announced.
    expect(input).toHaveAccessibleDescription(/python is already listed\./);
    expect(screen.getByRole("status")).toHaveTextContent("python is already listed.");
  });

  it("refuses a tag that's too long, keeping it in the field to shorten", async () => {
    const { user, input, value } = setup();

    await user.type(input, "Computational fluid dynamics{Enter}");

    expect(value()).toEqual([]);
    expect(input).toHaveValue("Computational fluid dynamics");
    expect(input).toHaveAccessibleDescription(/Keep each skill to 12 characters or fewer\./);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("stops at the limit and says so", async () => {
    const { user, input, value } = setup({ initial: ["A", "B"], maxItems: 2 });

    await user.type(input, "C{Enter}");

    expect(value()).toEqual(["A", "B"]);
    expect(input).toHaveAccessibleDescription(
      /That's the limit of 2 skills\. Remove one to add another\./,
    );
  });

  it("removes a tag with its own button and keeps focus in the list", async () => {
    const { user, value } = setup({ initial: ["Python", "SQL", "CAD"] });

    await user.click(screen.getByRole("button", { name: "Remove SQL" }));

    expect(value()).toEqual(["Python", "CAD"]);
    expect(screen.getByRole("status")).toHaveTextContent("Removed SQL. 2 of 5 skills.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove CAD" })).toHaveFocus());
  });

  it("moves focus to the last tag on Backspace in an empty field, rather than deleting it", async () => {
    const { user, input, value } = setup({ initial: ["Python", "SQL"] });

    await user.click(input);
    await user.keyboard("{Backspace}");

    expect(value()).toEqual(["Python", "SQL"]);
    expect(screen.getByRole("button", { name: "Remove SQL" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(value()).toEqual(["Python"]);
  });

  it("returns focus to the field when the last tag is removed", async () => {
    const { input } = setup({ initial: ["Python"] });
    const list = screen.getByRole("list", { name: "Your skills" });

    fireEvent.click(within(list).getByRole("button", { name: "Remove Python" }));

    await waitFor(() => expect(input).toHaveFocus());
  });

  it("never submits a surrounding form on Enter", async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <TagInput label="Skills" value={[]} onChange={() => {}} maxItems={5} maxLength={12} noun="skill" />
      </form>,
    );

    await user.type(screen.getByLabelText("Skills"), "Go{Enter}");

    expect(submitted).toBe(false);
  });
});

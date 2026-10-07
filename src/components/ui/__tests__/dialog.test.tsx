import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Dialog } from "../dialog";

/*
 * The regression: the open/close effect used to depend on onClose, and callers
 * pass an inline arrow, so every parent re-render while the dialog was open
 * re-ran the effect and moved focus to the close button. Typing one character
 * into a field inside the dialog was enough to trigger it.
 */
function Harness({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <Dialog open title="Delete member" onClose={() => onClose()}>
      <label htmlFor="confirm">Type the email</label>
      <input id="confirm" value={text} onChange={(e) => setText(e.target.value)} />
    </Dialog>
  );
}

describe("Dialog", () => {
  it("keeps focus in a field while the parent re-renders with a new onClose", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);

    const input = screen.getByLabelText("Type the email");
    await user.click(input);
    await user.type(input, "ana@wustl.edu");

    expect(input).toHaveValue("ana@wustl.edu");
    expect(input).toHaveFocus();
  });

  it("calls the latest onClose on Escape", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onClose={first} />);
    rerender(<Harness onClose={second} />);

    await user.keyboard("{Escape}");

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

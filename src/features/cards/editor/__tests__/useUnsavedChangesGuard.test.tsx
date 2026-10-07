import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Link, Route, Routes } from "react-router-dom";

import { UNSAVED_CHANGES_MESSAGE, useUnsavedChangesGuard } from "../useUnsavedChangesGuard";

function Editor({ dirty }: { dirty: boolean }) {
  useUnsavedChangesGuard(dirty);
  return (
    <>
      <Link to="/portal/points">My Points</Link>
      <a href="https://example.com" target="_blank" rel="noreferrer">
        Elsewhere
      </a>
      <div data-card-root="">
        <a href="/">Member of WashU SHPE</a>
      </div>
    </>
  );
}

function renderAt(dirty: boolean) {
  return render(
    <MemoryRouter initialEntries={["/portal/card"]}>
      <Routes>
        <Route path="/portal/card" element={<Editor dirty={dirty} />} />
        <Route path="/portal/points" element={<p>Points page</p>} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUnsavedChangesGuard", () => {
  it("asks the browser to confirm closing the tab while there are unsaved changes", () => {
    renderAt(true);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves closing alone when everything is saved", () => {
    renderAt(false);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the member on the page when they cancel leaving through an in-app link", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAt(true);

    fireEvent.click(screen.getByRole("link", { name: "My Points" }));

    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(screen.queryByText("Points page")).not.toBeInTheDocument();
  });

  it("lets them go when they confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAt(true);

    fireEvent.click(screen.getByRole("link", { name: "My Points" }));

    expect(screen.getByText("Points page")).toBeInTheDocument();
  });

  it("doesn't ask about new tabs, or links inside the card preview", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAt(true);

    fireEvent.click(screen.getByRole("link", { name: "Elsewhere" }));
    fireEvent.click(screen.getByRole("link", { name: "Member of WashU SHPE" }));

    expect(confirm).not.toHaveBeenCalled();
  });

  it("doesn't ask at all when everything is saved", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAt(false);

    fireEvent.click(screen.getByRole("link", { name: "My Points" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText("Points page")).toBeInTheDocument();
  });
});

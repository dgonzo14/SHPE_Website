import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CheckIn } from "../CheckIn";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { CheckInResult } from "@/types/database";

// The RPC itself is exercised by the SQL tests in supabase/tests. Here we care
// about what the member sees and, crucially, that the UI cannot ask for a
// second check-in while the first is still in flight.
const checkInWithCode = vi.fn<(code: string) => Promise<CheckInResult>>();

vi.mock("@/services/points", () => ({
  checkInWithCode: (code: string) => checkInWithCode(code),
  checkInToEvent: vi.fn(),
}));

const SUCCESS: CheckInResult = {
  ok: true,
  event_id: "22222222-2222-4222-8222-222222222222",
  event_title: "General Body Meeting #3",
  event_slug: "gbm-3-abc123",
  attendance_id: "33333333-3333-4333-8333-333333333333",
  checked_in_at: "2026-09-18T23:35:00.000Z",
  points_awarded: 10,
  term_id: "44444444-4444-4444-8444-444444444444",
  term_points: 152,
};

describe("CheckIn page", () => {
  beforeEach(() => {
    checkInWithCode.mockReset();
  });

  it("confirms the event, the points earned and the new total on success", async () => {
    checkInWithCode.mockResolvedValue(SUCCESS);
    const user = userEvent.setup();
    renderWithProviders(<CheckIn />);

    await user.type(screen.getByLabelText(/event code/i), "NOVA4821");
    await user.click(screen.getByRole("button", { name: /^check in$/i }));

    expect(await screen.findByText(/you're checked in/i)).toBeInTheDocument();
    expect(screen.getByText("General Body Meeting #3")).toBeInTheDocument();
    expect(screen.getByText(/\+10 SHPE points/i)).toBeInTheDocument();
    expect(screen.getByText("152")).toBeInTheDocument();
    expect(checkInWithCode).toHaveBeenCalledWith("NOVA4821");
  });

  it("announces a wrong code without revealing anything about live events", async () => {
    checkInWithCode.mockResolvedValue({ ok: false, code: "INVALID_CODE" });
    const user = userEvent.setup();
    renderWithProviders(<CheckIn />);

    await user.type(screen.getByLabelText(/event code/i), "WRONG123");
    await user.click(screen.getByRole("button", { name: /^check in$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/isn't valid/i);
    expect(alert.textContent).not.toMatch(/event id|hash|sql/i);
  });

  it("tells the member when check-in has not opened yet", async () => {
    checkInWithCode.mockResolvedValue({
      ok: false,
      code: "CHECKIN_NOT_OPEN",
      event_title: "GBM #3",
      opens_at: "2026-09-18T23:45:00.000Z",
    });
    const user = userEvent.setup();
    renderWithProviders(<CheckIn />);

    await user.type(screen.getByLabelText(/event code/i), "NOVA4821");
    await user.click(screen.getByRole("button", { name: /^check in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Check-in opens at 6:45 PM.");
  });

  it("reports a duplicate check-in as already-counted, not as an error to retry", async () => {
    checkInWithCode.mockResolvedValue({
      ok: false,
      code: "ALREADY_CHECKED_IN",
      event_title: "GBM #3",
    });
    const user = userEvent.setup();
    renderWithProviders(<CheckIn />);

    await user.type(screen.getByLabelText(/event code/i), "NOVA4821");
    await user.click(screen.getByRole("button", { name: /^check in$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already checked into this event/i);
    expect(alert).toHaveTextContent(/already counted/i);
  });

  it("does not submit twice when the button is tapped repeatedly", async () => {
    // The database makes duplicate attendance impossible regardless; this
    // asserts the UI does not even try, which is what stops the confusing
    // "second request fails" flash at a busy event.
    let resolve!: (value: CheckInResult) => void;
    checkInWithCode.mockImplementation(
      () => new Promise<CheckInResult>((r) => (resolve = r)),
    );

    const user = userEvent.setup();
    renderWithProviders(<CheckIn />);

    await user.type(screen.getByLabelText(/event code/i), "NOVA4821");
    const button = screen.getByRole("button", { name: /^check in$/i });

    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await user.click(button);
    await user.click(button);

    expect(checkInWithCode).toHaveBeenCalledTimes(1);

    resolve(SUCCESS);
    expect(await screen.findByText(/you're checked in/i)).toBeInTheDocument();
    expect(checkInWithCode).toHaveBeenCalledTimes(1);
  });

  it("validates the code client-side before spending a request", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CheckIn />);

    await user.type(screen.getByLabelText(/event code/i), "ab");
    await user.click(screen.getByRole("button", { name: /^check in$/i }));

    expect(await screen.findByText(/at least 4 characters/i)).toBeInTheDocument();
    expect(checkInWithCode).not.toHaveBeenCalled();
  });

  it("warns an inactive member that check-in is limited to active members", () => {
    renderWithProviders(<CheckIn />, {
      auth: {
        profile: {
          ...JSON.parse(
            JSON.stringify({
              id: "11111111-1111-4111-8111-111111111111",
              first_name: "Ana",
              last_name: "Rivera",
              email: "ana.rivera@wustl.edu",
              major: null,
              secondary_major: null,
              graduation_year: null,
              degree_level: null,
              shpe_national_member: "not_provided",
              shpe_national_member_id: null,
              linkedin_url: null,
              profile_image_url: null,
              membership_status: "inactive",
              member_since: "2025-08-25",
              created_at: "2025-08-25T00:00:00.000Z",
              updated_at: "2025-08-25T00:00:00.000Z",
            }),
          ),
        },
      },
    });

    expect(screen.getByText(/limited to active members/i)).toBeInTheDocument();
  });
});

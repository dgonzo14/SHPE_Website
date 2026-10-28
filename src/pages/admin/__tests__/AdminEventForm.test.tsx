import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";

import { AdminEventForm } from "../AdminEventForm";
import { renderWithProviders, testProfile } from "@/test/renderWithProviders";
import type { EventAttendee, EventWithCategory, EventWritePayload } from "@/services/events";
import type { EventCategoryRow, EventRow } from "@/types/database";

/*
 * Changing an event's points moves everyone already checked in to the new
 * value (the database posts the corrections). The form says so before the
 * officer saves, and only when it's true: the points really changed and
 * someone is on the roster -- or the roster hasn't loaded, so the form can't
 * say nobody is.
 */

const api = vi.hoisted(() => ({
  fetchEvent: vi.fn<(id: string) => Promise<EventWithCategory | null>>(),
  fetchEventAttendance: vi.fn<(id: string) => Promise<EventAttendee[]>>(),
  fetchEventCategories: vi.fn<() => Promise<EventCategoryRow[]>>(),
  updateEvent:
    vi.fn<(id: string, payload: Partial<EventWritePayload>) => Promise<EventRow>>(),
}));

vi.mock("@/services/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/events")>()),
  fetchEvent: (id: string) => api.fetchEvent(id),
  fetchEventAttendance: (id: string) => api.fetchEventAttendance(id),
  fetchEventCategories: () => api.fetchEventCategories(),
  updateEvent: (id: string, payload: Partial<EventWritePayload>) => api.updateEvent(id, payload),
}));

vi.mock("@/services/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/admin")>()),
  fetchEventCodeStatus: async () => ({ has_code: false }),
}));

const CATEGORY: EventCategoryRow = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Professional",
  slug: "professional",
  description: null,
  color: null,
  sort_order: 1,
  is_active: true,
  created_at: "2026-09-01T00:00:00.000Z",
};

const EVENT: EventWithCategory = {
  id: "e0000000-0000-4000-8000-000000000001",
  title: "Convention Prep",
  slug: "convention-prep",
  description: null,
  category_id: CATEGORY.id,
  academic_term_id: null,
  start_at: "2026-10-23T01:00:00.000Z",
  end_at: "2026-10-23T02:00:00.000Z",
  location: null,
  points_value: 0,
  check_in_opens_at: "2026-10-23T00:30:00.000Z",
  check_in_closes_at: "2026-10-23T02:30:00.000Z",
  status: "published",
  is_public: true,
  capacity: null,
  organizer_name: null,
  organizer_email: null,
  image_url: null,
  created_by: null,
  created_at: "2026-10-22T00:00:00.000Z",
  updated_at: "2026-10-22T00:00:00.000Z",
  category: { id: CATEGORY.id, name: CATEGORY.name, slug: CATEGORY.slug, color: null },
};

function attendee(n: number): EventAttendee {
  return {
    id: `a0000000-0000-4000-8000-00000000000${n}`,
    member_id: `m0000000-0000-4000-8000-00000000000${n}`,
    checked_in_at: "2026-10-23T01:05:00.000Z",
    check_in_method: "form",
    verified_by: null,
    member: {
      id: `m0000000-0000-4000-8000-00000000000${n}`,
      first_name: `Member${n}`,
      last_name: "Test",
      email: `member${n}@wustl.edu`,
      graduation_year: 2028,
      major: testProfile.major,
    },
  };
}

const OFFICER = {
  isOfficer: true,
  isAdmin: false,
  roles: ["member", "officer"] as ("member" | "officer" | "admin")[],
};

function renderForm() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/events/:eventId" element={<AdminEventForm />} />
    </Routes>,
    { route: `/admin/events/${EVENT.id}`, auth: OFFICER },
  );
}

async function pointsField() {
  const field = await screen.findByLabelText(/^Points/);
  // The form fills in once the event and the roster have both arrived.
  await waitFor(() => expect(field).toHaveValue(EVENT.points_value));
  await waitFor(() => expect(api.fetchEventAttendance).toHaveBeenCalled());
  return field;
}

beforeEach(() => {
  api.fetchEvent.mockResolvedValue(EVENT);
  api.fetchEventAttendance.mockResolvedValue([attendee(1), attendee(2)]);
  api.fetchEventCategories.mockResolvedValue([CATEGORY]);
  api.updateEvent.mockImplementation(async (_id, payload) => ({ ...EVENT, ...payload }) as EventRow);
});

describe("AdminEventForm — changing points", () => {
  it("says the people already checked in will move to the new value", async () => {
    const user = userEvent.setup();
    renderForm();

    const field = await pointsField();
    expect(screen.queryByText(/already checked in/)).not.toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "50");

    expect(await screen.findByText(/2 members have already checked in\./)).toBeInTheDocument();
    expect(screen.getByText(/moves each of them from 0 to 50 points/)).toBeInTheDocument();
  });

  it("says nothing once the points are back where they were", async () => {
    const user = userEvent.setup();
    renderForm();

    const field = await pointsField();
    await user.clear(field);
    await user.type(field, "50");
    await screen.findByText(/already checked in/);

    await user.clear(field);
    await user.type(field, "0");

    await waitFor(() =>
      expect(screen.queryByText(/already checked in/)).not.toBeInTheDocument(),
    );
  });

  it("says nothing when nobody has checked in", async () => {
    api.fetchEventAttendance.mockResolvedValue([]);
    const user = userEvent.setup();
    renderForm();

    const field = await pointsField();
    await user.clear(field);
    await user.type(field, "50");

    expect(field).toHaveValue(50);
    // Once the empty roster is in: until then the form can't know it's empty.
    await waitFor(() =>
      expect(screen.queryByText(/already checked in/)).not.toBeInTheDocument(),
    );
  });

  it("warns about anyone already checked in while the roster is still loading", async () => {
    api.fetchEventAttendance.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderForm();

    const field = await pointsField();
    await user.clear(field);
    await user.type(field, "50");

    expect(
      await screen.findByText(/Saving moves anyone who has already checked in to 50 points/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load the attendance list/)).not.toBeInTheDocument();
  });

  it("still warns, and says why it can't count, when the roster fails to load", async () => {
    api.fetchEventAttendance.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderForm();

    const field = await pointsField();
    await user.clear(field);
    await user.type(field, "50");

    expect(
      await screen.findByText(/Saving moves anyone who has already checked in to 50 points/),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/couldn't load the attendance list to count them/),
    ).toBeInTheDocument();
  });

  it("says nothing while the roster loads if the points haven't changed", async () => {
    api.fetchEventAttendance.mockReturnValue(new Promise(() => {}));
    renderForm();

    await pointsField();
    expect(screen.queryByText(/already checked in/)).not.toBeInTheDocument();
  });

  it("after saving without the roster, says everyone moved and refreshes members' points", async () => {
    api.fetchEventAttendance.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const { queryClient } = renderForm();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const field = await pointsField();
    await user.selectOptions(screen.getByLabelText(/^Category/), CATEGORY.id);
    await user.clear(field);
    await user.type(field, "50");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(
      await screen.findByText(/Everyone already checked in now has the new value/),
    ).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["member"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin"] });
  });

  it("saves the new value and refreshes members' points", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderForm();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const field = await pointsField();
    await user.selectOptions(screen.getByLabelText(/^Category/), CATEGORY.id);
    await user.clear(field);
    await user.type(field, "50");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(api.updateEvent).toHaveBeenCalledWith(
        EVENT.id,
        expect.objectContaining({ points_value: 50 }),
      ),
    );
    expect(await screen.findByText(/2 attendees' points now match the new value/)).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["member"] });
  });
});

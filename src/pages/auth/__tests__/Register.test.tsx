import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Register } from "../Register";
import { renderWithProviders } from "@/test/renderWithProviders";

const signUp = vi.fn();
const navigate = vi.fn();

vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ signUp }) }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/first name/i), "Ana");
  await user.type(screen.getByLabelText(/last name/i), "Rivera");
  await user.type(screen.getByLabelText(/washu email/i), "ana.rivera@wustl.edu");
  await user.type(screen.getByLabelText(/^password/i), "a-good-password");
  await user.type(screen.getByLabelText(/confirm password/i), "a-good-password");
  await user.type(screen.getByLabelText(/^major/i), "Mechanical Engineering");
}

describe("Register", () => {
  beforeEach(() => {
    signUp.mockReset();
    signUp.mockResolvedValue({ needsEmailConfirmation: false });
    navigate.mockReset();
  });

  it("no longer asks about SHPE National membership", () => {
    renderWithProviders(<Register />);
    expect(screen.queryByLabelText(/shpe national member/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/i'm a shpe national member/i)).not.toBeInTheDocument();
  });

  /*
   * The one that would ruin a GBM.
   *
   * registerSchema still requires shpe_national_member to be a boolean, but the
   * checkbox that used to supply it is gone. This passes only because
   * react-hook-form seeds its values from defaultValues and keeps entries for
   * fields that were never registered -- if that ever stopped being true, every
   * registration would fail zod validation with "Required" on a field nobody
   * can see, in front of a room of students.
   */
  it("still submits the National-membership defaults the schema requires", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Register />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp.mock.calls[0][0]).toMatchObject({
      email: "ana.rivera@wustl.edu",
      shpe_national_member: false,
      shpe_national_member_id: "",
    });
  });

  it("accepts a LinkedIn link typed without a scheme, and adds it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Register />);
    await fillRequiredFields(user);
    await user.type(screen.getByLabelText(/linkedin/i), "linkedin.com/in/ana");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp.mock.calls[0][0].linkedin_url).toBe("https://linkedin.com/in/ana");
  });

  it("sends a new member to the join gate rather than the portal", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Register />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/join", { replace: true }));
  });
});

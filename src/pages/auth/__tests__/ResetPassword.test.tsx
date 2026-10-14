import { useEffect, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";

import { ResetPassword } from "../ResetPassword";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AuthContext, type AuthContextValue } from "@/auth/authContext";
import { useAuth } from "@/auth/useAuth";

/*
 * Two kinds of link land here. The emailed one arrives with a session that
 * supabase-js already exchanged, so the page only asks "is there a session?".
 * The one an admin made by hand carries a single-use token the page spends
 * itself, and the order matters: the token has to be exchanged -- switching
 * the session to the link's account -- before the password is changed, every
 * time, or whoever was signed in on the browser gets their password changed.
 */

const LINK_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";

const verifyRecoveryToken = vi.fn<(tokenHash: string) => Promise<string>>();
const updatePassword = vi.fn<(password: string) => Promise<void>>();
const signOut = vi.fn<() => Promise<void>>();

const TOKEN_ROUTE = "/reset-password?token_hash=abc&type=recovery";
const NOTICE = "Your password is updated. Sign in with your new password.";

/*
 * The browser's session, changing under the page the way Supabase changes
 * it: verifying a link signs its account in, signing out signs everyone out,
 * and another tab can do either while this one sits on the form. The auth
 * value renderWithProviders gives is fixed for the whole render, so this
 * provider, nested inside it, carries the part that changes. Until something
 * changes it, the page sees the fixed value untouched.
 */
const browserSession: { signIn: (accountId: string) => void; signOut: () => void } = {
  signIn: () => {},
  signOut: () => {},
};

function LiveSession({ children }: { children: ReactNode }) {
  const fixed = useAuth();
  const [changed, setChanged] = useState<Partial<AuthContextValue> | null>(null);

  useEffect(() => {
    browserSession.signIn = (accountId) =>
      setChanged({
        status: "signed-in",
        user: { id: accountId } as AuthContextValue["user"],
        profile: null,
      });
    browserSession.signOut = () => setChanged({ status: "signed-out", user: null, profile: null });
  }, []);

  return (
    <AuthContext.Provider value={changed ? { ...fixed, ...changed } : fixed}>
      {children}
    </AuthContext.Provider>
  );
}

function Address() {
  const location = useLocation();
  return <p data-testid="address">{`${location.pathname}${location.search}`}</p>;
}

function LoginPage() {
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  return <p>Sign-in page: {notice}</p>;
}

function renderPage(route: string, auth: Partial<AuthContextValue> = {}) {
  return renderWithProviders(
    <LiveSession>
      <Routes>
        <Route
          path="/reset-password"
          element={
            <>
              <ResetPassword />
              <Address />
            </>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<p>Forgot password page</p>} />
      </Routes>
    </LiveSession>,
    { route, auth: { verifyRecoveryToken, updatePassword, signOut, ...auth } },
  );
}

const SIGNED_OUT: Partial<AuthContextValue> = {
  status: "signed-out",
  user: null,
  profile: null,
};

async function submitNewPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^new password/i), "a-new-password");
  await user.type(screen.getByLabelText(/confirm new password/i), "a-new-password");
  await user.click(screen.getByRole("button", { name: "Update password" }));
}

/** Supabase Auth's answer for a token that was used already or ran out. */
function expiredToken() {
  return Object.assign(new Error("Token has expired or is invalid"), {
    name: "AuthApiError",
    status: 403,
    code: "otp_expired",
  });
}

beforeEach(() => {
  verifyRecoveryToken.mockReset();
  verifyRecoveryToken.mockImplementation(async () => {
    browserSession.signIn(LINK_ACCOUNT_ID);
    return LINK_ACCOUNT_ID;
  });
  updatePassword.mockReset();
  updatePassword.mockResolvedValue(undefined);
  signOut.mockReset();
  signOut.mockImplementation(async () => browserSession.signOut());
});

describe("ResetPassword from the emailed link", () => {
  it("shows the form when the link has signed them in", async () => {
    const user = userEvent.setup();
    renderPage("/reset-password");

    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    await submitNewPassword(user);

    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith("a-new-password"));
    expect(verifyRecoveryToken).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(`Sign-in page: ${NOTICE}`, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("says the link isn't valid when there is no session", () => {
    renderPage("/reset-password", SIGNED_OUT);

    expect(
      screen.getByRole("heading", { name: "This reset link isn't valid" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send a new reset link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();
  });

  it("waits for the session before deciding the link isn't valid", async () => {
    renderPage("/reset-password", { ...SIGNED_OUT, status: "loading" });

    expect(screen.queryByRole("heading", { name: "This reset link isn't valid" })).toBeNull();
    expect(
      await screen.findByRole(
        "heading",
        { name: "This reset link isn't valid" },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it("ignores a token_hash that isn't for recovery", () => {
    renderPage("/reset-password?token_hash=abc&type=signup", SIGNED_OUT);
    expect(
      screen.getByRole("heading", { name: "This reset link isn't valid" }),
    ).toBeInTheDocument();
  });
});

describe("ResetPassword from a link an admin made", () => {
  it("shows the form straight away, with nobody signed in", () => {
    renderPage(TOKEN_ROUTE, SIGNED_OUT);

    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    // Opening the page spends nothing: link scanners open links too.
    expect(verifyRecoveryToken).not.toHaveBeenCalled();
  });

  it("spends the token before changing the password, then signs out and goes to sign in", async () => {
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE, SIGNED_OUT);

    await submitNewPassword(user);

    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith("a-new-password"));
    expect(verifyRecoveryToken).toHaveBeenCalledWith("abc");
    expect(verifyRecoveryToken.mock.invocationCallOrder[0]).toBeLessThan(
      updatePassword.mock.invocationCallOrder[0],
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(updatePassword.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0],
    );
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(
      await screen.findByText(`Sign-in page: ${NOTICE}`, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("takes the spent token out of the address bar and keeps going", async () => {
    updatePassword.mockRejectedValueOnce(new Error("network hiccup"));
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE, SIGNED_OUT);
    expect(screen.getByTestId("address")).toHaveTextContent(TOKEN_ROUTE);

    await submitNewPassword(user);

    expect(await screen.findByText(/we couldn't update your password/i)).toBeInTheDocument();
    expect(screen.getByTestId("address")).toHaveTextContent(/^\/reset-password$/);
    // Still the same form, typed values and all, not the emailed-link checks.
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toHaveValue("a-new-password");
  });

  it("says the link has been used or expired when Auth refuses the token, and changes nothing", async () => {
    verifyRecoveryToken.mockRejectedValue(expiredToken());
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE, SIGNED_OUT);

    await submitNewPassword(user);

    // The card replaces the form whose button was just pressed, so focus
    // starts on its heading rather than falling to the page.
    expect(
      await screen.findByRole("heading", { name: "This reset link isn't valid" }),
    ).toHaveFocus();
    expect(screen.getByText(/may already have been used or run out/i)).toBeInTheDocument();
    expect(screen.getByText(/ask whoever sent it for a new one/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send me a reset link by email" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    // Nobody to sign out, so nothing in the way of the emailed link.
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("doesn't spend the token twice when the password update fails and they try again", async () => {
    updatePassword.mockRejectedValueOnce(new Error("network hiccup"));
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE, SIGNED_OUT);

    await submitNewPassword(user);
    expect(await screen.findByText(/we couldn't update your password/i)).toBeInTheDocument();
    expect(verifyRecoveryToken).toHaveBeenCalledTimes(1);

    // The link's account, which verifying signed in, is still the one signed
    // in, so the retry goes ahead on it.
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(updatePassword).toHaveBeenCalledTimes(2));
    expect(verifyRecoveryToken).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
  });

  /*
   * The session is the browser's, not the tab's. Between a failed update and
   * the retry, another tab can sign someone else in, and updatePassword()
   * changes whoever is signed in now -- so the retry has to notice, change
   * nothing, and leave that person signed in.
   */
  it("won't set the password on an account another tab has since signed in", async () => {
    updatePassword.mockRejectedValueOnce(new Error("network hiccup"));
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE, SIGNED_OUT);

    await submitNewPassword(user);
    expect(await screen.findByText(/we couldn't update your password/i)).toBeInTheDocument();

    act(() => browserSession.signIn(OTHER_ACCOUNT_ID));
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByRole("heading", { name: "This reset link has already been used" }),
    ).toHaveFocus();
    expect(
      screen.getByText(/since then this browser has been signed in to a different account/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ask whoever sent it for a new one/i)).toBeInTheDocument();
    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(verifyRecoveryToken).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();

    // Signing out from the card, as offered, opens the way to an emailed link
    // but doesn't rewrite why this one failed: the other account was the reason.
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByRole("link", { name: "Send me a reset link by email" }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(
      screen.getByText(/since then this browser has been signed in to a different account/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/has been signed out/i)).not.toBeInTheDocument();
    expect(updatePassword).toHaveBeenCalledTimes(1);
  });

  it("won't try again once another tab has signed this browser out", async () => {
    updatePassword.mockRejectedValueOnce(new Error("network hiccup"));
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE, SIGNED_OUT);

    await submitNewPassword(user);
    expect(await screen.findByText(/we couldn't update your password/i)).toBeInTheDocument();

    act(() => browserSession.signOut());
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByRole("heading", { name: "This reset link has already been used" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/since then this browser has been signed out/i)).toBeInTheDocument();
    // Signed out, so the emailed link is open to them.
    expect(screen.getByRole("link", { name: "Send me a reset link by email" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("lets them try again when the token couldn't be checked for want of a connection", async () => {
    verifyRecoveryToken.mockRejectedValueOnce(
      Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 }),
    );
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE, SIGNED_OUT);

    await submitNewPassword(user);
    expect(await screen.findByText(/we couldn't check your reset link/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This reset link isn't valid" })).toBeNull();
    expect(updatePassword).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(updatePassword).toHaveBeenCalledTimes(1));
    expect(verifyRecoveryToken).toHaveBeenCalledTimes(2);
  });

  it("doesn't call a rate-limited check a dead link", async () => {
    // Auth turns the request away before looking at the token, so it's unspent.
    verifyRecoveryToken.mockRejectedValueOnce(
      Object.assign(new Error("Request rate limit reached"), {
        name: "AuthApiError",
        status: 429,
        code: "over_request_rate_limit",
      }),
    );
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE, SIGNED_OUT);

    await submitNewPassword(user);
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This reset link isn't valid" })).toBeNull();
    expect(updatePassword).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(updatePassword).toHaveBeenCalledTimes(1));
    expect(verifyRecoveryToken).toHaveBeenCalledTimes(2);
  });

  it("still spends the token first when someone else is signed in on this browser", async () => {
    const user = userEvent.setup();
    // The default auth value: signed in as testProfile, as an admin trying the
    // link they just made would be.
    renderPage(TOKEN_ROUTE);

    expect(screen.getByText(/someone is already signed in on this browser/i)).toBeInTheDocument();
    await submitNewPassword(user);

    await waitFor(() => expect(updatePassword).toHaveBeenCalledTimes(1));
    expect(verifyRecoveryToken).toHaveBeenCalledWith("abc");
    expect(verifyRecoveryToken.mock.invocationCallOrder[0]).toBeLessThan(
      updatePassword.mock.invocationCallOrder[0],
    );
  });

  it("never changes the signed-in person's password when the token is refused", async () => {
    verifyRecoveryToken.mockRejectedValue(expiredToken());
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE);

    await submitNewPassword(user);

    expect(
      await screen.findByRole("heading", { name: "This reset link isn't valid" }),
    ).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  /*
   * /forgot-password turns a signed-in browser away to the portal, so the
   * emailed link would be a dead end here. The page says what to do instead,
   * and signing out is offered, not done for them.
   */
  it("asks someone signed in to sign out before having a link emailed", async () => {
    verifyRecoveryToken.mockRejectedValue(expiredToken());
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE);

    await submitNewPassword(user);
    await screen.findByRole("heading", { name: "This reset link isn't valid" });

    expect(
      screen.queryByRole("link", { name: "Send me a reset link by email" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/to have a reset link emailed to you, sign out first or use another browser/i),
    ).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledTimes(1);
    const emailLink = await screen.findByRole("link", { name: "Send me a reset link by email" });
    expect(emailLink).toHaveAttribute("href", "/forgot-password");
    // The button that was pressed has gone; focus goes to what replaced it.
    expect(emailLink).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("says so, and stays put, when signing out fails", async () => {
    verifyRecoveryToken.mockRejectedValue(expiredToken());
    signOut.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    // describeError logs the raw error in development.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderPage(TOKEN_ROUTE);

    await submitNewPassword(user);
    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByText(/we couldn't sign you out/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(
      screen.queryByRole("link", { name: "Send me a reset link by email" }),
    ).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});

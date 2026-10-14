import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { FullPageLoader } from "@/components/shared/states";
import { resetPasswordSchema, type ResetPasswordValues } from "@/lib/validation";
import { errorText } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * Landing page for a password reset link. There are two kinds.
 *
 * The emailed link: Supabase exchanges the code in the URL for a short-lived
 * session before this renders, so "am I allowed to set a new password?"
 * reduces to "is there a session?". There is no token handling for it here;
 * the official client owns that.
 *
 * The link an admin made from the member's page and sent by hand
 * (/reset-password?token_hash=...&type=recovery). That carries the token
 * itself rather than a PKCE code, so nothing exchanges it automatically; this
 * page does, with verifyRecoveryToken(), when the new password is submitted.
 */
export function ResetPassword() {
  usePageMeta({ title: "Set a New Password | WashU SHPE", noindex: true });

  const { status, user, updatePassword, signOut, verifyRecoveryToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /*
   * Read once, when the page opens. The token is taken out of the address bar
   * once it has been used, and that must not switch the page over to the
   * emailed-link behaviour halfway through.
   */
  const [tokenHash] = useState(() =>
    searchParams.get("type") === "recovery" ? searchParams.get("token_hash") || null : null,
  );
  /*
   * The account the token signed this browser in to, once it has been
   * exchanged. A retry after a failed password update must not spend the
   * token again (it works only once), and must find this account still
   * signed in before it changes anything.
   */
  const [linkAccountId, setLinkAccountId] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  /*
   * Set when a retry finds the browser no longer signed in to the link's
   * account, to what it found instead. Kept as found rather than read from the
   * live session: the page itself offers a sign-out next, and "this browser
   * has been signed out" would then replace the real reason with one the
   * person just caused.
   */
  const [linkSessionGone, setLinkSessionGone] = useState<"other-account" | "signed-out" | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Supabase needs a moment to exchange the code in the URL for a session, so
  // "no session" is only conclusive after that grace period has elapsed.
  const [gracePeriodOver, setGracePeriodOver] = useState(false);
  const settled = status !== "loading" || gracePeriodOver;

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setGracePeriodOver(true), 1500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    /*
     * The admin-made link's token is spent here, when the new password is
     * submitted, and not when the page loads.
     *
     * Link scanners and chat preview bots open links, and some run the page's
     * JavaScript; verifying on load would let one of them use up the
     * single-use token before the member ever saw the page. And verifying
     * swaps whoever is signed in on this browser for the link's account, so
     * someone already signed in here -- the admin trying the link, say -- must
     * never be able to reach updatePassword() with their own session still in
     * place: verification always comes first, immediately before it.
     */
    if (tokenHash && linkAccountId === null) {
      let accountId: string;
      try {
        accountId = await verifyRecoveryToken(tokenHash);
      } catch (error) {
        if (mightBeTemporary(error)) {
          setFormError(errorText(error, "We couldn't check your reset link"));
        } else {
          setLinkInvalid(true);
        }
        return;
      }
      setLinkAccountId(accountId);
      // The token is used up, so take it out of the address bar, where it would
      // otherwise sit in history. The page keeps its state, and a reload from
      // here takes the emailed-link path, which works on the session this
      // just created.
      navigate("/reset-password", { replace: true });
    } else if (tokenHash && user?.id !== linkAccountId) {
      /*
       * A retry, after the password update failed. The session the token made
       * is shared by every tab on this browser, and since then one of them may
       * have signed someone else in, or signed out. updatePassword() changes
       * the password of whoever is signed in now, so it isn't called unless
       * that is still the link's account. Nothing is signed out here either:
       * whoever is signed in now got there some other way, on purpose.
       *
       * Only on a retry. On the first attempt verifying has just made the
       * session, immediately before the update, and `user` in this handler
       * still holds whoever was signed in before it did.
       */
      setLinkSessionGone(user ? "other-account" : "signed-out");
      return;
    }

    try {
      await updatePassword(values.password);
      setDone(true);
      // End the recovery session so the new password is actually exercised at
      // the next sign-in rather than silently skipped.
      await signOut();
      window.setTimeout(
        () =>
          navigate("/login", {
            replace: true,
            state: { notice: "Your password is updated. Sign in with your new password." },
          }),
        1200,
      );
    } catch (error) {
      setFormError(errorText(error, "We couldn't update your password"));
    }
  });

  if (tokenHash) {
    // The form shows straight away, session or not: the token is only checked
    // on submit (see above), so there is nothing to wait for or judge yet.
    // Either problem below is found by submitting, so it replaces the form.
    if (linkInvalid) {
      return (
        <LinkProblem
          title="This reset link isn't valid"
          emailLinkLabel="Send me a reset link by email"
          replacesForm
        >
          Reset links work once and expire after about an hour, so this one may already have been
          used or run out. Ask whoever sent it for a new one, or have a reset link emailed to you
          instead.
        </LinkProblem>
      );
    }
    if (linkSessionGone) {
      return (
        <LinkProblem
          title="This reset link has already been used"
          emailLinkLabel="Send me a reset link by email"
          replacesForm
        >
          It was used on this browser already, but since then this browser has been{" "}
          {linkSessionGone === "other-account"
            ? "signed in to a different account"
            : "signed out"}{" "}
          (in another tab, perhaps), so your new password can't be saved with it. Ask whoever sent
          it for a new one, or have a reset link emailed to you instead.
        </LinkProblem>
      );
    }
  } else {
    if (status === "loading" && !settled) {
      return <FullPageLoader label="Checking your reset link" />;
    }

    if (status !== "signed-in" && !done) {
      return (
        <LinkProblem title="This reset link isn't valid" emailLinkLabel="Send a new reset link">
          Reset links expire and can only be used once. Request a new one and try again.
        </LinkProblem>
      );
    }
  }

  return (
    <Card>
      <CardBody className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-shpe-navy">Choose a new password</h1>

        {done ? (
          <Alert tone="success" title="Password updated" className="mt-5">
            Taking you to the sign-in page…
          </Alert>
        ) : (
          <>
            {/* Not while submitting: verifying signs the link's account in a
                moment before linkAccountId is set, and this would flash. */}
            {tokenHash && !linkAccountId && !isSubmitting && status === "signed-in" && (
              <Alert tone="info" className="mt-5">
                Someone is already signed in on this browser. Saving a new password here sets it
                for the account this link was made for, then signs this browser out.
              </Alert>
            )}

            {formError && (
              <Alert tone="danger" className="mt-5">
                {formError}
              </Alert>
            )}

            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <Field
                label="New password"
                required
                hint="At least 8 characters."
                error={errors.password?.message}
              >
                {(props) => (
                  <Input {...props} {...register("password")} type="password" autoComplete="new-password" />
                )}
              </Field>
              <Field label="Confirm new password" required error={errors.confirm_password?.message}>
                {(props) => (
                  <Input
                    {...props}
                    {...register("confirm_password")}
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </Field>
              <Button type="submit" block size="lg" loading={isSubmitting}>
                Update password
              </Button>
            </form>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * A link that can't set a password, with the way to get one that can.
 *
 * /forgot-password only serves a signed-out browser (RedirectIfAuthenticated
 * sends anyone signed in to the portal), so linking there while someone is
 * signed in would drop them on their dashboard with no reset link and no
 * explanation. That happens here: an admin trying a link they made, or a
 * browser another tab signed in to. They're told instead to sign out first or
 * use another browser, and offered the sign-out, which is theirs to choose:
 * this page never signs anyone out on their behalf.
 *
 * replacesForm: shown in place of the form just submitted. The Update password
 * button went with the form, taking focus with it, and the card's own alert is
 * a polite region that arrives already full, which screen readers don't
 * reliably read. Starting from the heading means the reason is read out, and
 * the next Tab lands on what to do about it.
 */
function LinkProblem({
  title,
  emailLinkLabel,
  replacesForm = false,
  children,
}: {
  title: string;
  emailLinkLabel: string;
  replacesForm?: boolean;
  children: ReactNode;
}) {
  const { status, signOut } = useAuth();
  const signedIn = status === "signed-in";
  const [signingOut, setSigningOut] = useState(false);
  const [signedOutHere, setSignedOutHere] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (replacesForm) headingRef.current?.focus();
  }, [replacesForm]);

  // The Sign out button goes once it has worked, taking focus with it; the
  // link that replaces it is where they were heading.
  useEffect(() => {
    if (signedOutHere && !signedIn) emailLinkRef.current?.focus();
  }, [signedOutHere, signedIn]);

  async function handleSignOut() {
    setSignOutError(null);
    setSigningOut(true);
    try {
      await signOut();
      setSignedOutHere(true);
    } catch (error) {
      setSignOutError(errorText(error, "We couldn't sign you out"));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Card>
      <CardBody className="p-6 sm:p-8">
        <h1
          ref={headingRef}
          tabIndex={replacesForm ? -1 : undefined}
          className="text-2xl font-bold text-shpe-navy outline-none"
        >
          {title}
        </h1>
        <Alert tone="warning" className="mt-5">
          {children}
        </Alert>
        {signedIn ? (
          <div className="mt-5">
            <p className="text-sm text-gray-700">
              This browser is signed in to an account, so to have a reset link emailed to you, sign
              out first or use another browser.
            </p>
            {signOutError && (
              <Alert tone="danger" className="mt-3">
                {signOutError}
              </Alert>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              loading={signingOut}
              onClick={() => void handleSignOut()}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <Link
            ref={emailLinkRef}
            to="/forgot-password"
            className="mt-5 inline-block text-sm font-semibold text-shpe-orange-dark"
          >
            {emailLinkLabel}
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

/*
 * Whether verifying failed because the request never got an answer (offline, a
 * dropped connection, Auth briefly unavailable) or was turned away before Auth
 * looked at the token (rate limited), rather than because Auth refused the
 * token. Only then is the token probably unspent and worth trying again.
 * Anything unrecognised counts as a dead link: at worst that sends someone for
 * a new link they didn't strictly need, rather than leaving them retrying one
 * that will never work.
 */
function mightBeTemporary(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const e = (error ?? {}) as { name?: unknown; status?: unknown };
  // supabase-js's name for a failed or 5xx request, matched by name so this
  // page doesn't import the client.
  if (e.name === "AuthRetryableFetchError") return true;
  // Auth's per-address limit on verifications. Everyone on campus shares one
  // address, so this can happen to someone holding a perfectly good link.
  return e.status === 429;
}

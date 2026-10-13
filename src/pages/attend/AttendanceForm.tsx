import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarX2, CheckCircle2, Clock, CloudOff, Link2Off, MapPin } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button, LinkButton } from "@/components/ui/button";
import { Alert, Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { ErrorState, FullPageLoader } from "@/components/shared/states";
import { usePageMeta } from "@/hooks/usePageMeta";
import { isSupabaseConfigured } from "@/lib/config";
import {
  chapterDateKey,
  formatDate,
  formatDateTime,
  formatTime,
  formatTimeRange,
  TIMEZONE_LABEL,
} from "@/lib/datetime";
import { describeError, type FriendlyError } from "@/lib/errors";
import { attendanceFormSchema, type AttendanceFormValues } from "@/lib/validation";
import {
  ATTENDANCE_SUBMIT_MESSAGES,
  fetchAttendanceForm,
  isAttendanceToken,
  submitAttendance,
} from "@/services/attendanceForm";
import { queryKeys } from "@/services/queryKeys";
import type { RegisterLocationState } from "@/pages/auth/Register";
import type {
  AttendanceFormEvent,
  AttendanceFormResponse,
  AttendanceSubmitErrorCode,
} from "@/types/database";

/**
 * Who was just checked in, kept only long enough to say so, and to bring the
 * names back if they check in again with a different address.
 */
interface CheckedInAs {
  eventTitle: string;
  values: AttendanceFormValues;
}

/** How the form comes back once it's asked for again after a check-in. */
interface NextForm {
  values: AttendanceFormValues;
  focus: keyof AttendanceFormValues;
}

const BLANK: AttendanceFormValues = { first_name: "", last_name: "", email: "" };

const SUBMIT_FALLBACK = "We couldn't record your attendance";

/*
 * The one address the page suggests. SHPE accounts are made with a WashU
 * address, so it's the one that lets a check-in count toward points. The form
 * still takes any address (see attendanceFormSchema); it just never suggests
 * another. Deliberately not read from ALLOWED_EMAIL_DOMAINS, which can list
 * other domains (a local build adds the seed accounts' one) that a newcomer
 * shouldn't be steered towards.
 */
const SCHOOL_DOMAIN = "wustl.edu";

function isSchoolAddress(email: string): boolean {
  return email.trim().toLowerCase().split("@")[1] === SCHOOL_DOMAIN;
}

/** The auth pages' footer line, so the dashboard link looks the same here. */
const FOOTER = "mt-5 border-t border-gray-100 pt-4 text-sm text-gray-600";
const FOOTER_LINK = "font-semibold text-shpe-orange-dark";

/*
 * Refusals that mean the page is out of date: the window opened, closed or
 * moved, the event was cancelled, or the link was replaced while the form sat
 * on screen. Reloading the form's state swaps the page for the right notice,
 * so the next person handed this phone isn't offered a form that can't work.
 * FORM_FULL is not here: the form itself is still current, and its message
 * already sends the person to an officer, who can add them by name and email.
 */
const STALE_FORM_CODES: ReadonlySet<AttendanceSubmitErrorCode> = new Set<AttendanceSubmitErrorCode>([
  "FORM_NOT_FOUND",
  "FORM_NOT_OPEN",
  "FORM_CLOSED",
  "EVENT_CANCELLED",
]);

/**
 * /attend/:token — the attendance form officers share at a meeting as a link
 * or a QR code.
 *
 * Built for someone at their first SHPE event: no account, no code, three
 * fields, on a phone. Who may submit what, and when, is decided by
 * get_attendance_form() and submit_event_attendance()
 * (20260918000002_attendance_form.sql); this page only shows their answers.
 *
 * Two rules from that migration shape the copy:
 *   - the token in the path is the only credential, so every link that doesn't
 *     work gets one not-found page that lists the possibilities without saying
 *     which applies;
 *   - an accepted response gets the same answer whether or not its email
 *     belongs to an account, so the success view says what happens in either
 *     case rather than which case this was. The form can't be used to find out
 *     who has an account, and the page mustn't undo that.
 *
 * usePageMeta rather than SEOHead: SEOHead writes a canonical link, which here
 * would repeat the secret URL in the page's <head> for link previewers and
 * extensions to pick up, on a page that should never be indexed anyway. The
 * title stays generic rather than naming the event, since titles end up in
 * history and tab previews (see usePageMeta).
 */
export function AttendanceForm() {
  usePageMeta({ title: "Event Attendance | WashU SHPE", noindex: true });

  // Tokens are issued lowercase, but a QR scanner or someone retyping the link
  // may shout it. The database lowercases too; doing it here keeps the shape
  // check and the cache key in step with what the database will look up.
  const { token: rawToken = "" } = useParams();
  const token = rawToken.toLowerCase();
  const tokenValid = isAttendanceToken(token);

  const { status: authStatus, profile, profileLoading } = useAuth();
  const signedIn = authStatus === "signed-in";

  const [checkedIn, setCheckedIn] = useState<CheckedInAs | null>(null);
  /*
   * What the form starts from when it comes back after a check-in, which only
   * happens to check in again with a WashU address. It keeps the names just
   * typed, since it's the same person and only the address was wrong. Until
   * then (null) the form starts from the signed-in member's own details.
   */
  const [nextForm, setNextForm] = useState<NextForm | null>(null);

  const formQuery = useQuery({
    queryKey: queryKeys.attendanceForm(token),
    queryFn: () => fetchAttendanceForm(token),
    // A link that can't be a token is not_found without a round trip. The
    // database checks the same shape, so skipping the call changes nothing but
    // the wait.
    enabled: isSupabaseConfigured && tokenValid,
    // People scan the code as they sit down, often before the window opens.
    // Polling while it's shut makes the form appear by itself on time instead
    // of waiting for a reload, and coming back to the tab checks straight away.
    // "always" rather than true, which only refetches stale data: the app's
    // client counts an answer as fresh for a minute, so a phone unlocked just
    // after the opening time would otherwise sit on "opens at" until the next
    // poll. Once it's open there is nothing to watch for: a response sent
    // after it closes is told so by the submit, which reloads this.
    refetchInterval: (query) => (query.state.data?.status === "not_open" ? 30_000 : false),
    refetchOnWindowFocus: (query) => (query.state.data?.status === "not_open" ? "always" : false),
  });

  /*
   * The page can change under the visitor: the form opens by itself when the
   * window does, and a refused response reloads it into the notice that says
   * why. Sighted visitors see the swap; this says it aloud. Only changes after
   * arrival are announced (the first state is read like any page), and the
   * region stays mounted through every view below, because a screen reader
   * only announces changes to a live region it has already seen.
   *
   * Worked out during render from the previous status, which React supports
   * for exactly this, rather than in an effect a frame later.
   */
  const form = formQuery.data;
  const [shownStatus, setShownStatus] = useState(form?.status);
  const [announcement, setAnnouncement] = useState("");
  if (form?.status !== shownStatus) {
    setShownStatus(form?.status);
    if (shownStatus !== undefined && form) setAnnouncement(`${headline(form)}.`);
  }

  // Every view leaves through here, so the live region keeps its place.
  const page = (view: ReactNode) => (
    <>
      {view}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );

  if (!isSupabaseConfigured) return page(<AttendanceUnavailable />);
  if (!tokenValid) return page(<AttendanceLinkNotFound />);

  // Before the form's state: once someone is checked in, the window closing a
  // minute later shouldn't replace their confirmation with "closed".
  if (checkedIn) {
    return page(
      <CheckedInView
        eventTitle={checkedIn.eventTitle}
        values={checkedIn.values}
        signedIn={signedIn}
        onCheckInWithSchoolAddress={() => {
          setNextForm({ values: { ...checkedIn.values, email: "" }, focus: "email" });
          setCheckedIn(null);
        }}
      />,
    );
  }

  if (form === undefined) {
    if (formQuery.isError) {
      return page(
        <>
          <h1 className="sr-only">Event attendance</h1>
          <ErrorState
            error={formQuery.error}
            onRetry={() => void formQuery.refetch()}
            fallback="We couldn't load this attendance form"
          />
        </>,
      );
    }
    return page(<FullPageLoader label="Loading the attendance form" />);
  }

  switch (form.status) {
    case "not_found":
      return page(<AttendanceLinkNotFound />);

    case "cancelled":
      return page(
        <Notice icon={CalendarX2} title={headline(form)}>
          <p className={NOTICE_BODY}>
            There's no attendance to record for it. If you think that's a mistake, ask an officer.
          </p>
        </Notice>,
      );

    case "closed":
      return page(
        <Notice icon={Clock} title={headline(form)}>
          <p className={NOTICE_BODY}>If you were there, ask an officer to add you.</p>
        </Notice>,
      );

    case "not_open":
      return page(
        <Card>
          <CardBody className="p-6 sm:p-8">
            <EventHeading event={form.event} />
            <Alert tone="info" title={headline(form)} className="mt-6">
              Keep this page open and the form will appear here by itself.
            </Alert>
          </CardBody>
        </Card>,
      );

    case "open": {
      /*
       * A signed-in member's details are filled in for them, and useForm reads
       * its defaults once, so wait for the profile rather than mount an empty
       * form that would never pick it up. Signed out, this settles as soon as
       * the stored session has been checked.
       *
       * profileLoading counts only once someone is signed in: AuthProvider
       * starts it true and never clears it for a visitor who was never signed
       * in, so on its own it would hold every guest on a spinner.
       */
      const waitingForProfile =
        authStatus === "loading" || (authStatus === "signed-in" && profileLoading);
      if (!nextForm && waitingForProfile) {
        return page(<FullPageLoader label="Loading the attendance form" />);
      }
      const initialValues =
        nextForm?.values ??
        (profile
          ? { first_name: profile.first_name, last_name: profile.last_name, email: profile.email }
          : BLANK);
      return page(
        <AttendanceFormCard
          token={token}
          event={form.event}
          initialValues={initialValues}
          // Only after a check-in: the button that brought the form back has
          // just gone, so focus goes where the typing starts. On arrival the
          // event details come first, and a keyboard popping up would hide them.
          focusField={nextForm?.focus}
          onCheckedIn={setCheckedIn}
        />,
      );
    }
  }
}

/* ── The form ────────────────────────────────────────────────────────────── */

function AttendanceFormCard({
  token,
  event,
  initialValues,
  focusField,
  onCheckedIn,
}: {
  token: string;
  event: AttendanceFormEvent;
  initialValues: AttendanceFormValues;
  focusField?: keyof AttendanceFormValues;
  onCheckedIn: (who: CheckedInAs) => void;
}) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<FriendlyError | null>(null);

  const submit = useMutation({
    mutationFn: (values: AttendanceFormValues) => submitAttendance(token, values),
  });

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<AttendanceFormValues>({
    resolver: zodResolver(attendanceFormSchema),
    defaultValues: initialValues,
  });

  useEffect(() => {
    if (focusField) setFocus(focusField);
  }, [focusField, setFocus]);

  /*
   * Enter on a name field moves on to the next field instead of sending the
   * form. Phones label that key "Next" (enterKeyHint below), but on iOS it
   * still submits, which checked every field at once and flagged the ones the
   * person hadn't reached yet. Enter on Email still sends, as "Go" says.
   *
   * Left alone with a modifier held, which some keyboards and screen readers
   * use for their own commands, and while an input method is composing, where
   * Enter picks the characters for a name typed in another script. Safari
   * reports the Enter that ends a composition with isComposing already false,
   * so its keyCode of 229 is checked too.
   */
  const moveOnFrom =
    (next: keyof AttendanceFormValues) => (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      setFocus(next);
    };

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      const result = await submit.mutateAsync(values);
      if (result.ok) {
        // The values as the schema normalised them, which is what was
        // recorded and what an account would have to be created with.
        onCheckedIn({ eventTitle: result.event_title, values });
        return;
      }
      // The fallback covers a code from a database newer than this page.
      setFailure(ATTENDANCE_SUBMIT_MESSAGES[result.code] ?? { title: SUBMIT_FALLBACK });
      if (STALE_FORM_CODES.has(result.code)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.attendanceForm(token) });
      }
    } catch (error) {
      setFailure(describeError(error, SUBMIT_FALLBACK));
    }
  });

  /*
   * Advice, never a rule. Guests and people from other schools come to events
   * too, and the schema accepts any address on purpose (see
   * attendanceFormSchema). But a response only counts toward points once it
   * matches an account, and accounts are made with a WashU address, so that
   * is the only one the page asks for.
   */
  const emailHint = `Use your @${SCHOOL_DOMAIN} email so this counts toward your SHPE points.`;

  return (
    <Card>
      <CardBody className="p-6 sm:p-8">
        <EventHeading event={event} />
        <p className="mt-4 text-sm text-gray-700">Add your name to show you were here.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required error={errors.first_name?.message}>
              {(props) => (
                <Input
                  {...props}
                  {...register("first_name")}
                  autoComplete="given-name"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  onKeyDown={moveOnFrom("last_name")}
                />
              )}
            </Field>
            <Field label="Last name" required error={errors.last_name?.message}>
              {(props) => (
                <Input
                  {...props}
                  {...register("last_name")}
                  autoComplete="family-name"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  onKeyDown={moveOnFrom("email")}
                />
              )}
            </Field>
          </div>

          <Field label="Email" required hint={emailHint} error={errors.email?.message}>
            {(props) => (
              <Input
                {...props}
                {...register("email")}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="you@wustl.edu"
              />
            )}
          </Field>

          <Button
            type="submit"
            block
            size="lg"
            // Disabled while in flight. A repeat would be harmless (the
            // database answers it like the first), but a second tap at a busy
            // door shouldn't even ask.
            loading={isSubmitting || submit.isPending}
          >
            Check in
          </Button>
        </form>

        {/* Announced, and placed where a screen reader goes next after the button. */}
        <div aria-live="assertive" className="mt-4 empty:mt-0">
          {failure && (
            <Alert tone="danger" title={failure.title}>
              {failure.detail}
            </Alert>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/* ── Checked in ──────────────────────────────────────────────────────────── */

/**
 * The same answer for every accepted response with the same kind of address.
 * Whether the address belongs to an account is not something this page knows,
 * and the copy is written so that it reads true either way.
 *
 * What it may depend on is the domain the visitor typed, which they already
 * know. Registration only takes school addresses, so offering an account
 * "with this email" to someone who used a personal one would send them to a
 * form that refuses it. For those addresses the page says which kind an
 * account needs instead, and offers to check in again with one, keeping the
 * names just typed.
 *
 * Anyone not signed in gets Create an account and Sign in side by side, the
 * same size, so someone who already has an account doesn't take the bigger
 * button and make a second one.
 */
function CheckedInView({
  eventTitle,
  values,
  signedIn,
  onCheckInWithSchoolAddress,
}: {
  eventTitle: string;
  values: AttendanceFormValues;
  signedIn: boolean;
  onCheckInWithSchoolAddress: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { email } = values;
  const schoolAddress = isSchoolAddress(email);
  // Registration starts from what was just typed, so making the account is
  // one password away and it's made with the address this check-in waits on.
  // A personal address isn't carried over: registration would refuse it.
  const registerState: RegisterLocationState = {
    prefill: schoolAddress ? values : { ...values, email: "" },
  };

  // The button that was pressed has just gone, taking focus with it. Starting
  // from the heading means a screen reader reads the answer, and the next Tab
  // lands on its buttons rather than back at the top of the page.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Card>
      <CardBody className="p-6 text-center sm:p-8">
        <div className="flex flex-col items-center" role="status" aria-live="polite">
          <span className="rounded-full bg-emerald-50 p-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
          </span>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-4 text-2xl font-bold text-shpe-navy outline-none"
          >
            You're checked in
          </h1>
          <p className="mt-2 text-gray-700">Thanks for coming to {eventTitle}.</p>
          <p className="mt-4 break-words text-sm text-gray-600">
            If <strong className="text-gray-800">{email}</strong> is on a SHPE account, this counts
            toward its points.{" "}
            {schoolAddress
              ? signedIn
                ? null
                : "New to SHPE? Create an account with this email and this event will already be on it. Already have one? Sign in to see your My SHPE dashboard and SHPE points."
              : `SHPE accounts are made with an @${SCHOOL_DOMAIN} address, so if you're a WashU student, check in again with your WashU email for this event to count toward your points.`}
          </p>
        </div>

        {!schoolAddress && (
          <div className="mt-6 flex flex-col sm:items-center">
            <Button variant={signedIn ? "primary" : "outline"} onClick={onCheckInWithSchoolAddress}>
              Check in with my @{SCHOOL_DOMAIN} email
            </Button>
          </div>
        )}

        {/*
          Only here, once they're checked in: the form itself stays three
          fields and a button, with nothing to lead anyone away before they've
          sent it. Without `from`, Login lands on the dashboard, which is the
          point of signing in now. Not for a signed-in member: /register and
          /login both send them straight to the portal.
        */}
        {signedIn ? (
          <p className={FOOTER}>
            See your SHPE points on your{" "}
            <Link to="/portal" className={FOOTER_LINK}>
              My SHPE dashboard
            </Link>
            .
          </p>
        ) : (
          <div className={`${schoolAddress ? "mt-6" : "mt-3"} grid gap-2 sm:grid-cols-2`}>
            <LinkButton to="/register" state={registerState} block>
              Create an account
            </LinkButton>
            <LinkButton to="/login" variant="secondary" block>
              Sign in
            </LinkButton>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ── Event details ───────────────────────────────────────────────────────── */

/** The event's name, time and place, so nobody checks in to the wrong one. */
function EventHeading({ event }: { event: AttendanceFormEvent }) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-shpe-orange-dark">
        Event attendance
      </p>
      <h1 className="mt-1 text-2xl font-bold leading-tight text-shpe-navy">{event.title}</h1>
      <dl className="mt-3 space-y-1.5 text-sm text-gray-700">
        <div className="flex items-start gap-2">
          <dt className="mt-0.5 shrink-0">
            <CalendarDays className="h-4 w-4 text-shpe-blue" aria-hidden />
            <span className="sr-only">When</span>
          </dt>
          <dd>{eventWhen(event)}</dd>
        </div>
        {event.location && (
          <div className="flex items-start gap-2">
            <dt className="mt-0.5 shrink-0">
              <MapPin className="h-4 w-4 text-shpe-blue" aria-hidden />
              <span className="sr-only">Where</span>
            </dt>
            <dd>{event.location}</dd>
          </div>
        )}
      </dl>
    </>
  );
}

/** "September 18, 2026 · 6:30 PM – 8:00 PM CT" */
function eventWhen(event: AttendanceFormEvent): string {
  const range = formatTimeRange(event.start_at, event.end_at);
  // formatTimeRange already spells out both dates when an event runs past
  // midnight; only a same-day range needs the date put in front of it.
  const sameDay = chapterDateKey(event.start_at) === chapterDateKey(event.end_at);
  return `${sameDay ? `${formatDate(event.start_at)} · ` : ""}${range} ${TIMEZONE_LABEL}`;
}

/**
 * "at 6:15 PM", or the full date when the window opens on a different day
 * from the event. The event's date is on screen just above, so the time alone
 * is enough in the usual case.
 */
function opensAtText(opensAt: string, eventStart: string): string {
  return chapterDateKey(opensAt) === chapterDateKey(eventStart)
    ? `at ${formatTime(opensAt)}`
    : formatDateTime(opensAt);
}

/**
 * The line that says which state the form is in: the heading of each notice,
 * and what the live region says when the page changes to that state by
 * itself. One source, so what is heard can't drift from what is shown.
 */
function headline(form: AttendanceFormResponse): string {
  switch (form.status) {
    case "not_found":
      return ATTENDANCE_SUBMIT_MESSAGES.FORM_NOT_FOUND.title;
    case "cancelled":
      return `${form.event.title} was cancelled`;
    case "closed":
      return `Attendance for ${form.event.title} has closed`;
    case "not_open":
      return `Attendance opens ${opensAtText(form.opens_at, form.event.start_at)}`;
    case "open":
      return "Attendance is open";
  }
}

/* ── Notices ─────────────────────────────────────────────────────────────── */

const NOTICE_BODY = "mx-auto mt-3 max-w-[40ch] text-base text-gray-600";

/**
 * Every state where there's no form to fill in. Each still says what to do
 * next, because the person reading it is standing in a room and an officer is
 * nearby.
 */
function Notice({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  children?: ReactNode;
}) {
  return (
    <Card className="border-t-4 border-t-shpe-orange">
      <CardBody className="p-6 text-center sm:p-8">
        <Icon className="mx-auto h-7 w-7 text-shpe-orange-dark" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold leading-tight text-shpe-navy">{title}</h1>
        {children}
      </CardBody>
    </Card>
  );
}

/**
 * One page for every link that doesn't work: malformed, never issued,
 * replaced by a newer one, or for an event that isn't published. The database
 * answers all of these with the same not_found, and the copy keeps it that way
 * by listing possibilities without saying which applies.
 */
function AttendanceLinkNotFound() {
  const { title, detail } = ATTENDANCE_SUBMIT_MESSAGES.FORM_NOT_FOUND;
  return (
    <Notice icon={Link2Off} title={title}>
      <p className={NOTICE_BODY}>{detail}</p>
    </Notice>
  );
}

/** This build has no Supabase settings, so no form can ever load here. */
function AttendanceUnavailable() {
  return (
    <Notice icon={CloudOff} title="Attendance isn't available here">
      <p className={NOTICE_BODY}>
        This copy of the site isn't connected to the WashU SHPE member database, so it can't record
        attendance. Ask an officer to add you.
      </p>
    </Notice>
  );
}

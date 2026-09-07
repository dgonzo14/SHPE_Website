/**
 * Turning backend failures into sentences a student can act on.
 *
 * PostgREST error bodies, SQLSTATE codes and stack traces never reach the UI:
 * they go to the console for developers, and the member sees what went wrong
 * and what to do next.
 */

import type { CheckInErrorCode, CheckInFailure } from "@/types/database";
import { formatTime } from "./datetime";

export interface FriendlyError {
  title: string;
  detail?: string;
}

const CHECK_IN_MESSAGES: Record<CheckInErrorCode, FriendlyError> = {
  INVALID_CODE: {
    title: "That event code isn't valid",
    detail: "Double-check the code shown at the event and try again.",
  },
  CHECKIN_NOT_OPEN: {
    title: "Check-in hasn't opened yet",
  },
  CHECKIN_CLOSED: {
    title: "Check-in for this event has closed",
    detail: "Ask an officer to add you manually if you were there.",
  },
  EVENT_NOT_FOUND: {
    title: "We couldn't find that event",
    detail: "It may have been removed. Check the events list for the latest schedule.",
  },
  EVENT_NOT_PUBLISHED: {
    title: "This event isn't open for check-in",
    detail: "It hasn't been published yet.",
  },
  EVENT_CANCELLED: {
    title: "This event was cancelled",
    detail: "No points are awarded for cancelled events.",
  },
  ALREADY_CHECKED_IN: {
    title: "You've already checked into this event",
    detail: "Your points are already counted — no need to check in twice.",
  },
  MEMBER_NOT_ACTIVE: {
    title: "Your chapter membership isn't active",
    detail:
      "You can still browse events, but check-in is limited to active members. Contact a SHPE officer if you think this is wrong.",
  },
  RATE_LIMITED: {
    title: "Too many incorrect codes",
    detail: "Wait a few minutes and try again, or ask an officer to check you in.",
  },
  UNAUTHORIZED: {
    title: "You need to sign in first",
    detail: "Sign in to My SHPE and try again.",
  },
  INTERNAL_ERROR: {
    title: "Something went wrong on our end",
    detail: "Please try again in a moment.",
  },
};

/** Maps a structured check-in failure to member-facing copy. */
export function checkInErrorMessage(failure: CheckInFailure): FriendlyError {
  const base = CHECK_IN_MESSAGES[failure.code] ?? CHECK_IN_MESSAGES.INTERNAL_ERROR;

  if (failure.code === "CHECKIN_NOT_OPEN" && failure.opens_at) {
    return { ...base, detail: `Check-in opens at ${formatTime(failure.opens_at)}.` };
  }
  if (failure.code === "CHECKIN_CLOSED" && failure.closed_at) {
    return {
      ...base,
      detail: `Check-in closed at ${formatTime(failure.closed_at)}. Ask an officer to add you manually if you were there.`,
    };
  }
  if (failure.code === "ALREADY_CHECKED_IN" && failure.event_title) {
    // Naming the event must not cost the reassurance — this is the message a
    // member sees after an anxious second tap, and it should say "you're fine".
    return {
      ...base,
      detail: `You're already on the list for ${failure.event_title} — your points are already counted.`,
    };
  }
  return base;
}

interface PostgrestLike {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
}

function asPostgrestLike(error: unknown): PostgrestLike {
  return typeof error === "object" && error !== null ? (error as PostgrestLike) : {};
}

/**
 * Best-effort translation of an arbitrary thrown value into something worth
 * showing. Deliberately conservative: when the cause isn't recognised, the user
 * gets a generic sentence and the developer gets the real object in the console.
 */
export function describeError(error: unknown, fallback = "Something went wrong"): FriendlyError {
  const e = asPostgrestLike(error);
  const message = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";

  if (import.meta.env.DEV) {
    console.error("[shpe]", error);
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      title: "You appear to be offline",
      detail: "Check your connection and try again.",
    };
  }

  // Supabase Auth surfaces these as plain messages rather than SQLSTATE codes.
  if (/invalid login credentials/i.test(message)) {
    return {
      title: "Email or password is incorrect",
      detail: "Check your details and try again, or reset your password.",
    };
  }
  if (/email not confirmed/i.test(message)) {
    return {
      title: "Confirm your email first",
      detail: "We sent you a confirmation link. Open it, then sign in.",
    };
  }
  if (/user already registered|already been registered/i.test(message)) {
    return {
      title: "That email already has an account",
      detail: "Try signing in instead, or reset your password.",
    };
  }
  if (/for security purposes|rate limit|too many requests/i.test(message)) {
    return {
      title: "Too many attempts",
      detail: "Wait a minute before trying again.",
    };
  }
  if (/approved email domains/i.test(message)) {
    return {
      title: "That email address can't register",
      detail: message,
    };
  }
  // GoTrue wraps any exception raised by the signup trigger in this one string.
  if (/database error saving new user/i.test(message)) {
    return {
      title: "We couldn't create your account",
      detail:
        "Registration is limited to approved email addresses. Ask a SHPE officer if you need an exception.",
    };
  }

  // SQLSTATE 42501 = insufficient_privilege. In practice this is RLS or a role
  // check saying no, which is a permissions problem, not a bug.
  if (code === "42501" || /permission denied|not authorised|not authorized|row-level security/i.test(message)) {
    return {
      title: "You don't have access to that",
      detail: "If you think you should, ask a SHPE officer to check your role.",
    };
  }
  if (code === "PGRST301" || /jwt expired/i.test(message)) {
    return {
      title: "Your session expired",
      detail: "Sign in again to pick up where you left off.",
    };
  }
  if (code === "23505") {
    return { title: "That already exists", detail: "Nothing was changed." };
  }
  if (code === "23503") {
    return {
      title: "That record is still in use",
      detail: "Something else references it, so it can't be removed.",
    };
  }
  if (code === "22023" || code === "P0002") {
    // Raised deliberately by our own RPCs with a message meant for humans.
    return { title: message || fallback };
  }
  if (/not configured for this deployment/i.test(message)) {
    return { title: "The member portal isn't set up yet", detail: message };
  }

  return { title: fallback, detail: "Please try again in a moment." };
}

export function errorText(error: unknown, fallback?: string): string {
  const { title, detail } = describeError(error, fallback);
  return detail ? `${title}. ${detail}` : title;
}

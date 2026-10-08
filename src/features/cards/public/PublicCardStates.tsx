import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CloudOff, IdCard } from "lucide-react";

import { BrandMark } from "@/components/shared/BrandMark";
import { Button, LinkButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";

/*
 * Everything /card/:handle shows when there is no card to draw: loading, not
 * found, and the backend being out of reach.
 *
 * None of these may be a blank screen. A card is opened by a stranger tapping
 * a chip at a career fair, with the member standing right there, so even the
 * worst case still says "WashU SHPE" and offers a way to the chapter site.
 *
 * The card route sits outside PublicLayout (no navbar), so these lay out the
 * whole viewport themselves. They use the site's own palette rather than any
 * card theme: there is no theme to use yet, and a not-found page dressed in
 * one member's colours would hint at whose card it was.
 */

/* ── Loading ─────────────────────────────────────────────────────────────── */

export type SkeletonNotice = "slow" | "offline";

const SKELETON_NOTICES: Record<SkeletonNotice, string> = {
  slow: "This is taking longer than usual. Still trying…",
  offline: "You're offline. The card will load as soon as you're back online.",
};

/**
 * The shape of a card in quiet greys, so the page settles into the real thing
 * rather than jumping from a spinner. Deliberately not the portal's
 * full-page loader. `notice` explains a slow first answer (a sleepy backend
 * being retried) or a phone with no connection, where React Query waits for
 * the network to come back before trying.
 */
export function PublicCardSkeleton({ notice = null }: { notice?: SkeletonNotice | null }) {
  return (
    <main
      aria-busy="true"
      className="flex min-h-dvh w-full flex-col items-center bg-gray-100 px-4 py-8 sm:py-12"
    >
      <div
        aria-hidden="true"
        data-testid="public-card-skeleton"
        className="w-full max-w-[28rem] rounded-2xl bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="flex flex-col items-center">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="mt-5 h-7 w-3/5 rounded" />
          <Skeleton className="mt-3 h-4 w-2/5 rounded" />
          <Skeleton className="mt-2 h-4 w-1/2 rounded" />
        </div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <Skeleton className="h-12 rounded-full" />
          <Skeleton className="size-12 rounded-full" />
        </div>
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-12 rounded-full bg-gray-100" />
          ))}
        </div>
      </div>

      {/* One live region for both the loading label and any notice, so a
          screen reader hears "still trying" when it appears. */}
      <div role="status" className="mt-6 max-w-sm text-center text-sm text-gray-700">
        <span className="sr-only">Loading business card</span>
        {notice && <p>{SKELETON_NOTICES[notice]}</p>}
      </div>
    </main>
  );
}

/* ── Shared frame for the two notices ────────────────────────────────────── */

function NoticeFrame({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-shpe-navy-soft px-4 py-10">
      <div className="w-full max-w-md border border-shpe-rule border-t-4 border-t-shpe-orange bg-white px-6 py-8 text-center sm:px-10 sm:py-10">
        <BrandMark alt="WashU SHPE" className="mx-auto h-7 max-w-full" />
        <Icon className="mx-auto mt-8 size-7 text-shpe-orange-dark" aria-hidden />
        {children}
      </div>
    </main>
  );
}

const HEADING = "mt-4 text-2xl font-bold leading-tight text-shpe-navy";
const BODY = "mx-auto mt-3 max-w-[40ch] text-base text-gray-600";

/* ── Not found ───────────────────────────────────────────────────────────── */

/**
 * One page for every card a stranger may not see: unpublished, hidden by an
 * officer, a handle that was reset, an owner who is no longer a member, cards
 * switched off, or a handle nobody ever claimed. The database already answers
 * all of these with the same not_found, and the copy keeps it that way: it
 * lists possibilities and never says which one applies, so nobody can use
 * this page to learn that a handle exists.
 *
 * Every tap is also a chance to recruit, hence the nudge to make a card.
 * /portal/card sends a signed-out visitor through sign-in first.
 */
export function PublicCardNotFound() {
  return (
    <NoticeFrame icon={IdCard}>
      <h1 className={HEADING}>This card isn't available</h1>
      <p className={BODY}>
        The link may be mistyped or out of date, or the card isn't public right now.
      </p>
      <LinkButton to="/" className="mt-6 w-full sm:w-auto">
        Visit WashU SHPE
      </LinkButton>

      <div className="mt-8 border-t border-shpe-rule pt-6">
        <p className="text-sm text-gray-600">Are you a WashU SHPE member?</p>
        <Link
          to="/portal/card"
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 px-1 font-semibold text-shpe-navy underline decoration-shpe-orange decoration-2 underline-offset-4 hover:text-shpe-navy-dark focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
        >
          Make your own card
          <ArrowRight className="size-4 shrink-0" aria-hidden />
        </Link>
      </div>
    </NoticeFrame>
  );
}

/* ── Backend unavailable ─────────────────────────────────────────────────── */

/**
 * The card service couldn't be reached even after retrying (a paused free
 * Supabase project, a dead connection), or this build has no Supabase
 * settings at all. Either way the visitor still lands on something that says
 * WashU SHPE and leads back to the chapter site.
 *
 * `onRetry` is omitted when retrying can't help (an unconfigured build),
 * rather than offering a button that does nothing.
 */
export function PublicCardUnavailable({
  onRetry,
  retrying = false,
}: {
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <NoticeFrame icon={CloudOff}>
      <div role="alert">
        <h1 className={HEADING}>Card temporarily unavailable</h1>
        <p className={BODY}>
          {onRetry
            ? "We couldn't load this card just now. Check your connection, then try again."
            : "This copy of the site isn't connected to the WashU SHPE card service, so cards can't load here."}
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        {onRetry && (
          <Button onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        )}
        <LinkButton to="/" variant={onRetry ? "outline" : "primary"}>
          Visit WashU SHPE
        </LinkButton>
      </div>
    </NoticeFrame>
  );
}

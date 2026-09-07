import type { ComponentType, ReactNode } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { describeError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/* ── Page header ─────────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-bold leading-tight text-shpe-navy sm:text-[2.25rem]">{title}</h1>
        {description && <p className="mt-1 max-w-[65ch] text-sm text-gray-600 sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ── Stat card ───────────────────────────────────────────────────────────── */

/**
 * One oversized numeral, one label, one rule.
 *
 * This is the recipe's signature move and it replaces the icon-in-a-tinted-
 * rounded-square stat card. That pattern was the brief's "AI-generated dashboard
 * filled with arbitrary widgets" failure mode in miniature: the icon carried no
 * information the label did not already state, and the tinted chip made colour
 * look semantic when it was not.
 *
 * Hierarchy is size and position only. `tabular-nums` keeps a column of these
 * aligned when several sit side by side.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = "navy",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Tints the top rule only. Never the sole carrier of meaning. */
  tone?: "navy" | "orange" | "blue" | "gold";
}) {
  const rule = {
    navy: "border-t-shpe-navy",
    orange: "border-t-shpe-orange",
    blue: "border-t-shpe-blue",
    gold: "border-t-shpe-gold",
  };

  return (
    <div className={cn("min-w-0 border-t-4 bg-white pt-3", rule[tone])}>
      <p className="text-4xl font-bold leading-none tabular-nums text-shpe-navy sm:text-5xl">
        {value}
      </p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-600">
        {label}
      </p>
      {hint && <p className="mt-1 text-sm text-gray-600">{hint}</p>}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

/**
 * An empty state should say what will fill it and, where possible, offer the
 * action that starts filling it — never just "no data".
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <div className="border border-dashed border-shpe-rule-strong bg-shpe-navy-soft/40 px-6 py-10">
      <Icon className="h-6 w-6 text-shpe-blue" aria-hidden />
      <p className="mt-3 text-lg font-medium text-shpe-navy">{title}</p>
      {description && <p className="mt-1 max-w-[60ch] text-sm text-gray-600">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ── Error state ─────────────────────────────────────────────────────────── */

export function ErrorState({
  error,
  onRetry,
  fallback = "We couldn't load this",
}: {
  error: unknown;
  onRetry?: () => void;
  fallback?: string;
}) {
  const { title, detail } = describeError(error, fallback);
  return (
    <div
      role="alert"
      className="border-l-4 border-l-red-700 bg-red-50 px-6 py-8"
    >
      <AlertCircle className="h-6 w-6 text-red-700" aria-hidden />
      <p className="mt-3 text-lg font-medium text-red-900">{title}</p>
      {detail && <p className="mt-1 max-w-[60ch] text-sm text-red-900">{detail}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

export function FullPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-shpe-navy" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Card-shaped placeholders — the shape of what is coming, not a lone spinner. */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </Card>
      ))}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-7 w-16" />
        </Card>
      ))}
    </div>
  );
}

/* ── Portal not configured ───────────────────────────────────────────────── */

/**
 * Shown when the build has no Supabase credentials. The public site still works
 * in that case, so this explains the situation instead of rendering a crash.
 */
export function PortalUnavailable() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-shpe-navy">The member portal isn't available yet</h1>
      <p className="mt-3 text-gray-600">
        This deployment hasn't been connected to the SHPE member database. The rest of the site
        works normally — check back soon, or reach out to a SHPE officer.
      </p>
      <LinkButton to="/" variant="secondary" className="mt-6">
        Return to the website
      </LinkButton>
    </div>
  );
}

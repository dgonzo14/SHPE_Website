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
        <h1 className="text-2xl font-bold text-shpe-navy sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-600 sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ── Stat card ───────────────────────────────────────────────────────────── */

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "navy",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "navy" | "orange" | "blue" | "gold";
}) {
  const tones = {
    navy: "bg-shpe-navy-soft text-shpe-navy",
    orange: "bg-shpe-orange-soft text-shpe-orange-dark",
    blue: "bg-shpe-blue-soft text-shpe-navy",
    gold: "bg-shpe-gold-soft text-amber-900",
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-shpe-navy">{value}</p>
          {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn("rounded-lg p-2", tones[tone])}>
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        )}
      </div>
    </Card>
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
    <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
      <span className="rounded-full bg-white p-3 shadow-sm">
        <Icon className="h-6 w-6 text-shpe-blue" aria-hidden />
      </span>
      <p className="mt-4 font-semibold text-shpe-navy">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-gray-600">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
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
      className="flex flex-col items-center rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center"
    >
      <AlertCircle className="h-6 w-6 text-red-600" aria-hidden />
      <p className="mt-3 font-semibold text-red-900">{title}</p>
      {detail && <p className="mt-1 max-w-md text-sm text-red-800">{detail}</p>}
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

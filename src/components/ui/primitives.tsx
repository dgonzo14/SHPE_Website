import type {
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  TableHTMLAttributes,
} from "react";
import { useId } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Surfaces ────────────────────────────────────────────────────────────── */

/**
 * `min-w-0` is deliberate. A grid or flex child defaults to `min-width: auto`,
 * which means it refuses to shrink below its content's min-content width — so a
 * Card containing a table forces its whole grid track wider than the container
 * and the page overflows. Cards hold wrapping content and their tables carry
 * their own `overflow-x-auto`, so letting them shrink is always what we want.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 border border-shpe-rule bg-white",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-shpe-rule px-6 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-[1.25rem] font-medium leading-tight text-shpe-navy", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("border-t border-shpe-rule px-6 py-4", className)} {...props} />
  );
}

/* ── Badge ───────────────────────────────────────────────────────────────── */

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-gray-100 text-gray-700 border-gray-200",
  info: "bg-shpe-blue-soft text-shpe-navy border-shpe-blue",
  success: "bg-emerald-50 text-emerald-800 border-emerald-300",
  warning: "bg-shpe-gold-soft text-amber-900 border-shpe-gold",
  danger: "bg-red-50 text-red-800 border-red-300",
  brand: "bg-shpe-orange-soft text-shpe-orange-dark border-shpe-orange",
};

/**
 * Badges always carry their own text. Colour is never the only carrier of
 * meaning — "Cancelled" says Cancelled, it is not just a red pill.
 */
export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.06em]",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ── Form fields ─────────────────────────────────────────────────────────── */

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-sm font-medium text-shpe-navy", className)}
      {...props}
    />
  );
}

const FIELD_BASE =
  "w-full border bg-white px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-500 min-h-[44px] " +
  "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy " +
  "disabled:bg-gray-50 disabled:text-gray-600";

export function Input({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(FIELD_BASE, invalid ? "border-red-600" : "border-shpe-rule-strong", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(
        FIELD_BASE,
        "min-h-[110px] leading-relaxed",
        invalid ? "border-red-600" : "border-shpe-rule-strong",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Select({
  className,
  invalid,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(FIELD_BASE, invalid ? "border-red-600" : "border-shpe-rule-strong", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

/**
 * Label, control, hint and error wired together with real ids, so a screen
 * reader announces the error with the field rather than leaving it stranded
 * as unrelated red text.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    invalid: boolean;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-1 text-shpe-orange-dark" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </Label>
      {children({ id, "aria-describedby": describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-6 w-6 border-shpe-rule-strong text-shpe-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
        {...props}
      />
      <label htmlFor={id} className="text-sm text-gray-700">
        <span className="font-medium text-shpe-navy">{label}</span>
        {description && <span className="mt-0.5 block text-gray-500">{description}</span>}
      </label>
    </div>
  );
}

/* ── Alert ───────────────────────────────────────────────────────────────── */

const ALERT_TONES = {
  info: { cls: "bg-shpe-blue-soft border-l-shpe-blue text-shpe-navy", Icon: Info },
  success: { cls: "bg-emerald-50 border-l-emerald-700 text-emerald-900", Icon: CheckCircle2 },
  warning: { cls: "bg-shpe-gold-soft border-l-shpe-gold text-amber-900", Icon: TriangleAlert },
  danger: { cls: "bg-red-50 border-l-red-700 text-red-900", Icon: AlertCircle },
} as const;

export function Alert({
  tone = "info",
  title,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: keyof typeof ALERT_TONES;
  title?: string;
}) {
  const { cls, Icon } = ALERT_TONES[tone];
  return (
    <div
      className={cn("flex gap-3 border-l-4 p-4", cls, className)}
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 break-words text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-1")}>{children}</div>}
      </div>
    </div>
  );
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse bg-gray-200", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Screen-reader announcement to pair with a block of skeletons. */
export function LoadingRegion({ label }: { label: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}

/* ── Table ───────────────────────────────────────────────────────────────── */

/**
 * `caption` is required rather than optional: an admin table without an
 * accessible name is a wall of unlabelled cells to a screen reader.
 */
export function Table({
  caption,
  className,
  children,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { caption: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm tabular", className)} {...props}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-shpe-rule-strong bg-shpe-navy-soft px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-shpe-navy",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("h-12 border-b border-shpe-rule px-3 py-2 align-middle md:h-10", className)} {...props} />
  );
}

import { type VariantProps } from "class-variance-authority";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./buttonVariants";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner and disables the button. Prevents duplicate submissions. */
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  block,
  loading = false,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

/**
 * A link that looks like a button. Kept distinct from <Button> so navigation
 * stays a real anchor — middle-click, "open in new tab" and screen-reader link
 * semantics all keep working, which wrapping a <Link> in a <button> would break.
 */
export function LinkButton({
  to,
  external = false,
  className,
  variant,
  size,
  block,
  children,
  ...props
}: Omit<LinkProps, "to"> &
  VariantProps<typeof buttonVariants> & {
    to: string;
    external?: boolean;
    children?: ReactNode;
  }) {
  const classes = cn(buttonVariants({ variant, size, block }), className);

  if (external) {
    return (
      <a
        href={to}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        {...(props as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </a>
    );
  }

  return (
    <Link to={to} className={classes} {...props}>
      {children}
    </Link>
  );
}

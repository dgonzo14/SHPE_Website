import { cva } from "class-variance-authority";

/**
 * Orange is the primary action, navy is the structural/secondary action —
 * the same relationship the public site already uses, so the portal reads as
 * the same organisation.
 *
 * Every size keeps a 44px minimum touch target: the most important button in
 * this app is pressed on a phone, standing in a lecture hall.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors " +
    "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy " +
    "disabled:pointer-events-none disabled:opacity-60 no-link-style",
  {
    variants: {
      variant: {
        // #C43E12, not #E84E1B: white on the brand orange is 3.77:1 and fails AA
        // for normal-size text. orange-dark is 5.23:1. The brighter orange is
        // still used as a non-text fill (rules, indicators, the check-in field).
        primary: "bg-shpe-orange-dark text-white hover:bg-shpe-orange-darker",
        secondary: "bg-shpe-navy text-white hover:bg-shpe-navy-dark",
        outline:
          "border-2 border-shpe-navy text-shpe-navy bg-transparent hover:bg-shpe-navy hover:text-white",
        subtle: "border-2 border-shpe-rule-strong bg-white text-shpe-navy hover:border-shpe-navy",
        ghost: "text-shpe-navy underline underline-offset-4 hover:bg-shpe-navy-soft hover:no-underline",
        danger: "bg-red-700 text-white hover:bg-red-800",
      },
      size: {
        sm: "min-h-[36px] px-3 py-1.5 text-sm",
        md: "min-h-[44px] px-5 py-2.5 text-sm sm:text-base",
        lg: "min-h-[52px] px-6 py-3 text-base",
        icon: "min-h-[44px] min-w-[44px] p-2",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

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
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shpe-navy " +
    "disabled:pointer-events-none disabled:opacity-60 no-link-style",
  {
    variants: {
      variant: {
        primary: "bg-shpe-orange text-white hover:bg-shpe-orange-dark",
        secondary: "bg-shpe-navy text-white hover:bg-shpe-navy-dark",
        outline:
          "border-2 border-shpe-navy text-shpe-navy bg-transparent hover:bg-shpe-navy hover:text-white",
        subtle: "bg-gray-100 text-shpe-navy hover:bg-gray-200",
        ghost: "text-shpe-navy hover:bg-shpe-navy-soft",
        danger: "bg-red-600 text-white hover:bg-red-700",
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

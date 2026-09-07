import { assetUrl } from "@/lib/assets";
import { cn } from "@/lib/utils";

/**
 * The SHPE lockup, sized honestly.
 *
 * The source image is 4392x667 — a 6.58:1 horizontal lockup reading
 * "SHPE | Washington University in St. Louis", not a square mark. Every previous
 * usage declared `width={32} height={32}` (or 48x48), which was wrong twice over:
 *
 *   1. The browser reserves a SQUARE box while the image loads, then reflows
 *      when the real 6.58:1 image arrives — a visible layout shift on every page.
 *   2. With `w-auto`, `h-8` renders it 211px wide and `h-9` renders it 223px.
 *      The portal sidebar rail has 224px of content width and the admin rail has
 *      208px, so the lockup plus its adjacent wordmark overflowed by ~58-64px.
 *      Because the rail is `overflow: visible`, that surplus painted straight
 *      over the page <h1> on all twenty portal and admin pages.
 *
 * Declaring the natural dimensions lets the browser reserve the correct
 * aspect-ratio box. Callers pass a height class plus a max-width, and the
 * max-width is what actually guarantees it stays inside its container.
 *
 * `alt` defaults to "" because in most placements an adjacent wordmark already
 * names the destination, which would otherwise be read out twice. Pass a real
 * alt when the mark is the only content of a link.
 */
export function BrandMark({
  className,
  alt = "",
  ...props
}: {
  className?: string;
  alt?: string;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "width" | "height">) {
  return (
    <img
      src={assetUrl("SHPE_logo.png")}
      alt={alt}
      width={4392}
      height={667}
      decoding="async"
      className={cn("w-auto object-contain", className)}
      {...props}
    />
  );
}

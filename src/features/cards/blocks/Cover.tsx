import { useState } from "react";

/**
 * The banner layout's cover: the member's 3:1 banner, or a band in the theme's
 * colours until they upload one. Decorative, so hidden from assistive
 * technology.
 */
export function BannerCover({ src }: { src: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  return (
    <div
      aria-hidden="true"
      data-part="banner"
      data-has-image={showImage || undefined}
      className="relative aspect-[3/1] w-full [background-image:var(--card-band)] bg-(--card-accent)"
    >
      {showImage && (
        <img
          src={src ?? undefined}
          alt=""
          width={1200}
          height={400}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      )}
    </div>
  );
}

/**
 * The badge layout's top: a band in the accent colour with the slot a lanyard
 * clip goes through, like a conference badge. The chapter name sits on the
 * band in the accent text colour, a pairing the contrast checks always cover.
 */
export function BadgeBand() {
  return (
    <div
      data-part="badge-band"
      className="relative h-28 w-full bg-(--card-accent) text-(--card-accent-text)"
    >
      <span
        aria-hidden="true"
        data-part="lanyard-slot"
        className="absolute top-3 left-1/2 h-2.5 w-16 -translate-x-1/2 rounded-full bg-(--card-bg) shadow-[inset_0_1px_3px_rgba(0,0,0,0.45)]"
      />
      <p className="absolute inset-x-0 top-8 text-center text-xs font-bold tracking-[0.24em] uppercase">
        WashU SHPE
      </p>
    </div>
  );
}

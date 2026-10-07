import { useState } from "react";

import type { CardAvatarShape } from "../model";
import { cn } from "@/lib/utils";
import { initials } from "./format";

/**
 * The member's photo, or their initials in the accent colour when there is no
 * photo (or it fails to load). The shape comes from --card-avatar-radius and
 * the size from --card-avatar-size, both set by the theme.
 *
 * The image is decorative (alt=""): the name is the heading right beside it,
 * and "photo of Diego Gonzalez" followed by "Diego Gonzalez" says it twice.
 */
export function Avatar({
  name,
  src,
  shape,
  ring,
  overlap,
  className,
}: {
  name: string;
  src: string | null;
  shape: CardAvatarShape;
  ring: boolean;
  /** Pulled up over a banner or badge band by half its height. */
  overlap: boolean;
  className?: string;
}) {
  // Remember which URL failed, so a new photo gets a fresh chance to load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (shape === "hidden") return null;
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div
      data-part="avatar"
      data-shape={shape}
      className={cn(
        "relative size-(--card-avatar-size) shrink-0 overflow-hidden rounded-(--card-avatar-radius) bg-(--card-surface)",
        ring
          ? "ring-[3px] ring-(--card-accent) ring-offset-[3px] ring-offset-(--card-surface)"
          : overlap && "border-4 border-(--card-surface)",
        overlap && "-mt-[calc(var(--card-pad)+var(--card-avatar-size)/2)]",
        className,
      )}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          width={224}
          height={224}
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-full items-center justify-center bg-(--card-accent) text-[length:calc(var(--card-avatar-size)*0.36)] font-bold text-(--card-accent-text) select-none"
        >
          {initials(name)}
        </span>
      )}
    </div>
  );
}

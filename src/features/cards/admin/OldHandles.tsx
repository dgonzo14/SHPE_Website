import { Button } from "@/components/ui/button";
import { memberName } from "@/services/members";
import { cn } from "@/lib/utils";
import type { RowWithCard } from "./adminCardRows";

/**
 * A member's earlier handles, each with a way to take it away.
 *
 * Shown because they're otherwise invisible: an old handle keeps redirecting to
 * the card, stays blocked for everyone else, and the member can switch back to
 * it at any time. That's right for an ordinary rename, but it's also how a
 * member could hold on to someone else's name after renaming away from it, so
 * officers need to see them and be able to release one.
 */
export function OldHandles({
  row,
  onRelease,
  className,
}: {
  row: RowWithCard;
  onRelease: (handle: string) => void;
  className?: string;
}) {
  const oldHandles = row.old_handles ?? [];
  if (oldHandles.length === 0) return null;
  const name = memberName(row);

  return (
    <div className={cn("text-xs text-gray-600", className)}>
      <p>
        {oldHandles.length === 1 ? "Old handle" : "Old handles"}, still theirs and redirecting
        here:
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {oldHandles.map((handle) => (
          <li key={handle} className="flex flex-wrap items-center gap-x-2">
            <span className="break-all font-mono text-gray-800">{handle}</span>
            <Button
              size="sm"
              variant="ghost"
              className="px-2"
              // Starts with the visible word, so voice control still finds it.
              aria-label={`Release ${handle} from ${name}'s card`}
              onClick={() => onRelease(handle)}
            >
              Release
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

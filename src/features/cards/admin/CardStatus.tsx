import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/primitives";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { AdminCardRow } from "@/types/database";
import { cardStatusBadges, chipCarriesOldHandle, chipIsDead, hasCard } from "./adminCardRows";

/** The card's status as badges, with the hide reason under them when there is one. */
export function CardStatusBadges({ row, className }: { row: AdminCardRow; className?: string }) {
  return (
    <span className={cn("flex flex-col items-start gap-1", className)}>
      <span className="flex flex-wrap gap-1">
        {cardStatusBadges(row).map((badge) => (
          <Badge key={badge.label} tone={badge.tone}>
            {badge.label}
          </Badge>
        ))}
      </span>
      {row.status === "hidden" && row.hidden_reason && (
        <span className="max-w-[28ch] text-xs text-gray-600">
          <span className="sr-only">Hidden because: </span>
          {row.hidden_reason}
        </span>
      )}
    </span>
  );
}

/**
 * Whether a chip has been written for this member, and with which handle.
 *
 * Two different situations look alike from the handles alone: a chip on a
 * handle the member renamed still redirects, while a chip on a handle an
 * officer reset or released no longer leads to them at all. The database
 * reports which (chip_handle_active), because guessing wrong in either
 * direction costs a chip.
 *
 * A taken-away handle is free for anyone else to claim, so the dead-chip copy
 * doesn't promise the chip opens nothing: once someone claims the handle, the
 * chip opens their card, which is the more urgent reason to rewrite it.
 */
export function ChipStatus({ row }: { row: AdminCardRow }) {
  if (!hasCard(row)) return <span className="text-gray-500">—</span>;

  if (!row.chip_written_at) {
    return <span className="text-gray-600">Not yet</span>;
  }

  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="text-gray-800">
        Written <span className="whitespace-nowrap">{formatDate(row.chip_written_at)}</span>
      </span>
      {chipIsDead(row) ? (
        <span className="flex max-w-[30ch] items-start gap-1 text-xs font-medium text-red-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Needs rewriting: the chip carries <span className="font-mono">{row.chip_handle}</span>,
            which is no longer theirs. A tap shows “card not available”, or another member's card
            if someone has claimed that handle since.
          </span>
        </span>
      ) : (
        chipCarriesOldHandle(row) && (
          <span className="max-w-[30ch] text-xs text-gray-700">
            Chip carries <span className="font-mono">{row.chip_handle}</span>, an old handle. It
            still redirects here.
          </span>
        )
      )}
    </span>
  );
}

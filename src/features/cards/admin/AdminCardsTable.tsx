import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, Table, Td, Th } from "@/components/ui/primitives";
import { memberName } from "@/services/members";
import { cn } from "@/lib/utils";
import type { AdminCardRow } from "@/types/database";
import { hasCard, isCardLive, type RowWithCard } from "./adminCardRows";
import { CardStatusBadges, ChipStatus } from "./CardStatus";
import { OldHandles } from "./OldHandles";

export interface AdminCardRowActions {
  onCreate: (row: AdminCardRow) => void;
  onToggleHidden: (row: RowWithCard) => void;
  onResetHandle: (row: RowWithCard) => void;
  /** Release one of the member's old handles. */
  onReleaseHandle: (row: RowWithCard, handle: string) => void;
  onPosition: (row: AdminCardRow) => void;
}

interface AdminCardsTableProps extends AdminCardRowActions {
  rows: AdminCardRow[];
  selected: ReadonlySet<string>;
  onToggleRow: (memberId: string) => void;
  /** Selects every row shown, or clears them all when they are all selected already. */
  onToggleAll: () => void;
  cardsEnabled: boolean;
}

/**
 * Every approved member as a card row: a table from md up, a list of cards
 * below it, the same pattern as Admin → Members. Selection is by member id and
 * lives in the page, so it survives searching for the next name to tick.
 */
export function AdminCardsTable({
  rows,
  selected,
  onToggleRow,
  onToggleAll,
  cardsEnabled,
  onReleaseHandle,
  ...actions
}: AdminCardsTableProps) {
  const selectedShown = rows.filter((row) => selected.has(row.member_id)).length;
  const allShownSelected = rows.length > 0 && selectedShown === rows.length;

  return (
    <>
      <Card className="hidden md:block">
        <Table caption="Approved members with their business card, chip and position">
          <thead>
            <tr>
              <Th className="w-12">
                <SelectBox
                  label="Select every member shown"
                  checked={allShownSelected}
                  indeterminate={selectedShown > 0 && !allShownSelected}
                  onChange={onToggleAll}
                />
              </Th>
              <Th>Name</Th>
              <Th>Handle</Th>
              <Th>Card</Th>
              <Th>Chip</Th>
              <Th>Position</Th>
              <Th className="text-right">Views (30 days)</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSelected = selected.has(row.member_id);
              return (
                <tr key={row.member_id} className={cn(isSelected && "bg-shpe-navy-soft/40")}>
                  <Td>
                    <SelectBox
                      label={`Select ${memberName(row)}`}
                      checked={isSelected}
                      onChange={() => onToggleRow(row.member_id)}
                    />
                  </Td>
                  <Td>
                    <Link
                      to={`/admin/members/${row.member_id}`}
                      className="font-medium text-shpe-navy"
                    >
                      {memberName(row)}
                    </Link>
                    <span className="block text-xs text-gray-500">{row.email}</span>
                  </Td>
                  <Td>
                    <HandleCell
                      row={row}
                      cardsEnabled={cardsEnabled}
                      onReleaseHandle={onReleaseHandle}
                    />
                  </Td>
                  <Td>
                    <CardStatusBadges row={row} />
                  </Td>
                  <Td>
                    <ChipStatus row={row} />
                  </Td>
                  <Td className="text-gray-700">{row.position ?? "—"}</Td>
                  <Td className="text-right tabular-nums text-gray-800">
                    {hasCard(row) ? row.views_30d : "—"}
                  </Td>
                  <Td>
                    <RowActions row={row} {...actions} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="md:hidden">
        {/* The words are the label itself, so tapping them ticks the box and a
            voice-control user can say exactly what they see. */}
        <div className="mb-2">
          <SelectBox
            label="Select all shown"
            visibleLabel
            checked={allShownSelected}
            indeterminate={selectedShown > 0 && !allShownSelected}
            onChange={onToggleAll}
          />
        </div>
        <ul className="space-y-3">
          {rows.map((row) => {
            const isSelected = selected.has(row.member_id);
            return (
              <li key={row.member_id}>
                <Card className={cn("p-4", isSelected && "border-shpe-navy")}>
                  <div className="flex items-start gap-2">
                    <SelectBox
                      label={`Select ${memberName(row)}`}
                      checked={isSelected}
                      onChange={() => onToggleRow(row.member_id)}
                    />
                    <div className="min-w-0 flex-1">
                      <Link to={`/admin/members/${row.member_id}`} className="font-semibold">
                        {memberName(row)}
                      </Link>
                      <p className="truncate text-sm text-gray-600">{row.email}</p>
                      <CardStatusBadges row={row} className="mt-2" />
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-gray-500">Handle</dt>
                    <dd className="min-w-0">
                      <HandleCell
                        row={row}
                        cardsEnabled={cardsEnabled}
                        onReleaseHandle={onReleaseHandle}
                      />
                    </dd>
                    <dt className="text-gray-500">Chip</dt>
                    <dd>
                      <ChipStatus row={row} />
                    </dd>
                    <dt className="text-gray-500">Position</dt>
                    <dd className="text-gray-800">{row.position ?? "—"}</dd>
                    {hasCard(row) && (
                      <>
                        <dt className="text-gray-500">Views (30 days)</dt>
                        <dd className="tabular-nums text-gray-800">{row.views_30d}</dd>
                      </>
                    )}
                  </dl>

                  <RowActions row={row} {...actions} className="mt-4 justify-start" />
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/**
 * The handle, linked to the live card only when opening it would actually show
 * the card. A link that lands on "card not available" reads as a bug. The
 * member's old handles sit under it, each with Release.
 */
function HandleCell({
  row,
  cardsEnabled,
  onReleaseHandle,
}: {
  row: AdminCardRow;
  cardsEnabled: boolean;
  onReleaseHandle: AdminCardRowActions["onReleaseHandle"];
}) {
  if (!hasCard(row)) return <span className="text-gray-500">—</span>;

  return (
    <>
      {isCardLive(row, cardsEnabled) ? (
        <Link
          to={`/card/${encodeURIComponent(row.handle)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[24px] items-center gap-1 break-all font-mono"
        >
          {row.handle}
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="sr-only">(opens the live card in a new tab)</span>
        </Link>
      ) : (
        <span className="break-all font-mono text-gray-800">{row.handle}</span>
      )}
      <OldHandles
        row={row}
        onRelease={(handle) => onReleaseHandle(row, handle)}
        className="mt-1"
      />
    </>
  );
}

function RowActions({
  row,
  onCreate,
  onToggleHidden,
  onResetHandle,
  onPosition,
  className,
}: Omit<AdminCardRowActions, "onReleaseHandle"> & { row: AdminCardRow; className?: string }) {
  // Each button names its member: a column of identical "Hide" buttons is
  // useless to a screen reader moving through the page by control. The visible
  // text starts every label, so voice control still finds it by what it says.
  const name = memberName(row);
  // sm buttons are 36px; these are pressed on phones at card-writing night too.
  const touch = "min-h-[44px] whitespace-nowrap";

  return (
    <div className={cn("flex flex-wrap justify-end gap-2", className)}>
      {hasCard(row) ? (
        <>
          <Button
            size="sm"
            variant="outline"
            className={touch}
            aria-label={`${row.status === "hidden" ? "Unhide" : "Hide"} ${name}'s card`}
            onClick={() => onToggleHidden(row)}
          >
            {row.status === "hidden" ? "Unhide" : "Hide"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={touch}
            aria-label={`Reset handle for ${name}`}
            onClick={() => onResetHandle(row)}
          >
            Reset handle
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          className={touch}
          aria-label={`Create card for ${name}`}
          onClick={() => onCreate(row)}
        >
          Create card
        </Button>
      )}
      <Button
        size="sm"
        variant="subtle"
        className={touch}
        aria-label={`${row.position ? "Edit" : "Set"} position for ${name}`}
        onClick={() => onPosition(row)}
      >
        {row.position ? "Edit position" : "Set position"}
      </Button>
    </div>
  );
}

/**
 * A checkbox with a 44px hit area. The visible box stays small enough for a
 * table row; the label around it is what takes the tap.
 *
 * With `visibleLabel` the label text is shown beside the box and is its
 * accessible name, rather than a separate aria-label that could drift from
 * what's on screen.
 */
function SelectBox({
  label,
  visibleLabel = false,
  checked,
  indeterminate = false,
  onChange,
}: {
  label: string;
  visibleLabel?: boolean;
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "shrink-0 cursor-pointer items-center",
        visibleLabel
          ? "inline-flex min-h-[44px] gap-2"
          : "-m-2 inline-flex h-11 w-11 justify-center",
      )}
    >
      <input
        type="checkbox"
        aria-label={visibleLabel ? undefined : label}
        checked={checked}
        onChange={onChange}
        // `indeterminate` has no HTML attribute; it can only be set on the element.
        ref={(element) => {
          if (element) element.indeterminate = indeterminate;
        }}
        className="h-5 w-5 cursor-pointer border-shpe-rule-strong text-shpe-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
      />
      {visibleLabel && <span className="text-sm text-gray-700">{label}</span>}
    </label>
  );
}

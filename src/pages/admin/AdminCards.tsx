import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, IdCard, Nfc, Power, PowerOff, WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  StatCard,
} from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { AdminCardsTable } from "@/features/cards/admin/AdminCardsTable";
import { BulkCreateDialog } from "@/features/cards/admin/BulkCreateDialog";
import { ChipAddress } from "@/features/cards/admin/ChipAddress";
import { CreateCardDialog } from "@/features/cards/admin/CreateCardDialog";
import { HideCardDialog } from "@/features/cards/admin/HideCardDialog";
import { PositionDialog } from "@/features/cards/admin/PositionDialog";
import {
  ReleaseHandleDialog,
  type ReleaseTarget,
} from "@/features/cards/admin/ReleaseHandleDialog";
import { ResetHandleDialog } from "@/features/cards/admin/ResetHandleDialog";
import {
  CARD_FILTERS,
  filterCardRows,
  hasCard,
  programmingSheetCsv,
  type CardFilter,
  type RowWithCard,
} from "@/features/cards/admin/adminCardRows";
import { checkThisSiteChipOrigin } from "@/features/cards/admin/chipOrigin";
import {
  useAdminCards,
  useMarkChipsWritten,
  useSetCardsEnabled,
} from "@/features/cards/admin/useAdminCards";
import { useAppConfig } from "@/hooks/useAppConfig";
import { usePageMeta } from "@/hooks/usePageMeta";
import { memberName } from "@/services/members";
import { csvFilename, downloadCsv } from "@/lib/csv";
import { errorText } from "@/lib/errors";
import type { AdminCardRow } from "@/types/database";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Ana Rivera, Bruno Díaz and 3 others", short enough for a toast. */
function nameList(names: string[], shown = 3): string {
  if (names.length <= shown) {
    return names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const rest = names.length - shown;
  return `${names.slice(0, shown).join(", ")} and ${plural(rest, "other", "others")}`;
}

/**
 * Admin → Business Cards: the feature switch, every approved member's card,
 * and the tools for card-writing night (create the missing cards, export the
 * NFC programming sheet, mark chips written).
 *
 * Officer-only because the RPCs say so, not because of this file: every
 * admin_* function starts with require_officer() and writes an audit row, and
 * the card tables have no grants to any client role at all.
 */
export function AdminCards() {
  usePageMeta({ title: "Business Cards | WashU SHPE", noindex: true });

  const toast = useToast();
  const config = useAppConfig();
  const cards = useAdminCards();
  const setEnabled = useSetCardsEnabled();
  const markChips = useMarkChipsWritten();

  // ?q= lets the member detail page link straight to one member's row.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [filter, setFilter] = useState<CardFilter>("all");
  /*
   * Selected member ids. Deliberately not cleared when the search changes: on
   * card-writing night an officer searches for each name in turn to tick the
   * chips they've written, and losing the earlier ticks would defeat that.
   */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const [confirmDisable, setConfirmDisable] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [createFor, setCreateFor] = useState<AdminCardRow | null>(null);
  const [hideFor, setHideFor] = useState<RowWithCard | null>(null);
  const [resetFor, setResetFor] = useState<RowWithCard | null>(null);
  const [releaseFor, setReleaseFor] = useState<ReleaseTarget | null>(null);
  const [positionFor, setPositionFor] = useState<AdminCardRow | null>(null);
  const [confirmMark, setConfirmMark] = useState(false);
  const [confirmUnsafeExport, setConfirmUnsafeExport] = useState(false);
  /*
   * The handle each member had on the last programming sheet exported from this
   * page. Mark chips written records these rather than whatever the list says
   * by then: a chip carries what was on the sheet, and a member can rename in
   * between (the list refreshes after any officer action). Members who weren't
   * exported here are recorded with the handle shown in the confirm dialog.
   */
  const [exportedHandles, setExportedHandles] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );

  /*
   * Stable close handlers. Dialog re-runs its open effect (and moves focus to
   * its close button) whenever onClose changes identity, and this page
   * re-renders on every toast, so inline arrows would yank focus out of a
   * half-typed reason.
   */
  const closeDisable = useCallback(() => setConfirmDisable(false), []);
  const closeBulk = useCallback(() => setBulkOpen(false), []);
  const closeCreate = useCallback(() => setCreateFor(null), []);
  const closeHide = useCallback(() => setHideFor(null), []);
  const closeReset = useCallback(() => setResetFor(null), []);
  const closeRelease = useCallback(() => setReleaseFor(null), []);
  const closePosition = useCallback(() => setPositionFor(null), []);
  const closeMark = useCallback(() => setConfirmMark(false), []);
  const closeUnsafeExport = useCallback(() => setConfirmUnsafeExport(false), []);

  const enabled = config.data?.cards_enabled === true;
  const allRows = useMemo(() => cards.data?.rows ?? [], [cards.data]);
  const shownRows = useMemo(
    () => filterCardRows(allRows, { search, filter }),
    [allRows, search, filter],
  );
  // Derived from the current rows, so an id that has dropped out of the list
  // since it was ticked counts for nothing.
  const selectedRows = allRows.filter((row) => selected.has(row.member_id));
  const hasSelection = selectedRows.length > 0;
  const selectedWithCard = selectedRows.filter(hasCard);
  const shownIds = new Set(shownRows.map((row) => row.member_id));
  const selectedNotShown = selectedRows.filter((row) => !shownIds.has(row.member_id)).length;

  // With nothing ticked, the sheet is everyone shown who has a card, so "Card,
  // but no chip yet" plus Export is the list of chips still to write.
  const exportRows = hasSelection ? selectedWithCard : shownRows.filter(hasCard);
  const exportSkipped = hasSelection ? selectedRows.length - selectedWithCard.length : 0;

  // What Mark chips written will record for each selected card, and shows first.
  const chipsToMark = selectedWithCard.map((row) => ({
    row,
    handle: exportedHandles.get(row.member_id) ?? row.handle,
  }));

  const chipOrigin = checkThisSiteChipOrigin();

  /* ── Feature switch ─────────────────────────────────────────────────── */

  const toggle = async (next: boolean) => {
    try {
      await setEnabled.mutateAsync(next);
      setConfirmDisable(false);
      toast.success(
        next ? "Business cards are on" : "Business cards are off",
        next
          ? "Members can now build a card, and published cards are live."
          : "Every card shows “card not available” until you turn them back on.",
      );
    } catch (error) {
      toast.error("We couldn't change that", errorText(error));
    }
  };

  /* ── Selection ──────────────────────────────────────────────────────── */

  const toggleRow = (memberId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  };

  const toggleAllShown = () => {
    setSelected((current) => {
      const next = new Set(current);
      const allShownSelected =
        shownRows.length > 0 && shownRows.every((row) => next.has(row.member_id));
      for (const row of shownRows) {
        if (allShownSelected) next.delete(row.member_id);
        else next.add(row.member_id);
      }
      return next;
    });
  };

  /* ── Programming sheet ──────────────────────────────────────────────── */

  const exportSheet = () => {
    setConfirmUnsafeExport(false);
    downloadCsv(csvFilename("shpe-nfc-programming-sheet"), programmingSheetCsv(exportRows));
    setExportedHandles((current) => {
      const next = new Map(current);
      for (const row of exportRows) next.set(row.member_id, row.handle);
      return next;
    });
    toast.success(
      `Exported ${plural(exportRows.length, "chip address", "chip addresses")}`,
      exportSkipped > 0
        ? `${plural(exportSkipped, "selected member has", "selected members have")} no card yet and ${exportSkipped === 1 ? "was" : "were"} left out.`
        : undefined,
    );
  };

  const requestExport = () => {
    if (chipOrigin.problems.length > 0) setConfirmUnsafeExport(true);
    else exportSheet();
  };

  const markWritten = async () => {
    try {
      const result = await markChips.mutateAsync(
        chipsToMark.map(({ row, handle }) => ({ memberId: row.member_id, handle })),
      );
      setConfirmMark(false);
      /*
       * The database records nothing for a member who no longer holds the
       * handle sent (an officer reset or released it since the export). Those
       * stay selected, so exporting again gives the sheet for exactly the
       * chips that need rewriting.
       */
      const skipped = result.skipped;
      setSelected(new Set(skipped));
      if (skipped.length === 0) {
        toast.success(
          `Marked ${plural(result.count, "chip", "chips")} as written`,
          "Each records the handle it carries and today's date.",
        );
        return;
      }
      const names = skipped
        .map((id) => allRows.find((row) => row.member_id === id))
        .filter((row): row is AdminCardRow => row !== undefined)
        .map((row) => memberName(row));
      const detail = `${plural(skipped.length, "chip", "chips")} skipped${
        names.length > 0 ? ` (${nameList(names)})` : ""
      }: the handle on the sheet was reset or released since it was exported, so the chip no longer reaches their card. They're still selected, so export the sheet again and rewrite ${skipped.length === 1 ? "that chip" : "those chips"}.`;
      if (result.count === 0) toast.error("No chips were marked", detail);
      else toast.info(`Marked ${plural(result.count, "chip", "chips")} as written`, detail);
    } catch (error) {
      toast.error("We couldn't mark those chips", errorText(error));
    }
  };

  /* ── Summary numbers ────────────────────────────────────────────────── */

  const withCard = allRows.filter(hasCard);
  const published = allRows.filter((row) => row.status === "published").length;
  const chipsWritten = withCard.filter((row) => row.chip_written_at !== null).length;

  return (
    <>
      <PageHeader
        title="Business cards"
        description="Every approved member's digital business card, and the tools for card-writing night."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Feature switch ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Feature switch</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {config.isPending ? (
              <SkeletonList rows={1} />
            ) : config.isError ? (
              <ErrorState error={config.error} onRetry={() => void config.refetch()} />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-700">Members can use business cards</span>
                  {enabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}
                </div>

                <p className="text-sm text-gray-600">
                  {enabled
                    ? "Members see My Card in their menu and can build and publish a card. Published cards open at /card/<handle>, including from chips and QR codes."
                    : "Members don't see My Card, and every card address shows “card not available”, even published ones. Officers can still set up their own card and create cards for members, so everything is ready before launch."}
                </p>

                <Button
                  variant={enabled ? "outline" : "primary"}
                  block
                  loading={setEnabled.isPending && !confirmDisable}
                  onClick={() => (enabled ? setConfirmDisable(true) : void toggle(true))}
                >
                  {enabled ? (
                    <>
                      <PowerOff className="h-4 w-4" aria-hidden />
                      Turn business cards off
                    </>
                  ) : (
                    <>
                      <Power className="h-4 w-4" aria-hidden />
                      Turn business cards on
                    </>
                  )}
                </Button>
              </>
            )}
          </CardBody>
        </Card>

        {/* ── Card-writing night ───────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Card-writing night</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
              <li>Create cards for everyone missing one, after checking the preview.</li>
              <li>Export the NFC programming sheet below: name, handle and the exact chip URL.</li>
              <li>Write each chip with its Chip URL, then password-protect it.</li>
              <li>Tick the rows you wrote and choose Mark chips written.</li>
            </ol>
            <Button block variant="secondary" onClick={() => setBulkOpen(true)}>
              <WandSparkles className="h-4 w-4" aria-hidden />
              Create cards for everyone missing one
            </Button>
            <ChipAddress />
          </CardBody>
        </Card>
      </div>

      {/* ── Members ────────────────────────────────────────────────────── */}
      <section aria-labelledby="cards-members" className="mt-8">
        <h2 id="cards-members" className="mb-4 text-xl font-bold text-shpe-navy">
          Members
        </h2>

        {cards.isSuccess && (
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Approved members" value={allRows.length} />
            <StatCard label="Have a card" value={withCard.length} tone="blue" />
            <StatCard label="Published" value={published} tone="orange" />
            <StatCard label="Chips written" value={chipsWritten} tone="gold" />
          </div>
        )}

        <Card className="mb-4">
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Search">
              {(props) => (
                <Input
                  {...props}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email or handle"
                />
              )}
            </Field>
            <Field label="Show">
              {(props) => (
                <Select
                  {...props}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as CardFilter)}
                >
                  {CARD_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </CardBody>
        </Card>

        {/* ── Selection and bulk actions ───────────────────────────────── */}
        <div
          className="mb-4 flex flex-col gap-3 border border-shpe-rule bg-shpe-navy-soft/40 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
          aria-label="Selected members"
          role="group"
        >
          <div className="text-sm text-gray-700" aria-live="polite">
            {!hasSelection ? (
              <span>No members selected. The sheet will include everyone shown with a card.</span>
            ) : (
              <span>
                <strong className="text-shpe-navy">
                  {plural(selectedRows.length, "member", "members")}
                </strong>{" "}
                selected
                {selectedNotShown > 0 && ` (${selectedNotShown} not shown by this search)`}.
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {hasSelection && (
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            )}
            <Button variant="outline" onClick={requestExport} disabled={exportRows.length === 0}>
              <Download className="h-4 w-4" aria-hidden />
              Export NFC programming sheet
              {exportRows.length > 0 && ` (${exportRows.length})`}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmMark(true)}
              disabled={selectedWithCard.length === 0}
            >
              <Nfc className="h-4 w-4" aria-hidden />
              Mark chips written
              {selectedWithCard.length > 0 && ` (${selectedWithCard.length})`}
            </Button>
          </div>
        </div>

        {cards.isPending ? (
          <SkeletonList rows={5} />
        ) : cards.isError ? (
          <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />
        ) : shownRows.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title={allRows.length === 0 ? "No approved members yet" : "Nobody matches"}
            description={
              allRows.length === 0
                ? "Members appear here once their account is approved."
                : "Try clearing the search or choosing Everyone."
            }
          />
        ) : (
          <AdminCardsTable
            rows={shownRows}
            selected={selected}
            onToggleRow={toggleRow}
            onToggleAll={toggleAllShown}
            cardsEnabled={enabled}
            onCreate={setCreateFor}
            onToggleHidden={setHideFor}
            onResetHandle={setResetFor}
            onReleaseHandle={(row, handle) => setReleaseFor({ row, handle })}
            onPosition={setPositionFor}
          />
        )}
      </section>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}

      <ConfirmDialog
        open={confirmDisable}
        onClose={closeDisable}
        onConfirm={() => void toggle(false)}
        loading={setEnabled.isPending}
        confirmLabel="Turn cards off"
        title="Turn business cards off?"
        description="Every card shows “card not available” straight away, including on chips already handed out, until you turn them back on. Members lose My Card from their menu. Nothing is deleted."
      />

      {bulkOpen && <BulkCreateDialog onClose={closeBulk} />}

      <CreateCardDialog member={createFor} onClose={closeCreate} />
      <HideCardDialog row={hideFor} onClose={closeHide} />
      <ResetHandleDialog row={resetFor} onClose={closeReset} />
      <ReleaseHandleDialog target={releaseFor} onClose={closeRelease} />
      <PositionDialog member={positionFor} onClose={closePosition} />

      <ConfirmDialog
        open={confirmMark}
        onClose={closeMark}
        onConfirm={() => void markWritten()}
        loading={markChips.isPending}
        destructive={false}
        confirmLabel={`Mark ${plural(selectedWithCard.length, "chip", "chips")} written`}
        title="Mark these chips as written?"
        description={
          <>
            Records each chip as carrying the handle listed, dated today: the one on the sheet you
            exported from this page, or their current handle. Do this once the chips are written
            and locked.
            {selectedRows.length > selectedWithCard.length &&
              ` ${plural(
                selectedRows.length - selectedWithCard.length,
                "selected member has",
                "selected members have",
              )} no card and will be skipped.`}
          </>
        }
      >
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-gray-700">
          {chipsToMark.map(({ row, handle }) => (
            <li key={row.member_id}>
              {memberName(row)} · <span className="font-mono">{handle}</span>
              {handle !== row.handle && (
                <span className="text-gray-600">
                  {" "}
                  (from the sheet; their handle is now{" "}
                  <span className="font-mono">{row.handle}</span>)
                </span>
              )}
            </li>
          ))}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmUnsafeExport}
        onClose={closeUnsafeExport}
        onConfirm={exportSheet}
        confirmLabel="Export anyway"
        title="This sheet has the wrong address for chips"
        description={
          <>
            Every Chip URL would start with{" "}
            <span className="font-mono">{chipOrigin.origin ?? "an incomplete address"}</span>.{" "}
            {chipOrigin.problems.join(" ")} Export it for checking only, and don't write chips from
            it.
          </>
        }
      />
    </>
  );
}

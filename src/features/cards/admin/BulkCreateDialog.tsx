import { useEffect, useState } from "react";
import { UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Checkbox, Table, Td, Th } from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { useAppConfig } from "@/hooks/useAppConfig";
import { errorText } from "@/lib/errors";
import type { BulkCreateCardsResult } from "@/types/database";
import { isFallbackHandle } from "./adminCardRows";
import { useCreateMissingCards, useCreateMissingCardsPreview } from "./useAdminCards";

/*
 * Only a blank name is skipped. A name in a script a web address can't spell
 * (王芳, Иван) still gets a card, with a member-xxxxxx handle; see
 * FallbackHandleNote.
 */
const SKIP_REASONS: Record<BulkCreateCardsResult["skipped"][number]["reason"], string> = {
  no_name: "No name on their profile, so there's nothing to make a handle from. Add one, then run this again.",
};

function skippedName(member: BulkCreateCardsResult["skipped"][number]): string {
  return member.name.trim() || member.email;
}

/**
 * "Create cards for everyone missing one", for the night before card-writing.
 *
 * Nothing is written until the officer has seen the list. The preview is the
 * same function run with dryRun, so the handles shown are the ones the database
 * would pick, not a client-side guess that could drift from it. Changing the
 * publish choice asks again rather than assuming the list is unaffected.
 *
 * Mounted only while open, so every opening starts from a fresh preview with
 * publishing off.
 */
export function BulkCreateDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const config = useAppConfig();
  // Published starter cards only open while the feature switch is on.
  const cardsOff = config.isSuccess && config.data.cards_enabled !== true;
  const [publish, setPublish] = useState(false);
  const preview = useCreateMissingCardsPreview();
  const create = useCreateMissingCards();
  const { mutate: runPreview } = preview;

  useEffect(() => {
    runPreview({ publish });
  }, [publish, runPreview]);

  const result = create.data;
  const proposed = preview.data;

  const confirm = async () => {
    try {
      const done = await create.mutateAsync({ publish });
      if (done.created.length === 0) {
        toast.info("No cards were needed", "Every active member already has one.");
      } else {
        toast.success(
          `Created ${done.created.length} ${done.created.length === 1 ? "card" : "cards"}`,
          !done.published
            ? "They stay unpublished until each member publishes."
            : cardsOff
              ? "They're published as starter cards, and go live when business cards are turned on."
              : "They're published as starter cards.",
        );
      }
    } catch (error) {
      toast.error("We couldn't create the cards", errorText(error));
    }
  };

  /* ── After the real run ─────────────────────────────────────────────── */

  if (result) {
    return (
      <Dialog
        open
        onClose={onClose}
        size="lg"
        title={
          result.created.length === 0
            ? "No cards were needed"
            : `Created ${result.created.length} ${result.created.length === 1 ? "card" : "cards"}`
        }
        description={
          result.created.length > 0
            ? "Next: export the NFC programming sheet, write the chips, then select those rows and mark the chips written."
            : "Every active member already has a card."
        }
        // autoFocus: the button that was pressed has just been replaced, and
        // focus would otherwise fall back to the page behind the dialog.
        footer={
          <Button onClick={onClose} autoFocus>
            Done
          </Button>
        }
      >
        <div className="space-y-5">
          {result.created.length > 0 && (
            <HandleTable
              caption="Cards created, with each member's handle"
              rows={result.created}
            />
          )}
          <FallbackHandleNote rows={result.created} />
          <SkippedList skipped={result.skipped} />
        </div>
      </Dialog>
    );
  }

  /* ── Preview ────────────────────────────────────────────────────────── */

  const count = proposed?.created.length ?? 0;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Create cards for everyone missing one"
      description="For active members without a card: their name and the school, nothing else. Alumni and inactive members aren't included; create theirs one at a time."
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void confirm()}
            loading={create.isPending}
            disabled={!proposed || preview.isPending || count === 0}
          >
            {count > 0 ? `Create ${count} ${count === 1 ? "card" : "cards"}` : "Create cards"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-3">
          <Checkbox
            checked={publish}
            onChange={(event) => setPublish(event.target.checked)}
            disabled={create.isPending}
            label="Publish them as starter cards"
          />
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-gray-600">
            <li>
              <strong className="font-medium text-gray-800">Left unticked</strong> (the default):
              the cards exist but aren't public. A chip shows “card not available” until its owner
              publishes.
            </li>
            <li>
              <strong className="font-medium text-gray-800">Ticked</strong>: every chip works the
              day it's handed out, showing name, school, major, class year and verified position,
              with Add to Contacts.
            </li>
          </ul>
          {publish && cardsOff && (
            <Alert tone="info">
              Business cards are switched off, so these won't be live until you turn them on.
            </Alert>
          )}
        </div>

        {preview.isError ? (
          <ErrorState
            error={preview.error}
            fallback="We couldn't preview the cards"
            onRetry={() => runPreview({ publish })}
          />
        ) : !proposed || preview.isPending ? (
          <>
            <SkeletonList rows={2} />
            <span role="status" className="sr-only">
              Working out handles
            </span>
          </>
        ) : (
          <>
            {count === 0 ? (
              <EmptyState
                icon={UserCheck}
                title="Every active member has a card"
                description="Nothing to create. New members appear here once they're approved."
              />
            ) : (
              <section aria-labelledby="bulk-preview-heading" className="space-y-2">
                <h3 id="bulk-preview-heading" className="font-semibold text-shpe-navy">
                  {count} {count === 1 ? "member gets" : "members get"} a card
                </h3>
                <HandleTable
                  caption="Members who would get a card, with the handle each would get"
                  rows={proposed.created}
                />
                <p className="text-xs text-gray-500">
                  Nothing has been created yet. If someone claims one of these handles before you
                  confirm, that member gets their next suggestion instead.
                </p>
                <FallbackHandleNote rows={proposed.created} />
              </section>
            )}
            <SkippedList skipped={proposed.skipped} />
          </>
        )}
      </div>
    </Dialog>
  );
}

function HandleTable({
  caption,
  rows,
}: {
  caption: string;
  rows: BulkCreateCardsResult["created"];
}) {
  return (
    <div className="max-h-72 overflow-y-auto border border-shpe-rule">
      <Table caption={caption}>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Handle</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.member_id}>
              <Td className="font-medium text-shpe-navy">{row.name}</Td>
              <Td className="font-mono text-gray-800">{row.handle}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/**
 * Explains member-xxxxxx handles, which otherwise look like a mistake. They're
 * what the database picks when a name has no letters a web address can use.
 */
function FallbackHandleNote({ rows }: { rows: BulkCreateCardsResult["created"] }) {
  const count = rows.filter((row) => isFallbackHandle(row.handle)).length;
  if (count === 0) return null;
  return (
    <p className="text-xs text-gray-600">
      {count === 1 ? "One name has" : `${count} names have`} no letters a web address can use, so{" "}
      {count === 1 ? "that member gets" : "those members get"} a handle starting with{" "}
      <span className="font-mono">member-</span>. They can pick their own in My Card later, and a
      chip written with this one keeps working.
    </p>
  );
}

function SkippedList({ skipped }: { skipped: BulkCreateCardsResult["skipped"] }) {
  if (skipped.length === 0) return null;
  return (
    <Alert
      tone="warning"
      title={`${skipped.length} ${skipped.length === 1 ? "member was" : "members were"} skipped`}
    >
      <ul className="mt-1 space-y-2">
        {skipped.map((member) => (
          <li key={member.member_id}>
            <span className="font-medium">{skippedName(member)}</span>
            {member.name.trim() && <span className="text-amber-900/80"> · {member.email}</span>}
            <span className="block">{SKIP_REASONS[member.reason] ?? member.reason}</span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

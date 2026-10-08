import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileClock } from "lucide-react";

import {
  Card,
  CardBody,
  Field,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { AUDIT_ACTION_LABELS, auditActionLabel, fetchAuditLog } from "@/services/admin";
import { memberName } from "@/services/members";
import { queryKeys } from "@/services/queryKeys";
import { formatDateTime } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";

const METADATA_LABELS: Record<string, string> = {
  title: "Event",
  role: "Role",
  from: "From",
  to: "To",
  reason: "Reason",
  adjustment: "Adjustment",
  previousAmount: "Previous total",
  newAmount: "New total",
  reversed_points: "Points reversed",
  points_awarded: "Points awarded",
  event_title: "Event",
  key: "Setting",
  invalidated_previous_code: "Replaced an existing code",
  // Business cards. Card rows name the member (display_name), because the
  // entity id alone tells an officer nothing.
  display_name: "Member",
  handle: "Handle",
  current_handle: "Current handle",
  old_handle: "Old handle",
  new_handle: "New handle",
  was_current: "Was their current handle",
  count: "Count",
  skipped_count: "Skipped",
  published: "Published",
};

/**
 * Where a key means something different for one action. null hides the key:
 * after a reset, the card's current handle is the new handle, already shown.
 */
const ACTION_METADATA_LABELS: Record<string, Record<string, string | null>> = {
  "card.position_set": { title: "Position" },
  "card.position_cleared": { title: "Position" },
  "card.handle_released": { handle: "Released handle" },
  "card.handle_reset": { handle: null },
  "card.bulk_created": { count: "Cards" },
  "card.chips_written": { count: "Chips" },
};

function formatMetadataValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Renders audit metadata as readable key/value pairs rather than raw JSON.
 * Only the keys we deliberately record are ever written, so there is no risk of
 * a whole member record leaking into this view. Ids (and lists of them) are
 * left out: nobody can read a UUID.
 */
function describeMetadata(action: string, metadata: Record<string, unknown>): string {
  const overrides = ACTION_METADATA_LABELS[action] ?? {};
  // jsonb stores keys in its own order, so put whose row it is first.
  const entries = Object.entries(metadata ?? {}).sort(
    ([a], [b]) => Number(b === "display_name") - Number(a === "display_name"),
  );

  const parts: string[] = [];
  for (const [key, value] of entries) {
    if (value === null || value === undefined || value === "") continue;
    if (key.endsWith("_id") || key.endsWith("_ids") || key === "transaction_id") continue;
    const label = key in overrides ? overrides[key] : (METADATA_LABELS[key] ?? key);
    if (label === null) continue;
    parts.push(`${label}: ${formatMetadataValue(value)}`);
  }
  return parts.join(" · ");
}

export function AdminAuditLog() {
  usePageMeta({ title: "Audit Log | WashU SHPE", noindex: true });

  const [action, setAction] = useState("");

  const audit = useQuery({
    queryKey: queryKeys.admin.auditLog({ action, limit: 200 }),
    queryFn: () => fetchAuditLog({ action: action || null, limit: 200 }),
  });

  const actions = useMemo(() => Object.keys(AUDIT_ACTION_LABELS).sort(), []);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who changed what, when, and why — for every action that affects a member's standing."
      />

      <Card className="mb-5">
        <CardBody>
          <Field label="Action">
            {(props) => (
              <Select {...props} value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">All actions</option>
                {actions.map((key) => (
                  <option key={key} value={key}>
                    {AUDIT_ACTION_LABELS[key]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      {audit.isPending ? (
        <SkeletonList rows={5} />
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : audit.data.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="Nothing logged for this filter"
          description="Role changes, point adjustments, attendance corrections, code rotations and business card actions all appear here."
        />
      ) : (
        <>
          <Card className="hidden md:block">
            <Table caption="Administrative actions with actor, time and details">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Who</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-gray-700">
                      {formatDateTime(entry.created_at)}
                    </Td>
                    <Td className="font-medium text-shpe-navy">
                      {auditActionLabel(entry.action)}
                    </Td>
                    <Td className="text-gray-700">
                      {entry.actor ? memberName(entry.actor) : "System"}
                    </Td>
                    <Td className="text-gray-700">
                      {describeMetadata(entry.action, entry.metadata)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <ul className="space-y-3 md:hidden">
            {audit.data.map((entry) => (
              <li key={entry.id}>
                <Card className="p-4">
                  <p className="font-semibold text-shpe-navy">{auditActionLabel(entry.action)}</p>
                  <p className="mt-0.5 text-sm text-gray-600">
                    {entry.actor ? memberName(entry.actor) : "System"} ·{" "}
                    {formatDateTime(entry.created_at)}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    {describeMetadata(entry.action, entry.metadata)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

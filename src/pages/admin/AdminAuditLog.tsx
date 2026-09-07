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

/**
 * Renders audit metadata as readable key/value pairs rather than raw JSON.
 * Only the keys we deliberately record are ever written, so there is no risk of
 * a whole member record leaking into this view.
 */
function describeMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  const label: Record<string, string> = {
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
  };

  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    if (key.endsWith("_id") || key === "transaction_id") continue;
    parts.push(`${label[key] ?? key}: ${String(value)}`);
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
          description="Role changes, point adjustments, attendance corrections and code rotations all appear here."
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
                    <Td className="text-gray-700">{describeMetadata(entry.metadata)}</Td>
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
                  <p className="mt-1 text-sm text-gray-700">{describeMetadata(entry.metadata)}</p>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  Field,
  Input,
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
  StatCard,
} from "@/components/shared/states";
import { fetchLedger, fetchMemberPointTotals } from "@/services/admin";
import { activeTerm } from "@/services/content";
import { useTerms } from "@/hooks/useTerms";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";

export function AdminPoints() {
  usePageMeta({ title: "Points | WashU SHPE", noindex: true });

  const terms = useTerms();
  const [termId, setTermId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const effectiveTermId =
    termId === null ? (activeTerm(terms.data ?? [])?.id ?? null) : termId || null;
  const termLabel =
    (terms.data ?? []).find((t) => t.id === effectiveTermId)?.name ?? "All time";

  const totals = useQuery({
    queryKey: ["admin", "point-totals", effectiveTermId],
    enabled: terms.isSuccess,
    queryFn: () => fetchMemberPointTotals(effectiveTermId),
  });

  const ledger = useQuery({
    queryKey: ["admin", "ledger", effectiveTermId],
    enabled: terms.isSuccess,
    queryFn: () => fetchLedger(effectiveTermId),
  });

  const rows = (totals.data ?? []).filter((row) => {
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return (
      `${row.first_name} ${row.last_name}`.toLowerCase().includes(term) ||
      row.email.toLowerCase().includes(term)
    );
  });

  const totalAwarded = (totals.data ?? []).reduce((sum, r) => sum + r.total_points, 0);

  const exportLedger = () => {
    const csv = toCsv(ledger.data ?? [], [
      {
        header: "Member name",
        value: (r) => (r.member ? `${r.member.first_name} ${r.member.last_name}`.trim() : ""),
      },
      { header: "Email", value: (r) => r.member?.email ?? "" },
      { header: "Points", value: (r) => r.amount },
      { header: "Type", value: (r) => r.transaction_type.replace(/_/g, " ") },
      { header: "Event", value: (r) => r.event?.title ?? "" },
      { header: "Reason", value: (r) => r.description ?? "" },
      { header: "Recorded at", value: (r) => formatDateTime(r.created_at) },
      {
        header: "Recorded by",
        value: (r) =>
          r.created_by_profile
            ? `${r.created_by_profile.first_name} ${r.created_by_profile.last_name}`.trim()
            : "",
      },
    ]);
    downloadCsv(csvFilename("shpe-point-ledger", termLabel), csv);
  };

  return (
    <>
      <PageHeader
        title="Points"
        description={`Chapter point totals for ${termLabel}.`}
        actions={
          <Button
            variant="outline"
            onClick={exportLedger}
            disabled={(ledger.data ?? []).length === 0}
          >
            <Download className="h-4 w-4" aria-hidden />
            Export ledger
          </Button>
        }
      />

      <Card className="mb-5">
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Period">
            {(props) => (
              <Select
                {...props}
                value={effectiveTermId ?? ""}
                onChange={(e) => setTermId(e.target.value)}
              >
                {(terms.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="">All time</option>
              </Select>
            )}
          </Field>
          <Field label="Search">
            {(props) => (
              <Input
                {...props}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or email"
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Points awarded" value={totalAwarded} hint={termLabel} tone="orange" />
        <StatCard label="Members with points" value={(totals.data ?? []).length} hint={termLabel} />
        <StatCard label="Ledger entries" value={(ledger.data ?? []).length} hint={termLabel} />
      </div>

      {totals.isPending ? (
        <SkeletonList rows={5} />
      ) : totals.isError ? (
        <ErrorState error={totals.error} onRetry={() => void totals.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No points recorded for this period"
          description="Points appear once members check into events that award them."
        />
      ) : (
        <>
          <Card className="hidden md:block">
            <Table caption={`Member point totals for ${termLabel}`}>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Email</Th>
                  <Th>Class</Th>
                  <Th>Status</Th>
                  <Th>Entries</Th>
                  <Th>Points</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.member_id}>
                    <Td className="font-medium text-shpe-navy">
                      <Link to={`/admin/members/${row.member_id}`}>
                        {`${row.first_name} ${row.last_name}`.trim() || row.email}
                      </Link>
                    </Td>
                    <Td className="text-gray-700">{row.email}</Td>
                    <Td className="text-gray-700">{row.graduation_year ?? "—"}</Td>
                    <Td className="capitalize text-gray-700">{row.membership_status}</Td>
                    <Td className="text-gray-700">{row.transaction_count}</Td>
                    <Td className="font-semibold text-shpe-navy">{row.total_points}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.member_id}>
                <Card className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <Link
                      to={`/admin/members/${row.member_id}`}
                      className="block truncate py-1 font-semibold"
                    >
                      {`${row.first_name} ${row.last_name}`.trim() || row.email}
                    </Link>
                    <p className="truncate text-sm text-gray-600" title={row.email}>
                      {row.email}
                    </p>
                  </div>
                  <span className="shrink-0 text-lg font-bold tabular-nums text-shpe-navy">
                    {row.total_points}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

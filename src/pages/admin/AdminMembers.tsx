import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Badge,
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
} from "@/components/shared/states";
import { fetchMembers, memberName } from "@/services/members";
import { queryKeys } from "@/services/queryKeys";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { AppRole, MembershipStatus } from "@/types/database";
import { MEMBERSHIP_STATUSES } from "@/lib/validation";
import type { BadgeTone } from "@/components/ui/primitives";

const STATUS_TONE: Record<MembershipStatus, BadgeTone> = {
  active: "success",
  pending: "warning",
  inactive: "neutral",
  alumni: "info",
  suspended: "danger",
};

export function AdminMembers() {
  usePageMeta({ title: "Members | WashU SHPE", noindex: true });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MembershipStatus | "all">("all");
  const [role, setRole] = useState<AppRole | "all">("all");
  const [gradYear, setGradYear] = useState("");

  const filters = {
    search,
    status,
    role,
    graduationYear: gradYear ? Number(gradYear) : null,
  };

  const members = useQuery({
    queryKey: queryKeys.admin.members(filters),
    queryFn: () => fetchMembers(filters),
  });

  const rows = members.data ?? [];

  const exportCsv = () => {
    const csv = toCsv(rows, [
      { header: "First name", value: (m) => m.first_name },
      { header: "Last name", value: (m) => m.last_name },
      { header: "Email", value: (m) => m.email },
      { header: "Major", value: (m) => m.major ?? "" },
      { header: "Second major or minor", value: (m) => m.secondary_major ?? "" },
      { header: "Graduation year", value: (m) => m.graduation_year ?? "" },
      { header: "Degree level", value: (m) => m.degree_level ?? "" },
      { header: "Membership status", value: (m) => m.membership_status },
      { header: "Roles", value: (m) => m.roles.join(" ") },
      { header: "SHPE National", value: (m) => m.shpe_national_member },
      { header: "Member since", value: (m) => m.member_since },
    ]);
    downloadCsv(csvFilename("shpe-member-roster"), csv);
  };

  return (
    <>
      <PageHeader
        title="Members"
        description={`${rows.length} ${rows.length === 1 ? "member" : "members"} match these filters.`}
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4" aria-hidden />
            Export roster
          </Button>
        }
      />

      <Card className="mb-5">
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search">
            {(props) => (
              <Input
                {...props}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email or major"
              />
            )}
          </Field>
          <Field label="Membership status">
            {(props) => (
              <Select
                {...props}
                value={status}
                onChange={(e) => setStatus(e.target.value as MembershipStatus | "all")}
              >
                <option value="all">All statuses</option>
                {MEMBERSHIP_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Role">
            {(props) => (
              <Select
                {...props}
                value={role}
                onChange={(e) => setRole(e.target.value as AppRole | "all")}
              >
                <option value="all">All roles</option>
                <option value="member">Member</option>
                <option value="officer">Officer</option>
                <option value="admin">Admin</option>
              </Select>
            )}
          </Field>
          <Field label="Graduation year">
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                value={gradYear}
                onChange={(e) => setGradYear(e.target.value)}
                placeholder="Any"
              />
            )}
          </Field>
        </CardBody>
      </Card>

      {members.isPending ? (
        <SkeletonList rows={5} />
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members match these filters"
          description="Try clearing the search or widening the status filter."
        />
      ) : (
        <>
          <Card className="hidden md:block">
            <Table caption="Chapter members with status, role and graduation year">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Major</Th>
                  <Th>Class</Th>
                  <Th>Status</Th>
                  <Th>Roles</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((member) => (
                  <tr key={member.id}>
                    <Td className="font-medium text-shpe-navy">
                      <Link to={`/admin/members/${member.id}`}>{memberName(member)}</Link>
                    </Td>
                    <Td className="text-gray-700">{member.email}</Td>
                    <Td className="text-gray-700">{member.major ?? "—"}</Td>
                    <Td className="text-gray-700">{member.graduation_year ?? "—"}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[member.membership_status]}>
                        <span className="capitalize">{member.membership_status}</span>
                      </Badge>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {member.roles
                          .filter((r) => r !== "member")
                          .map((r) => (
                            <Badge key={r} tone="brand">
                              <span className="capitalize">{r}</span>
                            </Badge>
                          ))}
                        {member.roles.filter((r) => r !== "member").length === 0 && (
                          <span className="text-gray-500">Member</span>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <ul className="space-y-3 md:hidden">
            {rows.map((member) => (
              <li key={member.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link to={`/admin/members/${member.id}`} className="font-semibold">
                      {memberName(member)}
                    </Link>
                    <Badge tone={STATUS_TONE[member.membership_status]}>
                      <span className="capitalize">{member.membership_status}</span>
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{member.email}</p>
                  <p className="text-sm text-gray-600">
                    {member.major ?? "—"}
                    {member.graduation_year && ` · Class of ${member.graduation_year}`}
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

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { academicYears, activeTerm, fetchTerms } from "@/services/content";
import { queryKeys } from "@/services/queryKeys";
import type { PointsScope } from "@/services/points";
import type { AcademicTermRow } from "@/types/database";

/** Terms change once a semester; there is no reason to refetch them often. */
export function useTerms() {
  return useQuery({
    queryKey: queryKeys.terms.all,
    queryFn: fetchTerms,
    staleTime: 30 * 60_000,
  });
}

export interface ScopeOption {
  id: string;
  label: string;
  scope: PointsScope;
}

/**
 * Builds the Term / Academic year / All time options and holds the selection.
 *
 * Defaults to the active term so the dashboard answers "how am I doing *now*",
 * while every past term stays reachable — a new semester changes the default
 * view, it never hides history.
 */
export function useScopeOptions(terms: AcademicTermRow[] | undefined) {
  const options = useMemo<ScopeOption[]>(() => {
    const list = terms ?? [];
    const termOptions: ScopeOption[] = list.map((term) => ({
      id: `term:${term.id}`,
      label: term.name,
      scope: { kind: "term", termId: term.id },
    }));

    const yearOptions: ScopeOption[] = academicYears(list).map((year) => ({
      id: `year:${year}`,
      label: `${year} academic year`,
      scope: { kind: "academicYear", academicYear: year },
    }));

    return [
      ...termOptions,
      ...yearOptions,
      { id: "all", label: "All time", scope: { kind: "allTime" } },
    ];
  }, [terms]);

  const defaultId = useMemo(() => {
    const active = activeTerm(terms ?? []);
    return active ? `term:${active.id}` : "all";
  }, [terms]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentId = selectedId ?? defaultId;
  const current = options.find((o) => o.id === currentId) ?? options[options.length - 1];

  return {
    options,
    selectedId: currentId,
    setSelectedId,
    scope: current?.scope ?? ({ kind: "allTime" } as PointsScope),
    label: current?.label ?? "All time",
  };
}

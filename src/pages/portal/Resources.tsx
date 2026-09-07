import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ExternalLink } from "lucide-react";

import { Badge, Card, CardBody, Field, Select } from "@/components/ui/primitives";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { fetchVisibleResources } from "@/services/content";
import { queryKeys } from "@/services/queryKeys";
import { usePageMeta } from "@/hooks/usePageMeta";
import { resolveSiteLink } from "@/lib/url";

export function Resources() {
  usePageMeta({ title: "Resources | My SHPE", noindex: true });

  const [category, setCategory] = useState("");

  const resources = useQuery({
    queryKey: queryKeys.resources.visible,
    queryFn: fetchVisibleResources,
  });

  const categories = useMemo(
    () => Array.from(new Set((resources.data ?? []).map((r) => r.category))).sort(),
    [resources.data],
  );

  const rows = (resources.data ?? []).filter((r) => !category || r.category === category);

  return (
    <>
      <PageHeader
        title="Resources"
        description="Templates, guides and chapter documents."
      />

      {categories.length > 1 && (
        <Card className="mb-5">
          <CardBody>
            <Field label="Category">
              {(props) => (
                <Select {...props} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </CardBody>
        </Card>
      )}

      {resources.isPending ? (
        <>
          <SkeletonList rows={4} />
          <span role="status" className="sr-only">
            Loading resources
          </span>
        </>
      ) : resources.isError ? (
        <ErrorState error={resources.error} onRetry={() => void resources.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No resources here yet"
          description="Officers post templates, guides and chapter documents in this section."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((resource) => {
            const link = resolveSiteLink(resource.url ?? resource.file_url);
            return (
              <li key={resource.id}>
                <Card className="h-full p-4 transition-shadow hover:shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-semibold text-shpe-navy">
                      {link ? (
                        <a
                          href={link.href}
                          target={link.external ? "_blank" : undefined}
                          rel={link.external ? "noopener noreferrer" : undefined}
                          className="no-link-style hover:text-shpe-orange-dark"
                        >
                          {resource.title}
                          {link.external && (
                            <>
                              {" "}
                              <ExternalLink className="inline h-3.5 w-3.5" aria-hidden />
                              <span className="sr-only">(opens in a new tab)</span>
                            </>
                          )}
                        </a>
                      ) : (
                        // Unusable target: still show the resource, just not as
                        // a link. Silently dropping the row would hide a
                        // mistake an officer needs to see and correct.
                        <span>{resource.title}</span>
                      )}
                    </h2>
                    {resource.visibility === "officer" && <Badge tone="brand">Officers</Badge>}
                  </div>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {resource.category}
                  </p>
                  {resource.description && (
                    <p className="mt-2 text-sm text-gray-700">{resource.description}</p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

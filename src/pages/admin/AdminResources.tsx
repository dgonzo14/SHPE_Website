import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BookOpen, Plus } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { createResource, fetchAllResources, updateResource } from "@/services/content";
import { queryKeys } from "@/services/queryKeys";
import {
  RESOURCE_CATEGORIES,
  RESOURCE_VISIBILITIES,
  blankToNull,
  resourceSchema,
  type ResourceValues,
} from "@/lib/validation";
import { errorText } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { ResourceRow, ResourceVisibility } from "@/types/database";
import type { BadgeTone } from "@/components/ui/primitives";

const VISIBILITY_TONE: Record<ResourceVisibility, BadgeTone> = {
  public: "info",
  member: "neutral",
  officer: "brand",
};

export function AdminResources() {
  usePageMeta({ title: "Resources | WashU SHPE", noindex: true });

  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ResourceRow | null>(null);
  const [creating, setCreating] = useState(false);

  const resources = useQuery({
    queryKey: queryKeys.resources.all,
    queryFn: fetchAllResources,
  });

  const form = useForm<ResourceValues>({
    resolver: zodResolver(resourceSchema),
    defaultValues: {
      title: "",
      description: "",
      category: RESOURCE_CATEGORIES[0],
      url: "",
      visibility: "member",
      sort_order: 100,
    },
  });

  useEffect(() => {
    if (editing) {
      form.reset({
        title: editing.title,
        description: editing.description ?? "",
        category: editing.category,
        url: editing.url ?? editing.file_url ?? "",
        visibility: editing.visibility,
        sort_order: editing.sort_order,
      });
    } else if (creating) {
      form.reset({
        title: "",
        description: "",
        category: RESOURCE_CATEGORIES[0],
        url: "",
        visibility: "member",
        sort_order: 100,
      });
    }
  }, [editing, creating, form]);

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const save = useMutation({
    mutationFn: async (values: ResourceValues) => {
      if (!user) throw new Error("Not signed in");
      const payload = {
        title: values.title,
        description: blankToNull(values.description),
        category: values.category,
        url: blankToNull(values.url),
        visibility: values.visibility,
        sort_order: values.sort_order,
      };
      return editing ? updateResource(editing.id, payload) : createResource(payload, user.id);
    },
    onSuccess: () => {
      toast.success(editing ? "Resource updated" : "Resource added");
      close();
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
    onError: (error) => toast.error("We couldn't save the resource", errorText(error)),
  });

  const archive = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) =>
      updateResource(input.id, { is_archived: input.archived }),
    onSuccess: (_data, input) => {
      toast.success(input.archived ? "Resource archived" : "Resource restored");
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
    onError: (error) => toast.error("We couldn't update that", errorText(error)),
  });

  const open = creating || editing !== null;

  return (
    <>
      <PageHeader
        title="Resources"
        description="Documents and links, with who can see each one."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New resource
          </Button>
        }
      />

      {resources.isPending ? (
        <SkeletonList rows={4} />
      ) : resources.isError ? (
        <ErrorState error={resources.error} onRetry={() => void resources.refetch()} />
      ) : resources.data.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No resources yet"
          description="Add templates, guides and chapter documents for members."
          action={<Button onClick={() => setCreating(true)}>New resource</Button>}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {resources.data.map((resource) => (
            <li key={resource.id}>
              <Card className="h-full">
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-semibold text-shpe-navy">{resource.title}</h2>
                    <div className="flex flex-wrap gap-1.5">
                      {resource.is_archived && <Badge tone="neutral">Archived</Badge>}
                      <Badge tone={VISIBILITY_TONE[resource.visibility]}>
                        <span className="capitalize">{resource.visibility}</span>
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {resource.category}
                  </p>
                  {resource.description && (
                    <p className="mt-2 text-sm text-gray-700">{resource.description}</p>
                  )}
                  <p className="mt-2 truncate text-xs text-gray-500">
                    {resource.url ?? resource.file_url}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(resource)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        archive.mutate({ id: resource.id, archived: !resource.is_archived })
                      }
                      loading={archive.isPending && archive.variables?.id === resource.id}
                    >
                      {resource.is_archived ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        onClose={close}
        title={editing ? "Edit resource" : "New resource"}
        footer={
          <>
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={form.handleSubmit((values) => save.mutate(values))}
              loading={save.isPending}
            >
              {editing ? "Save changes" : "Add resource"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" noValidate>
          <Field label="Title" required error={form.formState.errors.title?.message}>
            {(props) => <Input {...props} {...form.register("title")} />}
          </Field>

          <Field label="Description" error={form.formState.errors.description?.message}>
            {(props) => <Textarea {...props} {...form.register("description")} rows={3} />}
          </Field>

          <Field
            label="Link"
            required
            hint="A full URL, or a path to a file this site already serves (e.g. /SHPE_Constitution.docx)."
            error={form.formState.errors.url?.message}
          >
            {(props) => <Input {...props} {...form.register("url")} />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required error={form.formState.errors.category?.message}>
              {(props) => (
                <Select {...props} {...form.register("category")}>
                  {RESOURCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Visibility"
              required
              hint="Enforced by the database, not just hidden in the UI."
              error={form.formState.errors.visibility?.message}
            >
              {(props) => (
                <Select {...props} {...form.register("visibility")}>
                  {RESOURCE_VISIBILITIES.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field
            label="Sort order"
            hint="Lower numbers appear first."
            error={form.formState.errors.sort_order?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...form.register("sort_order", { valueAsNumber: true })}
                type="number"
                inputMode="numeric"
              />
            )}
          </Field>

          {save.isError && (
            <Alert tone="danger" title="We couldn't save the resource">
              {errorText(save.error)}
            </Alert>
          )}
        </form>
      </Dialog>
    </>
  );
}

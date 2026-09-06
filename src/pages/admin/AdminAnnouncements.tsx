import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bell, Eye, Plus } from "lucide-react";

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
import {
  createAnnouncement,
  fetchAllAnnouncements,
  updateAnnouncement,
} from "@/services/content";
import { queryKeys } from "@/services/queryKeys";
import {
  ANNOUNCEMENT_PRIORITIES,
  announcementSchema,
  blankToNull,
  type AnnouncementValues,
} from "@/lib/validation";
import { localInputToUtcIso, utcIsoToLocalInput, formatDateTime } from "@/lib/datetime";
import { errorText } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { AnnouncementRow } from "@/types/database";

/** What members actually see right now, computed the same way the RLS policy does. */
function liveState(a: AnnouncementRow): { label: string; tone: "success" | "neutral" | "warning" } {
  if (a.is_archived) return { label: "Archived", tone: "neutral" };
  if (!a.published_at) return { label: "Draft", tone: "neutral" };
  const now = Date.now();
  if (new Date(a.published_at).getTime() > now) return { label: "Scheduled", tone: "warning" };
  if (a.expires_at && new Date(a.expires_at).getTime() <= now) {
    return { label: "Expired", tone: "neutral" };
  }
  return { label: "Live", tone: "success" };
}

export function AdminAnnouncements() {
  usePageMeta({ title: "Announcements | WashU SHPE", noindex: true });

  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AnnouncementRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<AnnouncementValues | null>(null);

  const announcements = useQuery({
    queryKey: queryKeys.announcements.all,
    queryFn: fetchAllAnnouncements,
  });

  const form = useForm<AnnouncementValues>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: "",
      body: "",
      priority: "normal",
      published_at: utcIsoToLocalInput(new Date().toISOString()),
      expires_at: "",
      external_url: "",
    },
  });

  useEffect(() => {
    if (editing) {
      form.reset({
        title: editing.title,
        body: editing.body,
        priority: editing.priority,
        published_at: utcIsoToLocalInput(editing.published_at),
        expires_at: utcIsoToLocalInput(editing.expires_at),
        external_url: editing.external_url ?? "",
      });
    } else if (creating) {
      form.reset({
        title: "",
        body: "",
        priority: "normal",
        published_at: utcIsoToLocalInput(new Date().toISOString()),
        expires_at: "",
        external_url: "",
      });
    }
  }, [editing, creating, form]);

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const save = useMutation({
    mutationFn: async (values: AnnouncementValues) => {
      if (!user) throw new Error("Not signed in");
      const payload = {
        title: values.title,
        body: values.body,
        priority: values.priority,
        published_at: values.published_at ? localInputToUtcIso(values.published_at) : null,
        expires_at: values.expires_at ? localInputToUtcIso(values.expires_at) : null,
        external_url: blankToNull(values.external_url),
      };
      return editing
        ? updateAnnouncement(editing.id, payload)
        : createAnnouncement(payload, user.id);
    },
    onSuccess: () => {
      toast.success(editing ? "Announcement updated" : "Announcement published");
      close();
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
      void queryClient.invalidateQueries({ queryKey: ["member"] });
    },
    onError: (error) => toast.error("We couldn't save the announcement", errorText(error)),
  });

  const archive = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) =>
      updateAnnouncement(input.id, { is_archived: input.archived }),
    onSuccess: (_data, input) => {
      toast.success(input.archived ? "Announcement archived" : "Announcement restored");
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
      void queryClient.invalidateQueries({ queryKey: ["member"] });
    },
    onError: (error) => toast.error("We couldn't update that", errorText(error)),
  });

  const draftTitle = useWatch({ control: form.control, name: "title" });
  const open = creating || editing !== null;

  return (
    <>
      <PageHeader
        title="Announcements"
        description="What members see on their dashboard and announcements page."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New announcement
          </Button>
        }
      />

      {announcements.isPending ? (
        <SkeletonList rows={4} />
      ) : announcements.isError ? (
        <ErrorState error={announcements.error} onRetry={() => void announcements.refetch()} />
      ) : announcements.data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No announcements yet"
          description="Post one to reach every member in the portal."
          action={<Button onClick={() => setCreating(true)}>New announcement</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {announcements.data.map((announcement) => {
            const state = liveState(announcement);
            return (
              <li key={announcement.id}>
                <Card>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="font-semibold text-shpe-navy">{announcement.title}</h2>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={state.tone}>{state.label}</Badge>
                        <Badge
                          tone={
                            announcement.priority === "urgent"
                              ? "danger"
                              : announcement.priority === "important"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          <span className="capitalize">{announcement.priority}</span>
                        </Badge>
                      </div>
                    </div>

                    <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-gray-700">
                      {announcement.body}
                    </p>

                    <p className="mt-2 text-xs text-gray-500">
                      {announcement.published_at
                        ? `Published ${formatDateTime(announcement.published_at)}`
                        : "Not published"}
                      {announcement.expires_at &&
                        ` · Expires ${formatDateTime(announcement.expires_at)}`}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditing(announcement)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          archive.mutate({
                            id: announcement.id,
                            archived: !announcement.is_archived,
                          })
                        }
                        loading={archive.isPending && archive.variables?.id === announcement.id}
                      >
                        {announcement.is_archived ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={open}
        onClose={close}
        title={editing ? "Edit announcement" : "New announcement"}
        size="lg"
        footer={
          <>
            <Button variant="subtle" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => setPreview(form.getValues())}
              disabled={!draftTitle}
            >
              <Eye className="h-4 w-4" aria-hidden />
              Preview
            </Button>
            <Button
              onClick={form.handleSubmit((values) => save.mutate(values))}
              loading={save.isPending}
            >
              {editing ? "Save changes" : "Publish"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" noValidate>
          <Field label="Title" required error={form.formState.errors.title?.message}>
            {(props) => <Input {...props} {...form.register("title")} />}
          </Field>

          <Field label="Message" required error={form.formState.errors.body?.message}>
            {(props) => <Textarea {...props} {...form.register("body")} rows={6} />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority" required error={form.formState.errors.priority?.message}>
              {(props) => (
                <Select {...props} {...form.register("priority")}>
                  {ANNOUNCEMENT_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="External link" error={form.formState.errors.external_url?.message}>
              {(props) => <Input {...props} {...form.register("external_url")} type="url" />}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Publish at"
              hint="Leave blank to keep it as a draft."
              error={form.formState.errors.published_at?.message}
            >
              {(props) => (
                <Input {...props} {...form.register("published_at")} type="datetime-local" />
              )}
            </Field>
            <Field
              label="Expires at"
              hint="Optional. It disappears from members' lists automatically."
              error={form.formState.errors.expires_at?.message}
            >
              {(props) => (
                <Input {...props} {...form.register("expires_at")} type="datetime-local" />
              )}
            </Field>
          </div>

          {save.isError && (
            <Alert tone="danger" title="We couldn't save the announcement">
              {errorText(save.error)}
            </Alert>
          )}
        </form>
      </Dialog>

      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="How members will see it"
        footer={<Button onClick={() => setPreview(null)}>Close</Button>}
      >
        {preview && (
          <Alert
            tone={
              preview.priority === "urgent"
                ? "danger"
                : preview.priority === "important"
                  ? "warning"
                  : "info"
            }
            title={preview.title}
          >
            <p className="whitespace-pre-line">{preview.body}</p>
          </Alert>
        )}
      </Dialog>
    </>
  );
}

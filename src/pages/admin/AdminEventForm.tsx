import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, KeyRound } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button, LinkButton } from "@/components/ui/button";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { ErrorState, FullPageLoader, PageHeader } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import {
  createEvent,
  fetchEvent,
  fetchEventCategories,
  updateEvent,
  type EventWritePayload,
} from "@/services/events";
import { fetchEventCodeStatus, rotateEventCode } from "@/services/admin";
import { queryKeys } from "@/services/queryKeys";
import {
  EVENT_STATUSES,
  blankToNull,
  eventSchema,
  type EventValues,
} from "@/lib/validation";
import { localInputToUtcIso, utcIsoToLocalInput, TIMEZONE_LABEL } from "@/lib/datetime";
import { errorText } from "@/lib/errors";
import { usePageMeta } from "@/hooks/usePageMeta";

/** datetime-local for "now, rounded up to the next half hour", in chapter time. */
function defaultStart(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0);
  return utcIsoToLocalInput(d.toISOString());
}

function addHours(localValue: string, hours: number): string {
  const iso = localInputToUtcIso(localValue);
  if (!iso) return localValue;
  return utcIsoToLocalInput(new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString());
}

export function AdminEventForm() {
  const { eventId } = useParams();
  const isEdit = Boolean(eventId);
  usePageMeta({
    title: isEdit ? "Edit Event | WashU SHPE" : "New Event | WashU SHPE",
    noindex: true,
  });

  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const categories = useQuery({
    queryKey: queryKeys.eventCategories,
    queryFn: fetchEventCategories,
    staleTime: 30 * 60_000,
  });

  const existing = useQuery({
    queryKey: queryKeys.events.detail(eventId ?? ""),
    queryFn: () => fetchEvent(eventId as string),
    enabled: isEdit,
  });

  const codeStatus = useQuery({
    queryKey: queryKeys.events.codeStatus(eventId ?? ""),
    queryFn: () => fetchEventCodeStatus(eventId as string),
    enabled: isEdit,
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EventValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: "",
      description: "",
      category_id: "",
      location: "",
      start_at: defaultStart(),
      end_at: addHours(defaultStart(), 1),
      check_in_opens_at: "",
      check_in_closes_at: "",
      points_value: 10,
      capacity: undefined,
      status: "draft",
      organizer_name: "",
      organizer_email: "",
      image_url: "",
    },
  });

  useEffect(() => {
    const event = existing.data;
    if (!event) return;
    reset({
      title: event.title,
      description: event.description ?? "",
      category_id: event.category_id ?? "",
      location: event.location ?? "",
      start_at: utcIsoToLocalInput(event.start_at),
      end_at: utcIsoToLocalInput(event.end_at),
      check_in_opens_at: utcIsoToLocalInput(event.check_in_opens_at),
      check_in_closes_at: utcIsoToLocalInput(event.check_in_closes_at),
      points_value: event.points_value,
      capacity: event.capacity ?? undefined,
      status: event.status,
      organizer_name: event.organizer_name ?? "",
      organizer_email: event.organizer_email ?? "",
      image_url: event.image_url ?? "",
    });
  }, [existing.data, reset]);

  const startAt = useWatch({ control, name: "start_at" });

  const toPayload = (values: EventValues): EventWritePayload => ({
    title: values.title,
    description: blankToNull(values.description),
    category_id: values.category_id,
    // The form collects chapter-local wall-clock time; the database stores
    // instants. This is the only place that conversion happens.
    start_at: localInputToUtcIso(values.start_at) ?? values.start_at,
    end_at: localInputToUtcIso(values.end_at) ?? values.end_at,
    // Left blank, a database trigger fills the window (30 minutes either side),
    // so both the UI and the check-in RPC read the same stored values.
    check_in_opens_at: values.check_in_opens_at
      ? localInputToUtcIso(values.check_in_opens_at)
      : null,
    check_in_closes_at: values.check_in_closes_at
      ? localInputToUtcIso(values.check_in_closes_at)
      : null,
    location: blankToNull(values.location),
    points_value: values.points_value,
    capacity: values.capacity ?? null,
    status: values.status,
    organizer_name: blankToNull(values.organizer_name),
    organizer_email: blankToNull(values.organizer_email),
    image_url: blankToNull(values.image_url),
  });

  const save = useMutation({
    mutationFn: async (values: EventValues) => {
      if (!user) throw new Error("Not signed in");
      const payload = toPayload(values);
      return isEdit
        ? updateEvent(eventId as string, payload)
        : createEvent(payload, user.id);
    },
    onSuccess: (event) => {
      toast.success(isEdit ? "Event updated" : "Event created");
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      if (!isEdit) navigate(`/admin/events/${event.id}`, { replace: true });
    },
    onError: (error) => toast.error("We couldn't save the event", errorText(error)),
  });

  const rotate = useMutation({
    mutationFn: () => rotateEventCode(eventId as string),
    onSuccess: (code) => {
      setIssuedCode(code);
      setConfirmRotate(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.events.codeStatus(eventId ?? "") });
    },
    onError: (error) => {
      setConfirmRotate(false);
      toast.error("We couldn't generate a code", errorText(error));
    },
  });

  if (isEdit && existing.isPending) return <FullPageLoader label="Loading event" />;
  if (isEdit && existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  const hasCode = codeStatus.data?.has_code ?? false;

  return (
    <>
      <Link
        to="/admin/events"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 no-link-style hover:text-shpe-navy"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All events
      </Link>

      <PageHeader
        title={isEdit ? "Edit event" : "New event"}
        description={`All times are ${TIMEZONE_LABEL} (America/Chicago).`}
        actions={
          isEdit ? (
            <LinkButton to={`/admin/attendance/${eventId}`} variant="outline">
              View attendance
            </LinkButton>
          ) : undefined
        }
      />

      <form onSubmit={handleSubmit((values) => save.mutate(values))} noValidate>
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <Field label="Title" required error={errors.title?.message}>
                  {(props) => <Input {...props} {...register("title")} />}
                </Field>

                <Field label="Category" required error={errors.category_id?.message}>
                  {(props) => (
                    <Select {...props} {...register("category_id")}>
                      <option value="">Choose a category</option>
                      {(categories.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Description" error={errors.description?.message}>
                  {(props) => <Textarea {...props} {...register("description")} rows={5} />}
                </Field>

                <Field label="Location" error={errors.location?.message}>
                  {(props) => (
                    <Input {...props} {...register("location")} placeholder="Lopata Hall 101" />
                  )}
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>When</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Starts" required error={errors.start_at?.message}>
                    {(props) => (
                      <Input
                        {...props}
                        {...register("start_at")}
                        type="datetime-local"
                        onBlur={(e) => {
                          // Nudge the end time along with the start so the
                          // "ends after it starts" rule is rarely violated.
                          const end = getValues("end_at");
                          if (e.target.value && (!end || end <= e.target.value)) {
                            setValue("end_at", addHours(e.target.value, 1), {
                              shouldValidate: true,
                            });
                          }
                        }}
                      />
                    )}
                  </Field>
                  <Field label="Ends" required error={errors.end_at?.message}>
                    {(props) => <Input {...props} {...register("end_at")} type="datetime-local" />}
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Check-in opens"
                    hint="Leave blank for 30 minutes before the start."
                    error={errors.check_in_opens_at?.message}
                  >
                    {(props) => (
                      <Input {...props} {...register("check_in_opens_at")} type="datetime-local" />
                    )}
                  </Field>
                  <Field
                    label="Check-in closes"
                    hint="Leave blank for 30 minutes after the end."
                    error={errors.check_in_closes_at?.message}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        {...register("check_in_closes_at")}
                        type="datetime-local"
                      />
                    )}
                  </Field>
                </div>

                {startAt && (
                  <p className="text-xs text-gray-500">
                    Members can only check in inside this window — the database enforces it, so a
                    stale browser tab can't check anyone in late.
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Publishing</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <Field
                  label="Status"
                  required
                  hint="Drafts are invisible to members."
                  error={errors.status?.message}
                >
                  {(props) => (
                    <Select {...props} {...register("status")}>
                      {EVENT_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field
                  label="Points"
                  required
                  hint="Set per event — categories don't imply a value."
                  error={errors.points_value?.message}
                >
                  {(props) => (
                    <Input
                      {...props}
                      {...register("points_value", { valueAsNumber: true })}
                      type="number"
                      inputMode="numeric"
                      min={0}
                    />
                  )}
                </Field>

                <Field label="Capacity" hint="Optional" error={errors.capacity?.message}>
                  {(props) => (
                    <Input
                      {...props}
                      {...register("capacity", {
                        setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                      })}
                      type="number"
                      inputMode="numeric"
                      min={1}
                    />
                  )}
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Organiser</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <Field label="Name" error={errors.organizer_name?.message}>
                  {(props) => <Input {...props} {...register("organizer_name")} />}
                </Field>
                <Field label="Email" error={errors.organizer_email?.message}>
                  {(props) => <Input {...props} {...register("organizer_email")} type="email" />}
                </Field>
                <Field label="Image URL" hint="Optional" error={errors.image_url?.message}>
                  {(props) => <Input {...props} {...register("image_url")} type="url" />}
                </Field>
              </CardBody>
            </Card>

            {isEdit && (
              <Card>
                <CardHeader>
                  <CardTitle>Check-in code</CardTitle>
                </CardHeader>
                <CardBody className="space-y-3">
                  <p className="text-sm text-gray-600">
                    {hasCode
                      ? "This event has a live code. Only its hash is stored, so it can't be shown again — rotating issues a new one and invalidates the old."
                      : "Generate a code for members to enter at the event."}
                  </p>
                  <Button
                    variant={hasCode ? "outline" : "primary"}
                    block
                    onClick={() => (hasCode ? setConfirmRotate(true) : rotate.mutate())}
                    loading={rotate.isPending}
                  >
                    <KeyRound className="h-4 w-4" aria-hidden />
                    {hasCode ? "Rotate code" : "Generate code"}
                  </Button>
                </CardBody>
              </Card>
            )}
          </div>
        </div>

        {save.isError && (
          <Alert tone="danger" title="We couldn't save the event" className="mt-5">
            {errorText(save.error)}
          </Alert>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="submit" size="lg" loading={isSubmitting || save.isPending}>
            {isEdit ? "Save changes" : "Create event"}
          </Button>
          <LinkButton to="/admin/events" variant="subtle" size="lg">
            Cancel
          </LinkButton>
        </div>
      </form>

      <ConfirmDialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={() => rotate.mutate()}
        loading={rotate.isPending}
        title="Rotate the check-in code?"
        description="The current code stops working immediately. Anyone still holding it — including members already at the event — will need the new one."
        confirmLabel="Rotate code"
      />

      <Dialog
        open={issuedCode !== null}
        onClose={() => setIssuedCode(null)}
        title="Check-in code"
        size="sm"
        footer={<Button onClick={() => setIssuedCode(null)}>Done</Button>}
      >
        <p
          className="rounded-lg bg-shpe-navy-soft py-6 text-center text-3xl font-bold tracking-[0.2em] text-shpe-navy"
          aria-live="polite"
        >
          {issuedCode}
        </p>
        <Alert tone="warning" className="mt-4">
          Write this down or project it now — this is the only time it can be displayed.
        </Alert>
      </Dialog>
    </>
  );
}

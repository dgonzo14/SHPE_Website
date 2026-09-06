import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Select,
} from "@/components/ui/primitives";
import { ErrorState, PageHeader, StatCard } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { updateOwnProfile } from "@/services/members";
import { fetchPointsSummary, scopeKey } from "@/services/points";
import { queryKeys } from "@/services/queryKeys";
import { activeTerm } from "@/services/content";
import { useTerms } from "@/hooks/useTerms";
import {
  DEGREE_LEVELS,
  blankToNull,
  profileSchema,
  type ProfileValues,
} from "@/lib/validation";
import { errorText } from "@/lib/errors";
import { formatDate } from "@/lib/datetime";
import { usePageMeta } from "@/hooks/usePageMeta";
import type { PointsScope } from "@/services/points";

export function Profile() {
  usePageMeta({ title: "Profile | My SHPE", noindex: true });

  const { user, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const terms = useTerms();

  const term = activeTerm(terms.data ?? []);
  const scope: PointsScope = term ? { kind: "term", termId: term.id } : { kind: "allTime" };

  const summary = useQuery({
    queryKey: queryKeys.member.points(user?.id ?? "", scopeKey(scope)),
    enabled: Boolean(user?.id) && terms.isSuccess,
    queryFn: () => fetchPointsSummary(null, scope),
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      major: "",
      secondary_major: "",
      graduation_year: undefined,
      degree_level: undefined,
      linkedin_url: "",
      shpe_national_member: false,
      shpe_national_member_id: "",
    },
  });

  // The profile arrives after first render, so seed the form once it lands.
  useEffect(() => {
    if (!profile) return;
    reset({
      first_name: profile.first_name,
      last_name: profile.last_name,
      major: profile.major ?? "",
      secondary_major: profile.secondary_major ?? "",
      graduation_year: profile.graduation_year ?? undefined,
      degree_level: profile.degree_level ?? undefined,
      linkedin_url: profile.linkedin_url ?? "",
      shpe_national_member: profile.shpe_national_member !== "not_provided",
      shpe_national_member_id: profile.shpe_national_member_id ?? "",
    });
  }, [profile, reset]);

  const claimsNational = useWatch({ control, name: "shpe_national_member" });

  const save = useMutation({
    mutationFn: async (values: ProfileValues) => {
      if (!user) throw new Error("Not signed in");
      return updateOwnProfile(user.id, {
        first_name: values.first_name,
        last_name: values.last_name,
        major: blankToNull(values.major),
        secondary_major: blankToNull(values.secondary_major),
        graduation_year: values.graduation_year ?? null,
        degree_level: values.degree_level ?? null,
        linkedin_url: blankToNull(values.linkedin_url),
        // A member can say they hold a National membership; only an officer can
        // confirm it. The database downgrades any attempt to write "verified".
        shpe_national_member: values.shpe_national_member
          ? profile?.shpe_national_member === "verified"
            ? "verified"
            : "self_reported"
          : "not_provided",
        shpe_national_member_id: blankToNull(values.shpe_national_member_id),
      });
    },
    onSuccess: async () => {
      toast.success("Profile updated");
      await refreshProfile();
      void queryClient.invalidateQueries({ queryKey: ["member"] });
    },
    onError: (error) => {
      toast.error("We couldn't save your profile", errorText(error));
    },
  });

  const onSubmit = handleSubmit((values) => save.mutate(values));

  if (!profile) {
    return (
      <>
        <PageHeader title="Profile" />
        <ErrorState
          error={new Error("profile unavailable")}
          fallback="We couldn't load your profile"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Your profile" description="Keep your details up to date." />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Points"
          value={summary.data?.total_points ?? "—"}
          hint={term?.name ?? "All time"}
          tone="orange"
        />
        <StatCard
          label="Events attended"
          value={summary.data?.events_attended ?? "—"}
          hint={term?.name ?? "All time"}
          tone="blue"
        />
        <StatCard
          label="Engagement"
          value={summary.data?.top_percent ? `Top ${summary.data.top_percent}%` : "—"}
          hint={summary.data?.top_percent ? "Among ranked members" : "Not enough data yet"}
          tone="navy"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" required error={errors.first_name?.message}>
                {(props) => <Input {...props} {...register("first_name")} />}
              </Field>
              <Field label="Last name" required error={errors.last_name?.message}>
                {(props) => <Input {...props} {...register("last_name")} />}
              </Field>
            </div>

            {/*
              Email, membership status and member-since are shown but not
              editable: they are set by Auth and by officers, and the database
              restores them on any attempt to change them here.
            */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" hint="Managed by your account — contact an officer to change it.">
                {(props) => <Input {...props} value={profile.email} readOnly disabled />}
              </Field>
              <Field label="Member since">
                {(props) => (
                  <Input {...props} value={formatDate(profile.member_since)} readOnly disabled />
                )}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Major" error={errors.major?.message}>
                {(props) => <Input {...props} {...register("major")} />}
              </Field>
              <Field label="Second major or minor" error={errors.secondary_major?.message}>
                {(props) => <Input {...props} {...register("secondary_major")} />}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Graduation year" error={errors.graduation_year?.message}>
                {(props) => (
                  <Input
                    {...props}
                    {...register("graduation_year", {
                      setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                    })}
                    type="number"
                    inputMode="numeric"
                  />
                )}
              </Field>
              <Field label="Degree level" error={errors.degree_level?.message}>
                {(props) => (
                  <Select
                    {...props}
                    {...register("degree_level", {
                      setValueAs: (v) => (v === "" ? undefined : v),
                    })}
                  >
                    <option value="">Not specified</option>
                    {DEGREE_LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Field label="LinkedIn" error={errors.linkedin_url?.message}>
              {(props) => (
                <Input
                  {...props}
                  {...register("linkedin_url")}
                  type="url"
                  placeholder="https://linkedin.com/in/…"
                />
              )}
            </Field>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <Checkbox
                {...register("shpe_national_member")}
                label="I'm a SHPE National member"
                description={
                  profile.shpe_national_member === "verified"
                    ? "An officer has verified this."
                    : "An officer confirms this against the National roster."
                }
              />
              {claimsNational && (
                <div className="mt-3">
                  <Field
                    label="SHPE National member ID"
                    error={errors.shpe_national_member_id?.message}
                  >
                    {(props) => <Input {...props} {...register("shpe_national_member_id")} />}
                  </Field>
                </div>
              )}
            </div>

            {save.isError && (
              <Alert tone="danger" title="We couldn't save your profile">
                {errorText(save.error)}
              </Alert>
            )}

            <div className="flex gap-2">
              <Button type="submit" loading={isSubmitting || save.isPending} disabled={!isDirty}>
                Save changes
              </Button>
              {isDirty && (
                <Button variant="subtle" onClick={() => reset()} disabled={save.isPending}>
                  Discard
                </Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

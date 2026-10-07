import { useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Controller, useWatch, type UseFormReturn } from "react-hook-form";
import { EyeOff, UserRoundPen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/primitives";
import { formatDate } from "@/lib/datetime";
import type { CardFormValues } from "@/lib/validation";
import type { CardProfileFields } from "@/types/database";
import { ImageField } from "../ImageField";
import { AVATAR_SPEC, BANNER_SPEC } from "../imageUpload";
import { CARD_LIMITS, CARD_SECTION_LABELS, type CardSectionId } from "../model";
import { resolveTheme } from "../themes";
import { themeShowsPhoto } from "../photoVisibility";
import { arrayErrorMessage, profileDisplayName } from "./editorUtils";
import { HandleField } from "./HandleField";
import { TagInput } from "./TagInput";

export interface ContentTabProps {
  form: UseFormReturn<CardFormValues>;
  memberId: string;
  profile: CardProfileFields;
  /** The officer-assigned chapter position, if any. */
  position: string | null;
  /** The handle the card is saved with; null before the first save. */
  savedHandle: string | null;
  /** The handle on the member's NFC chip, if one was recorded. */
  chipHandle: string | null;
  /** false when an officer removed the chip's handle from the card, so the chip no longer opens it. */
  chipHandleActive?: boolean | null;
}

function EditorSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4 border-t border-shpe-rule pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-semibold text-shpe-navy">
            {title}
          </h3>
          {description && <p className="mt-1 max-w-[65ch] text-sm text-gray-600">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "123 / 600", for fields long enough that the limit matters. */
function withCount(text: string, length: number, max: number): ReactNode {
  return (
    <span className="flex justify-between gap-3">
      <span>{text}</span>
      <span className="shrink-0 tabular-nums">
        <span aria-hidden="true">
          {length}/{max}
        </span>
        <span className="sr-only">
          {length} of {max} characters used
        </span>
      </span>
    </span>
  );
}

/** The field each hidden-block note on this tab sits under. */
const SECTION_FIELDS: Partial<Record<CardSectionId, keyof CardFormValues>> = {
  status: "status_line",
  about: "bio",
  skills: "skills",
  languages: "languages",
};

/**
 * A block the member has filled in but hidden on the Design tab would quietly
 * not appear. Skills and Languages start hidden, so this matters most there.
 */
function HiddenBlockNote({
  section,
  hasContent,
  sections,
  onShow,
}: {
  section: CardSectionId;
  hasContent: boolean;
  sections: CardSectionId[];
  onShow: (section: CardSectionId) => void;
}) {
  if (!hasContent || sections.includes(section)) return null;
  const label = CARD_SECTION_LABELS[section];
  return (
    <div className="flex flex-col gap-2 border-l-4 border-l-shpe-gold bg-shpe-gold-soft p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Your {label} block is turned off, so this won't show on your card.
        </span>
      </p>
      <Button
        variant="subtle"
        size="sm"
        className="min-h-[44px] shrink-0"
        onClick={() => onShow(section)}
      >
        Show {label} on my card
      </Button>
    </div>
  );
}

/**
 * Content: who the card says the member is. Handle, name and headline, a
 * photo and banner, skills and languages, which profile facts to show, and
 * whether search engines may list the card.
 *
 * Profile facts (major, class year, position, National membership) are never
 * typed here. They're read live from the profile and the officers' records,
 * so they can't drift or be self-claimed; this tab only chooses which appear.
 */
export function ContentTab({
  form,
  memberId,
  profile,
  position,
  savedHandle,
  chipHandle,
  chipHandleActive = null,
}: ContentTabProps) {
  const {
    control,
    register,
    setValue,
    formState: { errors },
  } = form;

  const [bio, statusLine, skills, languages, theme, sections] = useWatch({
    control,
    name: ["bio", "status_line", "skills", "languages", "theme", "sections"],
  });
  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const [announcement, setAnnouncement] = useState("");

  const profileName = profileDisplayName(profile);
  const startFromProfileHintId = useId();

  const startFromProfile = () => {
    setValue("display_name", profileName, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setAnnouncement(`Name filled in from your profile: ${profileName}.`);
  };

  const showSection = (section: CardSectionId) => {
    setValue("sections", [...sections, section], { shouldDirty: true });
    setAnnouncement(`${CARD_SECTION_LABELS[section]} will now show on your card.`);
    // The note and its button go away once the block is shown. Focus moves
    // to the field the note was about (setFocus waits a tick, by which time
    // the note is gone), rather than dropping to the page body.
    const field = SECTION_FIELDS[section];
    if (field) form.setFocus(field);
  };

  // The same rule the card, the contact file and link previews use.
  const photoHidden = !themeShowsPhoto(resolved);
  const bannerHidden = resolved.layout !== "banner";
  const majors = [profile.major, profile.secondary_major].filter(Boolean).join(" and ");

  return (
    <div className="space-y-8">
      <EditorSection
        title="Your address"
        description="People reach your card at this address, and it's what gets written to your NFC card."
      >
        <HandleField
          control={control}
          savedHandle={savedHandle}
          chipHandle={chipHandle}
          chipHandleActive={chipHandleActive}
        />
      </EditorSection>

      <EditorSection
        title="Name and headline"
        action={
          <div className="shrink-0 sm:text-right">
            <Button
              variant="subtle"
              onClick={startFromProfile}
              disabled={!profileName}
              aria-describedby={startFromProfileHintId}
            >
              <UserRoundPen className="h-4 w-4" aria-hidden="true" />
              Start from my profile
            </Button>
            <p id={startFromProfileHintId} className="mt-1 text-xs text-gray-500">
              {profileName ? "Fills in your name. Nothing else changes." : "Add your name on your profile first."}
            </p>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field label="Name on your card" required error={errors.display_name?.message}>
            {(props) => (
              <Input
                {...props}
                {...register("display_name")}
                maxLength={CARD_LIMITS.displayName}
                autoComplete="name"
              />
            )}
          </Field>
          <Field label="Pronouns" error={errors.pronouns?.message}>
            {(props) => (
              <Input
                {...props}
                {...register("pronouns")}
                maxLength={CARD_LIMITS.pronouns}
                placeholder="she/her"
                autoComplete="off"
              />
            )}
          </Field>
        </div>

        <Field
          label="Headline"
          hint="One short line under your name."
          error={errors.headline?.message}
        >
          {(props) => (
            <Input
              {...props}
              {...register("headline")}
              maxLength={CARD_LIMITS.headline}
              placeholder="Mechanical engineering student · Intern at Boeing"
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="School or organization"
            hint="Shown with your name."
            error={errors.organization?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...register("organization")}
                maxLength={CARD_LIMITS.organization}
                autoComplete="organization"
              />
            )}
          </Field>
          <Field label="Location" error={errors.location?.message}>
            {(props) => (
              <Input
                {...props}
                {...register("location")}
                maxLength={CARD_LIMITS.location}
                placeholder="St. Louis, MO"
              />
            )}
          </Field>
        </div>

        <Field
          label="Currently"
          hint="What you're up to or looking for right now. It's easy to keep current."
          error={errors.status_line?.message}
        >
          {(props) => (
            <Input
              {...props}
              {...register("status_line")}
              maxLength={CARD_LIMITS.statusLine}
              placeholder="Looking for Summer 2027 internships"
            />
          )}
        </Field>
        <HiddenBlockNote
          section="status"
          hasContent={statusLine.trim() !== ""}
          sections={sections}
          onShow={showSection}
        />
      </EditorSection>

      <EditorSection title="About">
        <Field
          label="Bio"
          hint={withCount(
            "Plain text. Line breaks are kept.",
            bio.length,
            CARD_LIMITS.bio,
          )}
          error={errors.bio?.message}
        >
          {(props) => (
            <Textarea
              {...props}
              {...register("bio")}
              maxLength={CARD_LIMITS.bio}
              rows={5}
              placeholder="A few sentences about what you study, build or care about."
            />
          )}
        </Field>
        <HiddenBlockNote
          section="about"
          hasContent={bio.trim() !== ""}
          sections={sections}
          onShow={showSection}
        />
      </EditorSection>

      <EditorSection
        title="Photo and banner"
        description="Images are cropped and shrunk in your browser before they upload, which also removes location data from phone photos."
      >
        <Controller
          control={control}
          name="avatar_path"
          render={({ field }) => (
            <ImageField
              label="Photo"
              hint={
                photoHidden
                  ? "Your current design doesn't show a photo. Change the layout or photo shape on the Design tab to show it."
                  : "A clear, square photo of you works best."
              }
              spec={AVATAR_SPEC}
              shape="circle"
              value={field.value}
              onChange={field.onChange}
              memberId={memberId}
            />
          )}
        />
        <Controller
          control={control}
          name="banner_path"
          render={({ field }) => (
            <ImageField
              label="Banner"
              hint={
                bannerHidden
                  ? "A wide image across the top of your card. It shows with the Banner layout, which you can choose on the Design tab."
                  : "A wide image across the top of your card."
              }
              spec={BANNER_SPEC}
              shape="rect"
              value={field.value}
              onChange={field.onChange}
              memberId={memberId}
            />
          )}
        />
      </EditorSection>

      <EditorSection title="Skills and languages">
        <Controller
          control={control}
          name="skills"
          render={({ field }) => (
            <TagInput
              label="Skills"
              hint="Press Enter or type a comma after each one."
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              maxItems={CARD_LIMITS.skills}
              maxLength={CARD_LIMITS.skillLength}
              noun="skill"
              placeholder="Python, SolidWorks, CAD"
              error={arrayErrorMessage(errors.skills)}
            />
          )}
        />
        <HiddenBlockNote
          section="skills"
          hasContent={skills.length > 0}
          sections={sections}
          onShow={showSection}
        />
        <Controller
          control={control}
          name="languages"
          render={({ field }) => (
            <TagInput
              label="Languages"
              hint="The languages you speak. Press Enter or type a comma after each one."
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              maxItems={CARD_LIMITS.languages}
              maxLength={CARD_LIMITS.languageLength}
              noun="language"
              placeholder="English, Español"
              error={arrayErrorMessage(errors.languages)}
            />
          )}
        />
        <HiddenBlockNote
          section="languages"
          hasContent={languages.length > 0}
          sections={sections}
          onShow={showSection}
        />
      </EditorSection>

      <EditorSection
        title="From your profile"
        description="These come from your profile and the chapter's records, and stay up to date on their own. Choose which ones your card shows."
      >
        <div className="space-y-4">
          <Checkbox
            {...register("show_major")}
            label="Show my major"
            description={majors ? `${majors}.` : "Your profile doesn't list a major yet."}
          />
          <Checkbox
            {...register("show_graduation_year")}
            label="Show my class year"
            description={
              profile.graduation_year
                ? `Class of ${profile.graduation_year}.`
                : "Your profile doesn't list a class year yet."
            }
          />
          <Checkbox
            {...register("show_member_since")}
            label="Show when I joined WashU SHPE"
            description={`Member since ${formatDate(profile.member_since)}.`}
          />
          <Checkbox
            {...register("show_national_member")}
            label="Show my SHPE National membership"
            description={
              profile.national_member_verified
                ? "An officer has verified your National membership, so your card shows a verified badge."
                : "This only appears once an officer verifies your National membership. Until then nothing shows, even with this on."
            }
          />
          <Checkbox
            {...register("show_chapter_position")}
            label="Show my chapter position"
            description={
              position
                ? `“${position}”, assigned by an officer. It shows with a verified check.`
                : "You don't have a chapter position. Officers assign these, so nobody can claim one on their own card."
            }
          />
        </div>
        <p className="text-sm text-gray-600">
          Something out of date?{" "}
          <Link to="/portal/profile" className="font-medium text-shpe-navy underline underline-offset-2">
            Update your profile
          </Link>
          . Changes there show on your card straight away.
        </p>
      </EditorSection>

      <EditorSection title="Search engines">
        <Checkbox
          {...register("allow_indexing")}
          label="Let search engines find my card"
          description="Off unless you turn it on. With it on, Google and other search engines may list your card and anything on it, like an email address or phone number. Anyone with your link or NFC card can see your card either way."
        />
      </EditorSection>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

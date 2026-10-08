import { useEffect, useId, useRef, useState, type Ref } from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type FieldError,
  type UseFormRegister,
  type UseFormReturn,
  type UseFormSetValue,
} from "react-hook-form";
import { AlertCircle, ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge, Checkbox, Field, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { CardFormValues, CardLinkFormValues } from "@/lib/validation";
import { CARD_LIMITS, CARD_LINK_KINDS, type CardLinkKind } from "../model";
import { LINK_KINDS, linkDisplayLabel } from "../linkKinds";
import { LinkKindIcon } from "../blocks/LinkKindIcon";

/** Said plainly, next to the two fields that put personal contact details on a public page. */
const PUBLIC_WARNINGS: Partial<Record<CardLinkKind, string>> = {
  email:
    "Everything on your card is public. Anyone who taps your NFC card or opens your link can see this address. It's separate from your account email, which stays private.",
  phone:
    "Everything on your card is public. Anyone who taps your NFC card or opens your link can see this number, so only add one you're comfortable sharing with strangers.",
};

function valueLabel(kind: CardLinkKind): string {
  if (kind === "email") return "Email address";
  if (kind === "phone") return "Phone number";
  if (kind === "custom") return "Web address";
  return `${LINK_KINDS[kind].label} link`;
}

function linkTitle(link: Pick<CardLinkFormValues, "kind" | "label"> | undefined): string {
  if (!link) return "Link";
  return linkDisplayLabel({ kind: link.kind, label: link.label || null });
}

const BLANK_LINK: Omit<CardLinkFormValues, "kind"> = {
  id: null,
  label: "",
  value: "",
  is_featured: false,
  is_visible: true,
};

type LinkErrors = Partial<Record<keyof CardLinkFormValues, FieldError>> | undefined;

/**
 * Links: the buttons on the card, in order.
 *
 * Add from a picker of the sixteen kinds; each kind brings its own input hints
 * and keyboard, and tidies what was typed when the field is left (a LinkedIn
 * username becomes the full profile link). Reordering is up/down buttons
 * rather than drag and drop, so it works the same with a keyboard, a screen
 * reader or a thumb. Featuring a link un-features the others, so there's only
 * ever one.
 *
 * Moving and removing keep focus somewhere sensible and say what happened.
 * Move buttons at the ends are aria-disabled rather than disabled, so the
 * button just pressed keeps focus instead of dropping it to the page.
 */
export function LinksTab({ form }: { form: UseFormReturn<CardFormValues> }) {
  const {
    control,
    register,
    setValue,
    getValues,
    formState: { errors },
  } = form;
  const { fields, append, move, remove } = useFieldArray({
    control,
    name: "links",
    // Our links have their own `id` (the database row), so the field array's
    // generated key needs a different name.
    keyName: "fieldKey",
  });
  const sections = useWatch({ control, name: "sections" });

  const pickerId = useId();
  const [pickerOpen, setPickerOpen] = useState(fields.length === 0);
  const [announcement, setAnnouncement] = useState("");
  const headingRefs = useRef(new Map<string, HTMLHeadingElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the list re-renders after a removal. */
  const pendingFocus = useRef<number | "add" | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "add") {
      addButtonRef.current?.focus();
      return;
    }
    const key = fields[target]?.fieldKey;
    if (key) headingRefs.current.get(key)?.focus();
  }, [fields]);

  const atLimit = fields.length >= CARD_LIMITS.links;
  const featuredBlockHidden = !sections.includes("featured");

  const addLink = (kind: CardLinkKind) => {
    if (atLimit) return;
    append({ ...BLANK_LINK, kind }, { focusName: `links.${fields.length}.value` });
    setPickerOpen(false);
    setAnnouncement(`Added a ${LINK_KINDS[kind].label} link.`);
  };

  const moveLink = (from: number, to: number) => {
    if (to < 0 || to >= fields.length) return;
    const title = linkTitle(getValues(`links.${from}`));
    move(from, to);
    setAnnouncement(`${title} moved to position ${to + 1} of ${fields.length}.`);
  };

  const removeLink = (index: number) => {
    const title = linkTitle(getValues(`links.${index}`));
    const remaining = fields.length - 1;
    remove(index);
    pendingFocus.current = remaining === 0 ? "add" : Math.min(index, remaining - 1);
    setAnnouncement(`${title} removed. Save to make it permanent, or Discard to bring it back.`);
  };

  const setFeatured = (index: number, featured: boolean) => {
    const links = getValues("links");
    links.forEach((link, i) => {
      const next = i === index ? featured : false;
      if (link.is_featured !== next) {
        setValue(`links.${i}.is_featured`, next, { shouldDirty: true });
      }
    });
    const title = linkTitle(links[index]);
    setAnnouncement(featured ? `${title} is now your featured link.` : `${title} is no longer featured.`);
  };

  const rootError = errors.links?.root?.message ?? errors.links?.message;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-shpe-navy">Your links</h3>
        <p className="max-w-[65ch] text-sm text-gray-600">
          They show on your card in this order. Use the arrows to move them, and hide one to keep
          it without showing it.{" "}
          <span className="font-medium text-shpe-navy">
            {fields.length} of {CARD_LIMITS.links}
          </span>
        </p>
      </div>

      {rootError && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{rootError}</span>
        </p>
      )}

      {fields.length > 0 && (
        <ol className="space-y-4" aria-label="Links on your card">
          {fields.map((field, index) => (
            <LinkRow
              key={field.fieldKey}
              index={index}
              total={fields.length}
              control={control}
              register={register}
              setValue={setValue}
              errors={errors.links?.[index] as LinkErrors}
              featuredBlockHidden={featuredBlockHidden}
              headingRef={(node) => {
                if (node) headingRefs.current.set(field.fieldKey, node);
                else headingRefs.current.delete(field.fieldKey);
              }}
              onMove={moveLink}
              onRemove={removeLink}
              onFeature={setFeatured}
            />
          ))}
        </ol>
      )}

      <div className="space-y-3">
        <Button
          {...{ ref: addButtonRef }}
          variant={fields.length === 0 ? "primary" : "outline"}
          onClick={() => setPickerOpen((open) => !open)}
          aria-expanded={pickerOpen && !atLimit}
          aria-controls={pickerId}
          disabled={atLimit}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add a link
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", pickerOpen && !atLimit && "rotate-180")}
            aria-hidden="true"
          />
        </Button>
        {atLimit && (
          <p className="text-sm text-gray-600">
            That's the most a card can hold ({CARD_LIMITS.links} links). Remove one to add another.
          </p>
        )}

        <div id={pickerId} hidden={!pickerOpen || atLimit}>
          <p className="mb-2 text-sm text-gray-600" id={`${pickerId}-label`}>
            What kind of link?
          </p>
          <ul
            aria-labelledby={`${pickerId}-label`}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
          >
            {CARD_LINK_KINDS.map((kind) => (
              <li key={kind}>
                <button
                  type="button"
                  onClick={() => addLink(kind)}
                  aria-label={`Add ${LINK_KINDS[kind].label}`}
                  className="flex min-h-[44px] w-full items-center gap-2 border border-shpe-rule-strong bg-white px-3 py-2 text-left text-sm font-medium text-shpe-navy transition-colors hover:border-shpe-navy hover:bg-shpe-navy-soft focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
                >
                  <LinkKindIcon kind={kind} className="h-5 w-5 shrink-0" />
                  <span className="min-w-0">{LINK_KINDS[kind].label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function LinkRow({
  index,
  total,
  control,
  register,
  setValue,
  errors,
  featuredBlockHidden,
  headingRef,
  onMove,
  onRemove,
  onFeature,
}: {
  index: number;
  total: number;
  control: Control<CardFormValues>;
  register: UseFormRegister<CardFormValues>;
  setValue: UseFormSetValue<CardFormValues>;
  errors: LinkErrors;
  featuredBlockHidden: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onFeature: (index: number, featured: boolean) => void;
}) {
  const headingId = useId();
  const warningId = useId();
  const link = useWatch({ control, name: `links.${index}` });
  // A row being removed can see one last update before it unmounts.
  if (!link) return null;
  const kind = link.kind;
  const info = LINK_KINDS[kind] ?? LINK_KINDS.custom;
  const title = linkTitle(link);
  const warning = PUBLIC_WARNINGS[kind];
  const first = index === 0;
  const last = index === total - 1;

  const valueField = register(`links.${index}.value`);

  const featureHint = !link.is_visible && link.is_featured
    ? "This link is hidden, so it won't show until you turn on Show on my card."
    : featuredBlockHidden
      ? "Your Featured block is turned off on the Design tab, so a featured link shows with the others."
      : "Set apart from your other links as a button of its own. Only one link can be featured.";

  return (
    <li
      aria-labelledby={headingId}
      className={cn(
        "space-y-4 border bg-white p-4",
        link.is_featured ? "border-shpe-orange" : "border-shpe-rule",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h4
            ref={headingRef}
            id={headingId}
            tabIndex={-1}
            className="flex min-w-0 items-center gap-2 font-semibold text-shpe-navy focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-shpe-navy-soft">
              <LinkKindIcon kind={kind} className="h-5 w-5" />
            </span>
            <span className="min-w-0 break-words">{title}</span>
            <span className="sr-only">
              , link {index + 1} of {total}
            </span>
          </h4>
          {link.is_featured && <Badge tone="brand">Featured</Badge>}
          {!link.is_visible && <Badge tone="neutral">Hidden</Badge>}
        </div>

        <div className="flex shrink-0 gap-1">
          <Button
            variant="subtle"
            size="icon"
            aria-label={`Move ${title} up`}
            aria-disabled={first || undefined}
            onClick={() => !first && onMove(index, index - 1)}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="subtle"
            size="icon"
            aria-label={`Move ${title} down`}
            aria-disabled={last || undefined}
            onClick={() => !last && onMove(index, index + 1)}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="subtle"
            size="icon"
            aria-label={`Remove ${title}`}
            onClick={() => onRemove(index)}
            className="hover:border-red-700 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Field
        label={valueLabel(kind)}
        hint={warning ? undefined : info.hint}
        error={errors?.value?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...valueField}
            // The public-info warning is read with the field, not only seen beside it.
            aria-describedby={
              [props["aria-describedby"], warning ? warningId : null].filter(Boolean).join(" ") ||
              undefined
            }
            onBlur={(event) => {
              // Tidy what was typed (a username becomes the full link) before
              // validation runs, so a fixable value never flashes an error.
              const raw = event.target.value;
              const tidy = info.normalize(raw);
              if (tidy !== raw) setValue(`links.${index}.value`, tidy, { shouldDirty: true });
              return valueField.onBlur(event);
            }}
            type="text"
            inputMode={info.inputMode}
            placeholder={info.placeholder}
            maxLength={CARD_LIMITS.linkValue}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>

      {warning && (
        <p className="flex items-start gap-2 border-l-4 border-l-shpe-gold bg-shpe-gold-soft p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span id={warningId}>{warning}</span>
        </p>
      )}

      <Field
        label="Button text"
        hint={
          kind === "custom"
            ? "Give it a label so people know where it goes."
            : `Optional. Leave it blank to show “${info.label}”.`
        }
        error={errors?.label?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...register(`links.${index}.label`)}
            maxLength={CARD_LIMITS.linkLabel}
            placeholder={info.label}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Checkbox
          {...register(`links.${index}.is_visible`)}
          label="Show on my card"
          description="Turn off to hide it without deleting it."
        />
        <Checkbox
          checked={link.is_featured}
          onChange={(event) => onFeature(index, event.target.checked)}
          label="Feature this link"
          description={featureHint}
        />
      </div>
    </li>
  );
}

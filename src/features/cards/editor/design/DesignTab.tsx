import { useMemo, useRef } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { ImageIcon, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select } from "@/components/ui/primitives";
import type { CardFormValues } from "@/lib/validation";
import {
  BACKGROUND_DIM_MAX,
  CARD_COLOR_KEYS,
  CARD_FONT_IDS,
  GRADIENT_ANGLE_MAX,
  type CardAvatarShape,
  type CardBackgroundType,
  type CardButtonArrangement,
  type CardButtonShape,
  type CardButtonStyle,
  type CardColorKey,
  type CardDensity,
  type CardFontId,
  type CardLayout,
  type CardPattern,
  type CardPresetId,
  type CardSectionId,
  type CardTheme,
} from "../../model";
import { CARD_PRESETS, resolveTheme, themeContrastIssues } from "../../themes";
import { CARD_FONTS, isCardFontId, useCardFonts } from "../../fonts";
import { ImageField } from "../../ImageField";
import { BACKGROUND_SPEC } from "../../imageUpload";
import { BlockOrder } from "./BlockOrder";
import { ColorField } from "./ColorField";
import { ContrastPanel } from "./ContrastPanel";
import {
  ArrangementPicture,
  AvatarShapePicture,
  ButtonShapePicture,
  ButtonStylePicture,
  DensityPicture,
  LayoutPicture,
  PatternSwatch,
} from "./illustrations";
import { DesignSection, OptionGroup, type OptionItem } from "./parts";
import { PresetGallery } from "./PresetGallery";
import { RangeField } from "./RangeField";
import {
  COLOR_LABELS,
  applyThemePatch,
  contrastFix,
  hasThemeOverrides,
  isColorOverridden,
  resetThemeColor,
  type ThemePatch,
} from "./themeEdit";

/** Every write marks the form dirty (the unsaved-changes guard) and re-validates. */
const WRITE = { shouldDirty: true, shouldValidate: true } as const;

/** Loaded once for the font pickers, so each option can be shown in its own face. */
const ALL_FONTS = [...CARD_FONT_IDS];

const COLOR_HINTS: Record<CardColorKey, string> = {
  background: "Behind the card, for solid and pattern backgrounds.",
  surface: "The card itself.",
  text: "Your name and main text.",
  muted: "School, pronouns and section titles.",
  accent: "Buttons, icons and the photo ring.",
  accentText: "Text on filled buttons, like Add to Contacts.",
};

const LAYOUT_OPTIONS: OptionItem<CardLayout>[] = (
  [
    { value: "classic", label: "Classic", description: "Centered photo and name." },
    { value: "banner", label: "Banner", description: "A cover image, with your photo overlapping it." },
    { value: "split", label: "Split", description: "Left-aligned. Two columns on a wide screen." },
    { value: "minimal", label: "Minimal", description: "No photo. Just your name and words." },
    { value: "badge", label: "Badge", description: "A conference lanyard look." },
  ] satisfies OptionItem<CardLayout>[]
).map((option) => ({ ...option, preview: <LayoutPicture layout={option.value} /> }));

const SHAPE_LABELS: Record<CardButtonShape, string> = { pill: "Pill", rounded: "Rounded", square: "Square" };
const STYLE_LABELS: Record<CardButtonStyle, string> = {
  filled: "Filled",
  outline: "Outline",
  soft: "Soft",
  glass: "Glass",
};
const AVATAR_LABELS: Record<CardAvatarShape, string> = {
  circle: "Circle",
  rounded: "Rounded",
  square: "Square",
  hidden: "No photo",
};
const PATTERN_LABELS: Record<CardPattern, string> = {
  dots: "Dots",
  grid: "Blueprint grid",
  topo: "Contours",
  diagonal: "Diagonal lines",
};

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The Design tab: preset gallery, then every fine-tuning control the theme
 * allows, then block order.
 *
 * Reads the form with useWatch and writes it with setValue. Theme edits go
 * through applyThemePatch, which stores only what differs from the preset (see
 * themeEdit.ts), so the theme in the form is always one the strict schema and
 * the database accept. Nothing here saves: the live preview beside the form
 * shows each change, and the editor's Save button publishes it.
 */
export function DesignTab({
  form,
  memberId,
  nationalMemberVerified = false,
}: {
  form: UseFormReturn<CardFormValues>;
  memberId: string;
  /** From the profile: whether the SHPE block can show the National badge. */
  nationalMemberVerified?: boolean;
}) {
  const { control } = form;
  const theme = useWatch({ control, name: "theme" }) as CardTheme | undefined;
  const sections = useWatch({ control, name: "sections" });
  const backgroundPath = useWatch({ control, name: "background_path" });
  const displayName = useWatch({ control, name: "display_name" });
  const statusLine = useWatch({ control, name: "status_line" });
  const bio = useWatch({ control, name: "bio" });
  const skills = useWatch({ control, name: "skills" });
  const languages = useWatch({ control, name: "languages" });
  const links = useWatch({ control, name: "links" });
  const showMemberSince = useWatch({ control, name: "show_member_since" });
  const showNationalMember = useWatch({ control, name: "show_national_member" });

  useCardFonts(ALL_FONTS);

  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const preset = CARD_PRESETS[resolved.preset].theme;
  const issues = useMemo(() => themeContrastIssues(resolved), [resolved]);
  const contrastItems = useMemo(
    () => issues.map((issue) => ({ issue, fix: contrastFix(theme, issue) })),
    [issues, theme],
  );
  const overrides = useMemo(() => hasThemeOverrides(theme), [theme]);
  const contrastRef = useRef<HTMLDivElement>(null);
  const colorsHeadingRef = useRef<HTMLHeadingElement>(null);

  const writeTheme = (next: CardTheme) => form.setValue("theme", next, WRITE);
  // Read at write time, not from the render: two quick edits must both land.
  const patch = (change: ThemePatch) => writeTheme(applyThemePatch(form.getValues("theme"), change));
  const choosePreset = (id: CardPresetId) => writeTheme({ preset: id });

  /**
   * After a contrast fix the button pressed usually disappears with the
   * problem it fixed, or the whole panel does with the last one. Once the
   * change has rendered, focus goes to the next problem's button, or to the
   * Colors section when none are left. Left alone when the button is still
   * there (a fix that didn't clear its own problem).
   */
  const focusAfterContrastFix = (index: number) => {
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const panel = contrastRef.current;
      if (!panel) {
        colorsHeadingRef.current?.focus();
        return;
      }
      const items = panel.querySelectorAll("li");
      const item = items[Math.min(index, items.length - 1)];
      (item?.querySelector<HTMLElement>("button") ?? panel).focus();
    });
  };

  const reviewContrast = () => {
    contrastRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    contrastRef.current?.focus({ preventScroll: true });
  };

  const contrastNotice =
    issues.length > 0 ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-4 border-l-shpe-gold bg-shpe-gold-soft px-3 py-2 text-sm text-amber-950">
        <TriangleAlert className="h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
        <span className="flex-1">
          {issues.length === 1 ? "One color is hard to read." : `${issues.length} colors are hard to read.`}
        </span>
        <Button variant="ghost" size="sm" className="min-h-11" onClick={reviewContrast}>
          Review and fix
        </Button>
      </div>
    ) : null;

  const featuredLink = Array.isArray(links) && links.some((link) => link.is_featured && link.is_visible);
  const emptyNotes: Partial<Record<CardSectionId, string>> = {};
  if (!hasText(statusLine)) emptyNotes.status = "Empty for now: add a status line on the Content tab.";
  if (!hasText(bio)) emptyNotes.about = "Empty for now: add a bio on the Content tab.";
  if (!featuredLink) emptyNotes.featured = "Empty for now: star a link on the Links tab.";
  if (!Array.isArray(links) || !links.some((link) => link.is_visible)) {
    emptyNotes.links = "Empty for now: add links on the Links tab.";
  }
  if (!Array.isArray(skills) || skills.length === 0) emptyNotes.skills = "Empty for now: add skills on the Content tab.";
  if (!Array.isArray(languages) || languages.length === 0) {
    emptyNotes.languages = "Empty for now: add languages on the Content tab.";
  }
  // The SHPE block holds only the member-since date and the verified National
  // badge (the chapter position sits under the name), so it is often empty.
  if (!showMemberSince && !(showNationalMember && nationalMemberVerified)) {
    emptyNotes.shpe = nationalMemberVerified
      ? "Empty for now: turn on “Show when I joined WashU SHPE” or “Show my SHPE National membership” on the Content tab."
      : "Empty for now: turn on “Show when I joined WashU SHPE” on the Content tab. Your National badge shows here too once an officer verifies your membership.";
  }

  const bgType = resolved.background.type;
  const backgroundOptions: OptionItem<CardBackgroundType>[] = [
    {
      value: "solid",
      label: "Solid color",
      preview: <span className="block h-10 w-full border border-shpe-rule" style={{ backgroundColor: resolved.colors.background }} />,
    },
    {
      value: "gradient",
      label: "Gradient",
      preview: (
        <span
          className="block h-10 w-full border border-shpe-rule"
          style={{ backgroundImage: `linear-gradient(${resolved.background.angle}deg, ${resolved.background.from}, ${resolved.background.to})` }}
        />
      ),
    },
    {
      value: "image",
      label: "Photo",
      preview: (
        <span className="flex h-10 w-full items-center justify-center border border-shpe-rule bg-shpe-navy-soft">
          <ImageIcon className="size-5 text-shpe-navy" />
        </span>
      ),
    },
    {
      value: "pattern",
      label: "Pattern",
      preview: (
        <span className="block h-10 w-full overflow-hidden">
          <PatternSwatch theme={resolved} pattern={resolved.background.pattern} />
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <ContrastPanel
        ref={contrastRef}
        items={contrastItems}
        colors={resolved.colors}
        onApply={(fix, index) => {
          patch({ colors: { [fix.key]: fix.color } });
          focusAfterContrastFix(index);
        }}
        presetLabel={CARD_PRESETS[resolved.preset].label}
        onResetColors={
          CARD_COLOR_KEYS.some((key) => isColorOverridden(theme, key))
            ? (index) => {
                patch({ colors: { ...preset.colors } });
                focusAfterContrastFix(index);
              }
            : undefined
        }
      />

      <DesignSection
        title="Start from a preset"
        description="Each preset sets the colors, fonts, layout and buttons together. You can fine-tune anything below."
      >
        <PresetGallery current={resolved.preset} hasOverrides={overrides} onChoose={choosePreset} />
      </DesignSection>

      <DesignSection title="Layout">
        <OptionGroup
          legend="Layout"
          hideLegend
          hint="Banner shows the cover image from the Content tab, or your colors until you add one."
          value={resolved.layout}
          options={LAYOUT_OPTIONS}
          onChange={(layout) => patch({ layout })}
        />
      </DesignSection>

      <DesignSection
        title="Colors"
        description="Colors are checked for readability as you change them, against the WCAG AA standard."
        headingRef={colorsHeadingRef}
      >
        {contrastNotice}
        <div className="grid gap-5 sm:grid-cols-2">
          {CARD_COLOR_KEYS.map((key) => (
            <ColorField
              key={key}
              label={COLOR_LABELS[key]}
              hint={COLOR_HINTS[key]}
              value={resolved.colors[key]}
              onChange={(color) => patch({ colors: { [key]: color } })}
              overridden={isColorOverridden(theme, key)}
              onReset={() => writeTheme(resetThemeColor(form.getValues("theme"), key))}
            />
          ))}
        </div>
      </DesignSection>

      <DesignSection title="Background" description="What fills the screen around your card.">
        <OptionGroup
          legend="Background type"
          hideLegend
          value={bgType}
          options={backgroundOptions}
          onChange={(type) => patch({ background: { type } })}
          columns="grid-cols-2 sm:grid-cols-4"
        />

        {bgType === "solid" && (
          <p className="text-sm text-gray-600">Uses the page background color from Colors above.</p>
        )}

        {bgType === "gradient" && (
          <div className="grid gap-5 sm:grid-cols-2">
            <ColorField
              label="Gradient start"
              value={resolved.background.from}
              onChange={(from) => patch({ background: { from } })}
              overridden={resolved.background.from !== preset.background.from}
              onReset={() => patch({ background: { from: preset.background.from } })}
            />
            <ColorField
              label="Gradient end"
              value={resolved.background.to}
              onChange={(to) => patch({ background: { to } })}
              overridden={resolved.background.to !== preset.background.to}
              onReset={() => patch({ background: { to: preset.background.to } })}
            />
            <div className="sm:col-span-2">
              <RangeField
                label="Angle"
                min={0}
                max={GRADIENT_ANGLE_MAX}
                step={5}
                value={resolved.background.angle}
                display={`${resolved.background.angle}°`}
                valueText={`${resolved.background.angle} degrees`}
                hint="0° runs bottom to top, 90° left to right, 180° top to bottom."
                onChange={(angle) => patch({ background: { angle } })}
              />
            </div>
          </div>
        )}

        {bgType === "image" && (
          <div className="space-y-5">
            <ImageField
              label="Background photo"
              hint="A tall photo works best; it's cropped to fit a phone screen. Until you add one, your card shows your gradient."
              spec={BACKGROUND_SPEC}
              value={backgroundPath ?? null}
              onChange={(path) => form.setValue("background_path", path, WRITE)}
              memberId={memberId}
              shape="rect"
            />
            <RangeField
              label="Darken the photo"
              min={0}
              max={BACKGROUND_DIM_MAX}
              step={5}
              value={resolved.background.dim}
              display={`${resolved.background.dim}%`}
              valueText={`${resolved.background.dim} percent darker`}
              hint="A darker photo keeps a busy picture from fighting with your card."
              onChange={(dim) => patch({ background: { dim } })}
            />
          </div>
        )}

        {bgType === "pattern" && (
          <OptionGroup
            legend="Pattern"
            hint="Drawn over your page background color."
            value={resolved.background.pattern}
            options={(Object.keys(PATTERN_LABELS) as CardPattern[]).map((pattern) => ({
              value: pattern,
              label: PATTERN_LABELS[pattern],
              preview: <PatternSwatch theme={resolved} pattern={pattern} />,
            }))}
            onChange={(pattern) => patch({ background: { pattern } })}
            columns="grid-cols-2 sm:grid-cols-4"
          />
        )}
      </DesignSection>

      <DesignSection title="Fonts">
        <div className="grid gap-5 sm:grid-cols-2">
          <FontPicker
            label="Name font"
            hint="Your name at the top of the card."
            value={resolved.font.heading}
            presetValue={preset.font.heading}
            onChange={(heading) => patch({ font: { heading } })}
            sample={hasText(displayName) ? String(displayName).trim() : "Your Name"}
            heading
          />
          <FontPicker
            label="Text font"
            hint="Everything else on the card."
            value={resolved.font.body}
            presetValue={preset.font.body}
            onChange={(body) => patch({ font: { body } })}
            sample={hasText(statusLine) ? String(statusLine).trim() : "Seeking Summer internships · Hablo español"}
          />
        </div>
      </DesignSection>

      <DesignSection title="Buttons">
        {contrastNotice}
        <OptionGroup
          legend="Shape"
          value={resolved.buttons.shape}
          options={(Object.keys(SHAPE_LABELS) as CardButtonShape[]).map((shape) => ({
            value: shape,
            label: SHAPE_LABELS[shape],
            preview: <ButtonShapePicture shape={shape} />,
          }))}
          onChange={(shape) => patch({ buttons: { shape } })}
        />
        <OptionGroup
          legend="Style"
          hint="Add to Contacts and your featured link are always filled, so they stand out."
          value={resolved.buttons.style}
          options={(Object.keys(STYLE_LABELS) as CardButtonStyle[]).map((style) => ({
            value: style,
            label: STYLE_LABELS[style],
            preview: <ButtonStylePicture style={style} theme={resolved} />,
          }))}
          onChange={(style) => patch({ buttons: { style } })}
          columns="grid-cols-2 sm:grid-cols-4"
        />
        <OptionGroup<CardButtonArrangement>
          legend="Arrangement"
          value={resolved.buttons.arrangement}
          options={[
            {
              value: "list",
              label: "List",
              description: "One full-width button per link.",
              preview: <ArrangementPicture arrangement="list" />,
            },
            {
              value: "icon-grid",
              label: "Icon grid",
              description: "A compact grid of icons. Without icons, two columns of buttons.",
              preview: <ArrangementPicture arrangement="icon-grid" />,
            },
          ]}
          onChange={(arrangement) => patch({ buttons: { arrangement } })}
          columns="grid-cols-2"
        />
        <Checkbox
          label="Show icons on buttons"
          description="The LinkedIn, GitHub, email and other icons beside each label."
          checked={resolved.buttons.icons}
          onChange={(e) => patch({ buttons: { icons: e.target.checked } })}
        />
      </DesignSection>

      <DesignSection
        title="Photo"
        description={
          resolved.layout === "minimal"
            ? "The Minimal layout doesn't show a photo. These settings apply if you switch layouts."
            : "Upload or change your photo on the Content tab."
        }
      >
        <OptionGroup
          legend="Shape"
          value={resolved.avatar.shape}
          options={(Object.keys(AVATAR_LABELS) as CardAvatarShape[]).map((shape) => ({
            value: shape,
            label: AVATAR_LABELS[shape],
            preview: <AvatarShapePicture shape={shape} />,
          }))}
          onChange={(shape) => patch({ avatar: { shape } })}
          columns="grid-cols-2 sm:grid-cols-4"
        />
        <Checkbox
          label="Ring around the photo"
          description="A thin circle in your accent color."
          checked={resolved.avatar.ring}
          disabled={resolved.avatar.shape === "hidden"}
          onChange={(e) => patch({ avatar: { ring: e.target.checked } })}
        />
      </DesignSection>

      <DesignSection title="Spacing">
        <OptionGroup<CardDensity>
          legend="Spacing"
          hideLegend
          value={resolved.density}
          options={[
            {
              value: "comfortable",
              label: "Comfortable",
              description: "Roomy, with a larger photo.",
              preview: <DensityPicture density="comfortable" />,
            },
            {
              value: "compact",
              label: "Compact",
              description: "Tighter, so more fits on one screen.",
              preview: <DensityPicture density="compact" />,
            },
          ]}
          onChange={(density) => patch({ density })}
          columns="grid-cols-2"
        />
      </DesignSection>

      <DesignSection title="Block order" description="Choose which blocks appear on your card, and in what order.">
        <BlockOrder
          sections={sections}
          emptyNotes={emptyNotes}
          onChange={(next) => form.setValue("sections", next, WRITE)}
        />
      </DesignSection>

      <p role="status" className="sr-only">
        {issues.length === 0
          ? "Readability check: every color passes."
          : `Readability check: ${issues.length} ${issues.length === 1 ? "color needs" : "colors need"} fixing before you can save.`}
      </p>
    </div>
  );
}

/**
 * A font select with a live sample underneath. Options are styled in their
 * own face where the browser allows it (Chrome and Firefox on desktop); the
 * sample is what shows the choice everywhere else, including iOS, whose native
 * picker ignores option styles.
 */
function FontPicker({
  label,
  hint,
  value,
  presetValue,
  onChange,
  sample,
  heading = false,
}: {
  label: string;
  hint: string;
  value: CardFontId;
  presetValue: CardFontId;
  onChange: (value: CardFontId) => void;
  sample: string;
  heading?: boolean;
}) {
  const font = CARD_FONTS[value];
  return (
    <div className="min-w-0">
      <Field label={label} hint={hint}>
        {(props) => (
          <Select
            {...props}
            value={value}
            onChange={(e) => {
              if (isCardFontId(e.target.value)) onChange(e.target.value);
            }}
            style={{ fontFamily: font.stack }}
          >
            {CARD_FONT_IDS.map((id) => (
              <option key={id} value={id} style={{ fontFamily: CARD_FONTS[id].stack }}>
                {CARD_FONTS[id].label}
                {id === presetValue ? " (preset)" : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p
        aria-hidden="true"
        className="mt-3 truncate border-l-2 border-shpe-rule-strong pl-3 text-shpe-navy"
        style={{
          fontFamily: font.stack,
          fontWeight: heading ? font.headingWeight : 400,
          fontSize: heading ? "1.5rem" : "1rem",
        }}
      >
        {sample}
      </p>
    </div>
  );
}

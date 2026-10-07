import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type BaseSyntheticEvent,
} from "react";
import { useForm, useWatch, type FieldErrors, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/auth/useAuth";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/useToast";
import { cardFormSchema, type CardFormValues } from "@/lib/validation";
import { removeCardImages } from "@/services/cards";
import type { MemberCard, MyCardState } from "@/types/database";
import { resolveTheme, themeContrastIssues } from "../themes";
import { cardToFormValues, emptyCardFormValues, toPreviewCard } from "../viewModel";
import { DesignTab } from "./design/DesignTab";
import { ShareTab } from "./share/ShareTab";
import { InsightsTab } from "./insights/InsightsTab";
import { ContentTab } from "./ContentTab";
import { EditorBanners } from "./EditorBanners";
import { EditorTabs } from "./EditorTabs";
import { LinksTab } from "./LinksTab";
import { PhonePreview } from "./PhonePreview";
import { PublishControl } from "./PublishControl";
import { SaveBar, type SaveProblem } from "./SaveBar";
import {
  FORM_TABS,
  displayCardUrl,
  editorPanelId,
  editorTabId,
  errorFocusName,
  firstError,
  imagesToRemove,
  mediaPathsOf,
  mergeServerValues,
  tabsWithErrors,
  type EditorTabId,
} from "./editorUtils";
import { usePruneOrphanedMedia, useSaveMyCard } from "./useMyCard";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

/**
 * The My Card editor: one form across Content, Links and Design, the Share and
 * Insights tabs beside them, a live preview, the publish switch, and the one
 * save path.
 *
 * The form starts from the stored card (or, before there is one, from the
 * profile name and the suggested handle) and is re-seeded whenever the stored
 * card changes, as Profile does. When that happens mid-edit (a refetch on
 * reconnecting, publishing with unsaved changes), the stored card becomes the
 * new baseline and every field the member hasn't changed takes the stored
 * value; only the fields they did change keep what they typed. Keeping the
 * whole form instead would let the next save write stale values back: a handle
 * an officer just reset, or a photo replaced from another device.
 *
 * Saving refuses a theme that fails the contrast rules (the database checks
 * shape, not readability, so this is the only gate), sends the form as
 * save_my_card() expects it, and resets to what came back, which carries the
 * ids of newly added links. The fields are disabled while the save is in
 * flight, since that reset would wipe anything typed meanwhile. Images the
 * save left unreferenced are deleted afterwards, never before: until the save
 * succeeds the old image is still the live one.
 */
/**
 * The toast after a save, told from where the save left the card: a member
 * whose card is a draft, hidden, or waiting for cards to be switched on
 * shouldn't hear that it's live, and one whose card is live should hear that
 * the change is out there now.
 */
function savedMessage(
  saved: MemberCard | null,
  enabled: boolean,
  isNew: boolean,
): { title: string; detail?: string } {
  const title = isNew ? "Your card is saved" : "Changes saved";
  if (!saved) return { title };
  if (saved.hidden_at) {
    return { title, detail: "An officer has hidden your card, so nobody can see it until they unhide it." };
  }
  if (!saved.is_published) {
    return { title, detail: "Publish it when you're ready, with the switch at the top." };
  }
  if (!enabled) {
    return {
      title,
      detail: "Your card is published, and it goes live when business cards are switched on.",
    };
  }
  return { title: "Your card is updated", detail: `It's live at ${displayCardUrl(saved.handle)}.` };
}

export function CardEditor({
  state,
  suggestedHandle,
}: {
  state: MyCardState;
  suggestedHandle: string | null;
}) {
  const { user, isOfficer } = useAuth();
  const toast = useToast();
  const idPrefix = useId();
  const formId = useId();

  const card = state.card;
  const memberId = card?.member_id ?? user?.id ?? "";
  const isNew = card === null;

  const serverValues = useMemo(
    () =>
      card ? cardToFormValues(card, state.links) : emptyCardFormValues(state.profile, suggestedHandle),
    [card, state.links, state.profile, suggestedHandle],
  );

  const form = useForm<CardFormValues>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: serverValues,
    mode: "onTouched",
    // Focus is moved by onInvalid below, which knows the field may be on a
    // tab that isn't showing yet.
    shouldFocusError: false,
  });
  const {
    control,
    formState: { isDirty, errors },
  } = form;

  useEffect(() => {
    if (!form.formState.isDirty) {
      form.reset(serverValues);
      return;
    }
    // Mid-edit: the member's changes are whatever differs from the baseline
    // the form was seeded with. Compared per top-level field, not per leaf:
    // merging links row by row against a list that changed elsewhere could
    // pair one link's id with another's address.
    const baseline = form.formState.defaultValues as CardFormValues;
    const merged = mergeServerValues(form.getValues(), baseline, serverValues);
    // Two steps, because reset can't set the baseline and the values to
    // different things at once: first both to the stored card, then the
    // values alone to the merge, so isDirty and dirtyFields are measured
    // against the stored card. The second reset also re-renders the links
    // list if the Links tab is open, which setValue wouldn't.
    form.reset(serverValues);
    form.reset(merged, { keepDefaultValues: true });
  }, [form, serverValues]);

  const [tab, setTab] = useState<EditorTabId>("content");
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Stable on purpose: Dialog re-runs its open effect when onClose changes,
  // which would yank focus back to the trigger on every editor re-render.
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const closeDiscard = useCallback(() => setConfirmDiscard(false), []);
  /** A field to focus once the tab it lives on has rendered. */
  const pendingFocus = useRef<Path<CardFormValues> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const name = pendingFocus.current;
    if (!name) return;
    pendingFocus.current = null;
    form.setFocus(name);
  }, [tab, form]);

  /* ── Images uploaded in this session ─────────────────────────────────── */

  // Every path the form has pointed at since the last save. Uploading
  // replaces a path in the form but not in storage, so anything here that the
  // saved card doesn't use afterwards is an orphan to clean up.
  const storedPaths = useMemo(() => mediaPathsOf(card), [card]);
  // Also before a first save, when nothing in the folder is referenced yet:
  // uploads abandoned before ever saving would otherwise keep a member under
  // the 30-file cap. Recent uploads (under a week) are never touched, so one
  // waiting to be saved in this or another tab survives.
  usePruneOrphanedMedia(memberId || null, storedPaths);
  const seenPaths = useRef(new Set<string>());
  const media = useWatch({ control, name: ["avatar_path", "banner_path", "background_path"] });
  useEffect(() => {
    for (const path of media) if (path) seenPaths.current.add(path);
  }, [media]);

  /* ── Preview and contrast ────────────────────────────────────────────── */

  const previewContext = useMemo(
    () => ({ profile: state.profile, position: state.position }),
    [state.profile, state.position],
  );
  // Built here rather than in useWatch's `compute`, which only re-runs when a
  // form value changes: a refetch that brings a new position or major has to
  // reach the preview too, without waiting for the member's next keystroke.
  const watchedValues = useWatch({ control }) as CardFormValues;
  const livePreview = useMemo(
    () => toPreviewCard(watchedValues, previewContext),
    [watchedValues, previewContext],
  );
  // Typing stays responsive; the preview catches up a frame later.
  const preview = useDeferredValue(livePreview);

  const theme = useWatch({ control, name: "theme" });
  const contrastIssues = useMemo(() => themeContrastIssues(resolveTheme(theme)), [theme]);

  const attention = tabsWithErrors(errors);
  if (contrastIssues.length > 0) attention.add("design");

  // A problem clears itself once whatever caused it has been fixed.
  const activeProblem =
    problem?.kind === "contrast" && contrastIssues.length === 0
      ? null
      : problem?.kind === "invalid" && attention.size === 0
        ? null
        : problem;

  /* ── Saving ──────────────────────────────────────────────────────────── */

  const save = useSaveMyCard();
  const saving = save.isPending;

  // The fields are disabled while a save is in flight (see the fieldset
  // below), and a browser drops focus from a control that becomes disabled.
  // Whatever had focus inside the form gets it back once the save is over.
  const fieldsRef = useRef<HTMLFieldSetElement>(null);
  const focusAfterSave = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (saving) return;
    const element = focusAfterSave.current;
    focusAfterSave.current = null;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (element?.isConnected && lost) element.focus();
  }, [saving]);

  /**
   * Saves the form. `quiet` skips the toast, for the publish switch, which
   * says "Your card is published" itself a moment later.
   */
  const persist = async (values: CardFormValues, { quiet = false } = {}): Promise<boolean> => {
    if (themeContrastIssues(resolveTheme(values.theme)).length > 0) {
      setProblem({ kind: "contrast" });
      return false;
    }
    setProblem(null);
    const active = document.activeElement;
    if (active instanceof HTMLElement && fieldsRef.current?.contains(active)) {
      focusAfterSave.current = active;
    }
    const candidates = [...storedPaths, ...seenPaths.current];
    try {
      const next = await save.mutateAsync(values);
      const saved = next.card;
      if (saved) form.reset(cardToFormValues(saved, next.links));
      // Only what this save accounted for. A path added since (an upload
      // finishing mid-save) stays tracked, so a later save or discard still
      // cleans it up.
      for (const path of candidates) seenPaths.current.delete(path);
      void removeCardImages(imagesToRemove(candidates, mediaPathsOf(saved)));

      if (!quiet) {
        const message = savedMessage(saved, next.enabled, isNew);
        toast.success(message.title, message.detail);
      }
      return true;
    } catch (error) {
      setProblem({ kind: "error", error });
      return false;
    }
  };

  const onInvalid = (formErrors: FieldErrors<CardFormValues>) => {
    setProblem({ kind: "invalid", tabs: [...tabsWithErrors(formErrors)] });
    const first = firstError(formErrors);
    if (!first) return;
    const name = errorFocusName(formErrors, first.field);
    if (first.tab === tab) {
      if (name) form.setFocus(name);
    } else {
      pendingFocus.current = name;
      setTab(first.tab);
    }
  };

  // Built at event time, not render time: handleSubmit's callbacks touch refs.
  const submit = (event?: BaseSyntheticEvent) =>
    form.handleSubmit(async (values) => {
      await persist(values);
    }, onInvalid)(event);

  /** For the publish switch: save first, and say whether that worked. */
  const saveForPublish = () =>
    new Promise<boolean>((resolve) => {
      void form.handleSubmit(
        async (values) => resolve(await persist(values, { quiet: true })),
        (formErrors) => {
          onInvalid(formErrors);
          resolve(false);
        },
      )();
    });

  /* ── Discarding ──────────────────────────────────────────────────────── */

  const discard = () => {
    const orphans = imagesToRemove(seenPaths.current, storedPaths);
    seenPaths.current.clear();
    form.reset(serverValues);
    setProblem(null);
    setConfirmDiscard(false);
    void removeCardImages(orphans);
    toast.info("Changes discarded", "Your card is back to how it was last saved.");
    // The dialog hands focus back to Discard, which disappears with the
    // changes, leaving focus on the page body. The panel is the nearest
    // sensible place to pick up from; a frame later, once the dialog is gone.
    window.requestAnimationFrame(() => panelRef.current?.focus());
  };

  useUnsavedChangesGuard(isDirty);

  /* ── Layout ──────────────────────────────────────────────────────────── */

  const live = Boolean(card?.is_published && !card.hidden_at && state.enabled);

  const renderPanel = () => {
    switch (tab) {
      case "content":
        return (
          <ContentTab
            form={form}
            memberId={memberId}
            profile={state.profile}
            position={state.position}
            savedHandle={card?.handle ?? null}
            chipHandle={card?.chip_handle ?? null}
            chipHandleActive={card?.chip_handle_active ?? null}
          />
        );
      case "links":
        return <LinksTab form={form} />;
      case "design":
        return (
          <DesignTab
            form={form}
            memberId={memberId}
            nationalMemberVerified={state.profile.national_member_verified}
          />
        );
      case "share":
        return <ShareTab card={card} preview={preview} isDirty={isDirty} />;
      case "insights":
        return <InsightsTab hasCard={card !== null} />;
    }
  };

  return (
    <div className="space-y-5">
      <EditorBanners state={state} isOfficer={isOfficer} />

      <PublishControl
        card={card}
        featureEnabled={state.enabled}
        isDirty={isDirty}
        saving={saving}
        onSave={saveForPublish}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        <Card>
          <EditorTabs idPrefix={idPrefix} selected={tab} onSelect={setTab} attention={attention} />

          <div
            ref={panelRef}
            role="tabpanel"
            id={editorPanelId(idPrefix, tab)}
            aria-labelledby={editorTabId(idPrefix, tab)}
            tabIndex={0}
            className="px-4 py-6 focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-shpe-navy sm:px-6"
          >
            {FORM_TABS.has(tab) ? (
              // Only the editing tabs sit in the <form>, so a button inside
              // Share or Insights can never submit it by accident.
              <form id={formId} onSubmit={submit} noValidate>
                {/* Disabled while saving: the reset to what the save returns
                    would otherwise wipe anything typed in the meantime. */}
                <fieldset ref={fieldsRef} disabled={saving} className="min-w-0">
                  {renderPanel()}
                </fieldset>
              </form>
            ) : (
              renderPanel()
            )}
          </div>

          <SaveBar
            isNew={isNew}
            isDirty={isDirty}
            saving={saving}
            live={live}
            problem={activeProblem}
            onSave={() => void submit()}
            onDiscard={() => setConfirmDiscard(true)}
            onPreview={() => setPreviewOpen(true)}
            onGoToTab={setTab}
          />
        </Card>

        <aside aria-label="Preview" className="hidden lg:sticky lg:top-6 lg:block">
          <PhonePreview card={preview} />
        </aside>
      </div>

      <Dialog open={previewOpen} onClose={closePreview} title="Preview" size="lg">
        <PhonePreview card={preview} variant="plain" />
      </Dialog>

      <ConfirmDialog
        open={confirmDiscard}
        onClose={closeDiscard}
        onConfirm={discard}
        title="Discard your changes?"
        description={
          isNew
            ? "The form goes back to how it started. Any photos you uploaded are removed."
            : "Your card goes back to how it was last saved. Any photos you uploaded since then are removed."
        }
        confirmLabel="Discard changes"
      />
    </div>
  );
}

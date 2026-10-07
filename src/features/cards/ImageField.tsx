import { useId, useRef, useState } from "react";
import { ImageIcon, ImagePlus, Trash2, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { cardMediaUrl } from "@/services/cards";
import { CropDialog } from "./imageField/CropDialog";
import {
  IMAGE_INPUT_ACCEPT,
  ImageProcessingError,
  loadImage,
  validateImageFile,
  type ImageSpec,
} from "./imageUpload";

export interface ImageFieldProps {
  label: string;
  hint?: string;
  spec: ImageSpec;
  /** Storage path in the card-media bucket. */
  value: string | null;
  onChange: (path: string | null) => void;
  memberId: string;
  /** Preview shape. */
  shape?: "circle" | "rect";
}

/**
 * The one image uploader on the card editor: photo and banner on the Content
 * tab, background on the Design tab.
 *
 * Choose → check the file → frame it → resize and upload → hand the new
 * storage path to the form. It never deletes anything from storage: until the
 * card is saved, the old image is still the live one, so the editor removes
 * replaced paths only after a successful save.
 */
export function ImageField({
  label,
  hint,
  spec,
  value,
  onChange,
  memberId,
  shape = "rect",
}: ImageFieldProps) {
  const labelId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: number; image: HTMLImageElement } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  const url = cardMediaUrl(value);
  const showImage = Boolean(url) && url !== brokenUrl;
  const noun = label.toLowerCase();

  const onFile = async (file: File | undefined) => {
    // Cleared so choosing the same file again (after a cancel) still fires change.
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setReading(true);
    try {
      const image = await loadImage(file);
      setEditing({ key: Date.now(), image });
    } catch (cause) {
      setError(
        cause instanceof ImageProcessingError
          ? cause.message
          : "We couldn't read that image. Try a different one.",
      );
    } finally {
      setReading(false);
    }
  };

  const onUploaded = (path: string) => {
    setEditing(null);
    setError(null);
    setAnnouncement(`New ${noun} added. Save your card to publish it.`);
    onChange(path);
  };

  const remove = () => {
    // Remove disappears with the image. Focus goes to the button beside it
    // (Replace, about to read Upload) before that happens, so a keyboard or
    // screen-reader user isn't dropped onto the page body.
    actionsRef.current?.querySelector<HTMLButtonElement>('[data-image-action="upload"]')?.focus();
    setError(null);
    setAnnouncement(`${label} removed. Save your card to publish the change.`);
    onChange(null);
  };

  const PlaceholderIcon = shape === "circle" ? UserRound : ImageIcon;

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      className="space-y-2"
    >
      <p id={labelId} className="text-sm font-medium text-shpe-navy">
        {label}
      </p>
      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden border border-shpe-rule bg-shpe-navy-soft",
            shape === "circle"
              ? "h-24 w-24 rounded-full"
              : spec.aspect >= 1
                ? "w-full max-w-xs"
                : "w-28",
          )}
          style={shape === "circle" ? undefined : { aspectRatio: String(spec.aspect) }}
        >
          {showImage && url ? (
            <img
              src={url}
              alt={`Current ${noun}`}
              className="h-full w-full object-cover"
              onError={() => setBrokenUrl(url)}
            />
          ) : (
            <>
              <PlaceholderIcon className="h-8 w-8 text-shpe-navy/50" aria-hidden="true" />
              <span className="sr-only">
                {value ? `Your ${noun} couldn't be shown` : `No ${noun} yet`}
              </span>
            </>
          )}
        </div>

        <div ref={actionsRef} className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            data-image-action="upload"
            onClick={() => inputRef.current?.click()}
            loading={reading}
            disabled={!memberId}
            aria-label={`${value ? "Replace" : "Upload"} ${noun}`}
          >
            {!reading && <ImagePlus className="h-4 w-4" aria-hidden="true" />}
            {value ? "Replace" : "Upload"}
          </Button>
          {value && (
            <Button variant="subtle" onClick={remove} aria-label={`Remove ${noun}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_INPUT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label={`Choose a ${noun} file`}
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {editing && (
        <CropDialog
          key={editing.key}
          image={editing.image}
          spec={spec}
          shape={shape}
          label={label}
          memberId={memberId}
          onCancel={() => setEditing(null)}
          onUploaded={onUploaded}
        />
      )}
    </div>
  );
}

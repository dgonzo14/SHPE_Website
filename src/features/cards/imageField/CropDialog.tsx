import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/primitives";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { uploadCardImage } from "@/services/cards";

/*
 * The storage policy refuses an upload when the member already has 30 card
 * images, or while their membership is suspended. Storage reports either as a
 * bare 403 / row-level-security error, which errorText() would turn into "ask
 * an officer to check your role" -- true of nothing here. Say what it is.
 */
const UPLOAD_REFUSED_MESSAGE =
  "We couldn't store that image. You can keep up to 30 card images (unused ones are cleared " +
  "about a week after upload), and uploads pause while a membership is suspended. Ask a SHPE " +
  "officer if this keeps happening.";

function isUploadRefused(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const { statusCode, status, message } = cause as {
    statusCode?: unknown;
    status?: unknown;
    message?: unknown;
  };
  return (
    String(statusCode) === "403" ||
    status === 403 ||
    (typeof message === "string" && /row-level security|unauthorized/i.test(message))
  );
}
import {
  DEFAULT_CROP,
  ImageProcessingError,
  MAX_ZOOM,
  MIN_ZOOM,
  computeCropRect,
  drawCropPreview,
  imageSize,
  renderCroppedImage,
  type ImageCrop,
  type ImageSpec,
} from "../imageUpload";

/**
 * Framing an image before upload: zoom and pan sliders (the keyboard and
 * screen-reader path), plus dragging the preview on a touch screen. The preview
 * is drawn with the same crop maths as the upload, so what the member sees here
 * is exactly what lands on the card.
 */
export function CropDialog({
  image,
  spec,
  shape,
  label,
  memberId,
  onCancel,
  onUploaded,
}: {
  image: HTMLImageElement;
  spec: ImageSpec;
  shape: "circle" | "rect";
  label: string;
  memberId: string;
  onCancel: () => void;
  onUploaded: (path: string) => void;
}) {
  const [crop, setCrop] = useState<ImageCrop>(DEFAULT_CROP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; crop: ImageCrop } | null>(null);

  const { width: srcW, height: srcH } = imageSize(image);
  const zoomed = computeCropRect(srcW, srcH, spec.aspect, crop);
  // Sub-pixel slack: at zoom 1 one axis has no room to move, and a slider that
  // does nothing is worse than a disabled one.
  const canPanX = srcW - zoomed.sw > 0.5;
  const canPanY = srcH - zoomed.sh > 0.5;

  // The preview canvas has a fixed backing size; CSS scales it to the dialog.
  const previewWidth = spec.aspect >= 1 ? 720 : 480;
  const previewHeight = Math.round(previewWidth / spec.aspect);

  useEffect(() => {
    if (canvasRef.current) drawCropPreview(canvasRef.current, image, spec.aspect, crop);
  }, [image, spec.aspect, crop]);

  const close = () => {
    if (!busy) onCancel();
  };

  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await renderCroppedImage(image, spec, crop);
      const path = await uploadCardImage(memberId, blob);
      onUploaded(path);
    } catch (cause) {
      setError(
        cause instanceof ImageProcessingError
          ? cause.message
          : isUploadRefused(cause)
            ? UPLOAD_REFUSED_MESSAGE
            : errorText(cause, "We couldn't upload that image"),
      );
      setBusy(false);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy || (!canPanX && !canPanY)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, crop };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;

    const rect = computeCropRect(srcW, srcH, spec.aspect, start.crop);
    // Source pixels per screen pixel, then pan units per source pixel: pan
    // spans the overflow from −1 to 1, so one unit is half the overflow.
    const scale = rect.sw / box.width;
    const overflowX = srcW - rect.sw;
    const overflowY = srcH - rect.sh;
    const dx = (event.clientX - start.x) * scale;
    const dy = (event.clientY - start.y) * scale;
    // Dragging the picture right reveals more of its left side.
    setCrop({
      zoom: start.crop.zoom,
      x: overflowX > 0 ? clampPan(start.crop.x - (2 * dx) / overflowX) : start.crop.x,
      y: overflowY > 0 ? clampPan(start.crop.y - (2 * dy) / overflowY) : start.crop.y,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const noun = label.toLowerCase();

  return (
    <Dialog
      open
      onClose={close}
      title={`Position your ${noun}`}
      description="Drag the picture or use the sliders. Only the part shown here is uploaded, and the photo's location data is removed."
      size={spec.aspect >= 2 ? "lg" : "md"}
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void upload()} loading={busy}>
            {busy ? "Uploading…" : `Use this ${noun}`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div
          className={cn(
            "relative mx-auto w-full overflow-hidden border border-shpe-rule bg-gray-100",
            spec.aspect >= 2 ? "" : spec.aspect >= 1 ? "max-w-[18rem]" : "max-w-[14rem]",
          )}
        >
          <canvas
            ref={canvasRef}
            width={previewWidth}
            height={previewHeight}
            role="img"
            aria-label={`Preview of your ${noun} as it will appear`}
            className={cn(
              "block h-auto w-full touch-none select-none",
              (canPanX || canPanY) && !busy ? "cursor-grab active:cursor-grabbing" : "",
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          {shape === "circle" && (
            // Dims the corners a round photo frame cuts off, without hiding them.
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            />
          )}
        </div>

        <div className="space-y-3">
          <RangeField
            label="Zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            valueText={`${Math.round(crop.zoom * 100)}%`}
            disabled={busy}
            onChange={(zoom) => setCrop((current) => ({ ...current, zoom }))}
          />
          <RangeField
            label="Left and right"
            min={-1}
            max={1}
            step={0.01}
            value={crop.x}
            valueText={panText(crop.x, "left", "right")}
            disabled={busy || !canPanX}
            onChange={(x) => setCrop((current) => ({ ...current, x }))}
          />
          <RangeField
            label="Up and down"
            min={-1}
            max={1}
            step={0.01}
            value={crop.y}
            valueText={panText(crop.y, "top", "bottom")}
            disabled={busy || !canPanY}
            onChange={(y) => setCrop((current) => ({ ...current, y }))}
          />
          {(!canPanX || !canPanY) && (
            <p className="text-xs text-gray-600">
              Zoom in to move the picture {!canPanX && !canPanY ? "around" : !canPanX ? "left and right" : "up and down"}.
            </p>
          )}
        </div>

        <Button variant="ghost" size="sm" onClick={() => setCrop(DEFAULT_CROP)} disabled={busy}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset framing
        </Button>

        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}

function clampPan(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** "Centered", "30% toward the left", ... for screen readers and the visible readout. */
function panText(value: number, negative: string, positive: string): string {
  const percent = Math.round(Math.abs(value) * 100);
  if (percent < 2) return "Centered";
  return `${percent}% toward the ${value < 0 ? negative : positive}`;
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  valueText,
  disabled,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  valueText: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-shpe-navy">
          {label}
        </label>
        <span className="text-xs tabular-nums text-gray-600" aria-hidden="true">
          {valueText}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(
          "block h-11 w-full cursor-pointer accent-shpe-orange-dark",
          "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-shpe-navy",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
    </div>
  );
}

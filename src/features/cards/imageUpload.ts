import { CARD_LIMITS } from "./model";

/**
 * Card photos, banners and backgrounds: choose → crop → resize → encode, all in
 * the browser.
 *
 * Supabase's server-side image transforms are a paid feature, so every image is
 * made small before it leaves the phone: a 12-megapixel camera photo becomes a
 * 512 px WebP of a few tens of KB. That keeps the card fast on 4G, keeps the
 * free storage tier comfortable, and keeps uploads well under the bucket's
 * 2 MB file_size_limit.
 *
 * Re-encoding through a canvas also drops every byte of metadata the original
 * carried, EXIF and GPS location included. A phone photo taken at home would
 * otherwise publish where the member lives. That is a property of drawing to a
 * canvas and exporting fresh pixels, so it holds for every path through
 * renderCroppedImage(), the JPEG fallback included.
 */

/** Output size. Height is width / aspect. */
export interface ImageSpec {
  aspect: number;
  width: number;
}

export const AVATAR_SPEC: ImageSpec = { aspect: 1, width: 512 };
export const BANNER_SPEC: ImageSpec = { aspect: 3, width: 1200 };
export const BACKGROUND_SPEC: ImageSpec = { aspect: 2 / 3, width: 1080 };

/**
 * How the member framed the image. `zoom` 1–4 (1 = the largest crop of the
 * chosen aspect that fits the photo); `x` and `y` −1..1 pan across whatever the
 * crop leaves over: −1 is the left/top edge, 0 centred, 1 the right/bottom edge.
 */
export interface ImageCrop {
  zoom: number;
  x: number;
  y: number;
}

export const DEFAULT_CROP: ImageCrop = { zoom: 1, x: 0, y: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/**
 * Formats every browser's canvas can decode. HEIC is deliberately absent: only
 * Safari can draw it, so accepting it would work for some members and fail for
 * others. (iPhones convert HEIC to JPEG on upload when the file input asks for
 * these types, which is what ACCEPTED_IMAGE_TYPES is for.) A GIF uploads as its
 * first frame.
 */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** For a file input's `accept` attribute. */
export const IMAGE_INPUT_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

/**
 * The largest file we'll try to read. The output is tiny whatever goes in, but
 * decoding a huge original can exhaust a phone's memory before we get there.
 */
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/**
 * iOS Safari refuses to allocate a canvas over 16,777,216 pixels (4096²) and
 * silently draws nothing instead. Intermediate canvases stay below this.
 */
const MAX_CANVAS_AREA = 16_000_000;

/** Qualities tried in turn until the image fits under the bucket limit. */
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.5] as const;

/** Thrown with a sentence that can be shown to the member as-is. */
export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Some browsers report an empty type for files they don't recognise. */
function effectiveType(file: File): string {
  const type = file.type.toLowerCase();
  if (type === "image/jpg" || type === "image/pjpeg") return "image/jpeg";
  if (type) return type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "";
}

/** A member-facing reason the file can't be used, or null when it can. */
export function validateImageFile(file: File): string | null {
  const type = effectiveType(file);
  const name = file.name.toLowerCase();

  if (type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/.test(name)) {
    return "That's an HEIC photo, which browsers can't edit. Save it as a JPEG or PNG and try again.";
  }
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) {
    return "Choose a JPEG, PNG, WebP or GIF image.";
  }
  if (file.size === 0) {
    return "That file is empty. Choose a different image.";
  }
  if (file.size > MAX_INPUT_BYTES) {
    return "That image is larger than 15 MB. Choose a smaller one.";
  }
  return null;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * The region of the source to draw. Pure, so the live preview and the final
 * render can't disagree about what the member framed.
 *
 * At zoom 1 the region is the largest one of `aspect` that fits ("cover"); each
 * step of zoom shrinks it about the pan position. The result always lies inside
 * the source, whatever the inputs: out-of-range or non-finite crop values are
 * clamped to their defaults.
 */
export function computeCropRect(
  srcW: number,
  srcH: number,
  aspect: number,
  crop: ImageCrop,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!(srcW > 0 && srcH > 0) || !Number.isFinite(srcW) || !Number.isFinite(srcH)) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : srcW / srcH;

  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM, MIN_ZOOM);
  const x = clamp(crop.x, -1, 1, 0);
  const y = clamp(crop.y, -1, 1, 0);

  // Cover-fit: whichever side of the source is relatively shorter bounds the crop.
  const coverW = srcW / srcH > ratio ? srcH * ratio : srcW;
  const coverH = srcW / srcH > ratio ? srcH : srcW / ratio;

  const sw = Math.min(srcW, coverW / zoom);
  const sh = Math.min(srcH, coverH / zoom);
  const overflowX = srcW - sw;
  const overflowY = srcH - sh;

  // The min/max guard against floating-point drift past the far edge.
  const sx = Math.max(0, Math.min(overflowX, (overflowX / 2) * (1 + x)));
  const sy = Math.max(0, Math.min(overflowY, (overflowY / 2) * (1 + y)));

  return { sx, sy, sw, sh };
}

/** Intrinsic size, after the browser has applied EXIF orientation. */
export function imageSize(img: HTMLImageElement): { width: number; height: number } {
  return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

/**
 * Decodes a file into an image element. The object URL is revoked as soon as
 * the image has loaded or failed: a loaded image keeps its pixels, so nothing
 * needs the URL afterwards.
 *
 * Modern browsers apply the photo's EXIF orientation when decoding (and when
 * drawing to a canvas), so a portrait phone photo arrives upright.
 */
export function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = imageSize(img);
      if (width > 0 && height > 0) {
        resolve(img);
      } else {
        reject(new ImageProcessingError("We couldn't read that image. Try a different one."));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageProcessingError("We couldn't read that image. Try a different one."));
    };
    img.src = url;
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ImageProcessingError(
      "Your browser couldn't process that image. Try again, or use a different browser.",
    );
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

/**
 * Draws the framed region into the editor's preview canvas, filling it. Uses
 * the same computeCropRect() as the final render, so the preview is exact.
 */
export function drawCropPreview(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  aspect: number,
  crop: ImageCrop,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = imageSize(img);
  const { sx, sy, sw, sh } = computeCropRect(width, height, aspect, crop);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (sw <= 0 || sh <= 0) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
}

/**
 * Scales the region down to outW × outH. A single large reduction (4000 px to
 * 512) aliases in some browsers, so it halves in steps first, and keeps each
 * intermediate canvas under the iOS size limit.
 */
function drawScaled(
  img: HTMLImageElement,
  rect: { sx: number; sy: number; sw: number; sh: number },
  outW: number,
  outH: number,
): HTMLCanvasElement {
  let source: CanvasImageSource = img;
  let { sx, sy, sw, sh } = rect;

  while (sw > outW * 2 && sh > outH * 2) {
    let w = Math.max(outW, Math.round(sw / 2));
    let h = Math.max(outH, Math.round(sh / 2));
    if (w * h > MAX_CANVAS_AREA) {
      const shrink = Math.sqrt(MAX_CANVAS_AREA / (w * h));
      w = Math.max(outW, Math.floor(w * shrink));
      h = Math.max(outH, Math.floor(h * shrink));
    }
    const step = createCanvas(w, h);
    context2d(step).drawImage(source, sx, sy, sw, sh, 0, 0, step.width, step.height);
    source = step;
    sx = 0;
    sy = 0;
    sw = step.width;
    sh = step.height;
  }

  const out = createCanvas(outW, outH);
  context2d(out).drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** JPEG has no transparency; without this, transparent pixels turn black. */
function flattenOnWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const flat = createCanvas(canvas.width, canvas.height);
  const ctx = context2d(flat);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat;
}

/**
 * Encodes as WebP, or as JPEG where the browser can't encode WebP (older Safari
 * quietly returns a PNG when asked for WebP, which would be far larger). Lowers
 * the quality until the file is under the bucket limit; null if it never is.
 */
async function encodeUnderLimit(canvas: HTMLCanvasElement): Promise<Blob | null> {
  let webp = true;
  let flat: HTMLCanvasElement | null = null;

  for (const quality of QUALITY_STEPS) {
    let blob: Blob | null = null;
    if (webp) {
      blob = await toBlob(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") {
        webp = false;
        blob = null;
      }
    }
    if (!webp) {
      flat ??= flattenOnWhite(canvas);
      blob = await toBlob(flat, "image/jpeg", quality);
      if (!blob || blob.type !== "image/jpeg") {
        throw new ImageProcessingError(
          "Your browser couldn't save that image. Try again, or use a different browser.",
        );
      }
    }
    if (blob && blob.size < CARD_LIMITS.imageBytes) return blob;
  }
  return null;
}

/**
 * Crops, resizes and encodes the image for upload. The output is `spec.width`
 * wide, or the cropped region's own width when that is smaller: enlarging a
 * small photo adds bytes, not detail.
 */
export async function renderCroppedImage(
  img: HTMLImageElement,
  spec: ImageSpec,
  crop: ImageCrop,
): Promise<Blob> {
  const { width, height } = imageSize(img);
  const aspect = spec.aspect > 0 && Number.isFinite(spec.aspect) ? spec.aspect : 1;
  const rect = computeCropRect(width, height, aspect, crop);
  if (rect.sw <= 0 || rect.sh <= 0) {
    throw new ImageProcessingError("We couldn't read that image. Try a different one.");
  }

  let outW = Math.max(1, Math.min(Math.round(spec.width), Math.round(rect.sw)));
  // Three tries at shrinking further if even the lowest quality is too big.
  // Realistically unreachable at these sizes; it's here so the bucket limit is
  // never the error a member sees.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const outH = Math.max(1, Math.round(outW / aspect));
    const canvas = drawScaled(img, rect, outW, outH);
    const blob = await encodeUnderLimit(canvas);
    if (blob) return blob;
    outW = Math.max(1, Math.round(outW * 0.75));
  }

  throw new ImageProcessingError(
    "We couldn't make that image small enough to upload. Try a different photo.",
  );
}

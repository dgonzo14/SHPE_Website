import { encode } from "uqr";

/**
 * QR codes for a card, generated in the browser.
 *
 * No third-party QR service: that would leak every member's card URL to it and
 * need a CSP exception. uqr computes the module matrix; the drawing is ours, so
 * the code can take the card's own theme colours and stays crisp at any size.
 *
 * Error correction is "M" (about 15% recoverable), the usual choice for codes
 * that get printed, scuffed and scanned off a phone screen at an angle. The
 * default 4-module quiet zone is what the QR spec asks for; scanners struggle
 * without it, especially against a busy background.
 *
 * Contrast is the caller's job: a light-on-dark code scans on some phones and
 * not others, so pass a dark foreground on a light background.
 */

export interface QrSvgOptions {
  /** Module colour. Default black. */
  fg?: string;
  /** Background colour, or "transparent" for none. Default white. */
  bg?: string;
  /** Quiet zone in modules. Default 4. */
  margin?: number;
  /** Sets width/height in px. Without it the SVG fills its container. */
  size?: number;
  /** Accessible name; adds role="img" and a <title>. */
  title?: string;
}

export interface QrPngOptions {
  fg?: string;
  bg?: string;
  /** Pixels per module. Default 10. */
  scale?: number;
  /** Quiet zone in modules. Default 4. */
  margin?: number;
}

const DEFAULT_FG = "#000000";
const DEFAULT_BG = "#ffffff";
const DEFAULT_MARGIN = 4;
const DEFAULT_SCALE = 10;

/** Object URLs stay alive long enough for the download to start everywhere. */
const REVOKE_DELAY_MS = 30_000;

interface Run {
  x: number;
  y: number;
  length: number;
}

function intOption(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isTransparent(color: string): boolean {
  const c = color.trim().toLowerCase();
  return c === "transparent" || c === "none" || c === "";
}

/** Colours and titles end up inside markup; never let one close an attribute. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The dark modules as horizontal runs. Drawing runs rather than single modules
 * keeps the SVG path short and avoids hairline seams between neighbours.
 */
function darkRuns(text: string): { size: number; runs: Run[] } {
  const { data, size } = encode(text, { ecc: "M", border: 0 });
  const runs: Run[] = [];
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!data[y][x]) {
        x += 1;
        continue;
      }
      let length = 1;
      while (x + length < size && data[y][x + length]) length += 1;
      runs.push({ x, y, length });
      x += length;
    }
  }
  return { size, runs };
}

/** An SVG document string: one background rect and one path. */
export function qrSvg(text: string, opts: QrSvgOptions = {}): string {
  const fg = opts.fg ?? DEFAULT_FG;
  const bg = opts.bg ?? DEFAULT_BG;
  const margin = intOption(opts.margin, DEFAULT_MARGIN, 0, 16);
  const { size, runs } = darkRuns(text);
  const total = size + margin * 2;

  const d = runs
    .map((run) => `M${run.x + margin} ${run.y + margin}h${run.length}v1h-${run.length}z`)
    .join("");

  const dimensions =
    opts.size !== undefined && Number.isFinite(opts.size) && opts.size > 0
      ? ` width="${Math.round(opts.size)}" height="${Math.round(opts.size)}"`
      : "";
  const a11y = opts.title ? ` role="img" aria-label="${escapeXml(opts.title)}"` : "";
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : "";
  const background = isTransparent(bg)
    ? ""
    : `<rect width="${total}" height="${total}" fill="${escapeXml(bg)}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"${dimensions}` +
    ` shape-rendering="crispEdges"${a11y}>${title}${background}` +
    `<path fill="${escapeXml(fg)}" d="${d}"/></svg>`
  );
}

/** A PNG of the code, `scale` pixels per module. Integer scaling keeps every edge sharp. */
export async function qrPngBlob(text: string, opts: QrPngOptions = {}): Promise<Blob> {
  const fg = opts.fg ?? DEFAULT_FG;
  const bg = opts.bg ?? DEFAULT_BG;
  const margin = intOption(opts.margin, DEFAULT_MARGIN, 0, 16);
  const scale = intOption(opts.scale, DEFAULT_SCALE, 1, 64);
  const { size, runs } = darkRuns(text);
  const pixels = (size + margin * 2) * scale;

  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser couldn't draw the QR code. Try the SVG download instead.");

  ctx.imageSmoothingEnabled = false;
  if (!isTransparent(bg)) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, pixels, pixels);
  }
  ctx.fillStyle = fg;
  for (const run of runs) {
    ctx.fillRect((run.x + margin) * scale, (run.y + margin) * scale, run.length * scale, scale);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Your browser couldn't save the QR code. Try the SVG download instead."));
    }, "image/png");
  });
}

/** Saves a blob as a file through a temporary link. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

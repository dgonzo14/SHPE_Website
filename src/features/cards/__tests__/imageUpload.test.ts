import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AVATAR_SPEC,
  BACKGROUND_SPEC,
  BANNER_SPEC,
  ImageProcessingError,
  MAX_INPUT_BYTES,
  computeCropRect,
  loadImage,
  renderCroppedImage,
  validateImageFile,
  type ImageCrop,
} from "../imageUpload";
import { CARD_LIMITS } from "../model";

function file(name: string, type: string, size = 1024): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

/** Small deterministic PRNG, so a failing case can be reproduced. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("specs", () => {
  it("match the shapes the card renders", () => {
    expect(AVATAR_SPEC).toEqual({ aspect: 1, width: 512 });
    expect(BANNER_SPEC).toEqual({ aspect: 3, width: 1200 });
    expect(BACKGROUND_SPEC).toEqual({ aspect: 2 / 3, width: 1080 });
  });
});

describe("validateImageFile", () => {
  it("accepts the formats every browser's canvas can decode", () => {
    expect(validateImageFile(file("a.jpg", "image/jpeg"))).toBeNull();
    expect(validateImageFile(file("a.png", "image/png"))).toBeNull();
    expect(validateImageFile(file("a.webp", "image/webp"))).toBeNull();
    expect(validateImageFile(file("a.gif", "image/gif"))).toBeNull();
    expect(validateImageFile(file("a.jpg", "image/jpg"))).toBeNull();
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(validateImageFile(file("photo.JPEG", ""))).toBeNull();
    expect(validateImageFile(file("notes.txt", ""))).toMatch(/JPEG, PNG, WebP or GIF/);
  });

  it("explains HEIC rather than just refusing it", () => {
    expect(validateImageFile(file("IMG_0001.HEIC", "image/heic"))).toMatch(/HEIC/);
    expect(validateImageFile(file("IMG_0001.heic", ""))).toMatch(/HEIC/);
  });

  it("refuses SVG, PDFs and anything else", () => {
    for (const [name, type] of [
      ["logo.svg", "image/svg+xml"],
      ["resume.pdf", "application/pdf"],
      ["a.bmp", "image/bmp"],
      ["a.tiff", "image/tiff"],
    ]) {
      expect(validateImageFile(file(name, type))).toBe("Choose a JPEG, PNG, WebP or GIF image.");
    }
  });

  it("refuses empty files and anything over 15 MB", () => {
    expect(validateImageFile(file("a.jpg", "image/jpeg", 0))).toMatch(/empty/);
    expect(validateImageFile(file("a.jpg", "image/jpeg", MAX_INPUT_BYTES))).toBeNull();
    expect(validateImageFile(file("a.jpg", "image/jpeg", MAX_INPUT_BYTES + 1))).toMatch(/15 MB/);
  });
});

describe("computeCropRect", () => {
  const EPS = 1e-9;

  it("cover-fits the aspect at zoom 1, centred", () => {
    expect(computeCropRect(4000, 3000, 1, { zoom: 1, x: 0, y: 0 })).toEqual({
      sx: 500,
      sy: 0,
      sw: 3000,
      sh: 3000,
    });
    expect(computeCropRect(1200, 1600, 3, { zoom: 1, x: 0, y: 0 })).toEqual({
      sx: 0,
      sy: 600,
      sw: 1200,
      sh: 400,
    });
  });

  it("zooms about the pan position and pans to the edges", () => {
    expect(computeCropRect(1000, 1000, 1, { zoom: 2, x: 0, y: 0 })).toEqual({
      sx: 250,
      sy: 250,
      sw: 500,
      sh: 500,
    });
    expect(computeCropRect(1000, 1000, 1, { zoom: 2, x: -1, y: 1 })).toEqual({
      sx: 0,
      sy: 500,
      sw: 500,
      sh: 500,
    });
    expect(computeCropRect(1000, 1000, 1, { zoom: 4, x: 1, y: -1 })).toEqual({
      sx: 750,
      sy: 0,
      sw: 250,
      sh: 250,
    });
  });

  it("clamps out-of-range and non-finite crop values", () => {
    const base = computeCropRect(1000, 800, 1, { zoom: 1, x: 0, y: 0 });
    expect(computeCropRect(1000, 800, 1, { zoom: Number.NaN, x: Number.NaN, y: Infinity })).toEqual({
      ...base,
      sy: 0,
      sx: base.sx,
    });
    expect(computeCropRect(1000, 800, 1, { zoom: 0.2, x: 0, y: 0 })).toEqual(base);
    expect(computeCropRect(1000, 800, 1, { zoom: 99, x: 0, y: 0 }).sw).toBe(200);
    expect(computeCropRect(1000, 800, 1, { zoom: 1, x: -50, y: 0 }).sx).toBe(0);
  });

  it("returns an empty rect for an image with no size", () => {
    expect(computeCropRect(0, 100, 1, { zoom: 1, x: 0, y: 0 })).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(computeCropRect(Number.NaN, 100, 1, { zoom: 1, x: 0, y: 0 })).toEqual({
      sx: 0,
      sy: 0,
      sw: 0,
      sh: 0,
    });
  });

  it("treats a nonsensical aspect as the image's own", () => {
    expect(computeCropRect(400, 200, 0, { zoom: 1, x: 0, y: 0 })).toEqual({ sx: 0, sy: 0, sw: 400, sh: 200 });
  });

  it("always stays inside the source and keeps the aspect, over many random inputs", () => {
    const random = mulberry32(20261006);
    const pick = <T,>(values: T[]) => values[Math.floor(random() * values.length)];
    const odd = [Number.NaN, Infinity, -Infinity];

    for (let i = 0; i < 5000; i += 1) {
      const srcW = Math.max(1, Math.round(random() * 8000));
      const srcH = Math.max(1, Math.round(random() * 8000));
      const aspect = pick([1, 3, 2 / 3, 0.1 + random() * 6]);
      const crop: ImageCrop = {
        zoom: random() < 0.05 ? pick(odd) : -1 + random() * 7,
        x: random() < 0.05 ? pick(odd) : -3 + random() * 6,
        y: random() < 0.05 ? pick(odd) : -3 + random() * 6,
      };
      const { sx, sy, sw, sh } = computeCropRect(srcW, srcH, aspect, crop);
      const context = JSON.stringify({ srcW, srcH, aspect, crop });

      expect(sw, context).toBeGreaterThan(0);
      expect(sh, context).toBeGreaterThan(0);
      expect(sx, context).toBeGreaterThanOrEqual(0);
      expect(sy, context).toBeGreaterThanOrEqual(0);
      expect(sx + sw, context).toBeLessThanOrEqual(srcW + EPS * srcW);
      expect(sy + sh, context).toBeLessThanOrEqual(srcH + EPS * srcH);
      expect(Math.abs(sw / sh - aspect) / aspect, context).toBeLessThan(1e-9);
      // Cover: at least one side spans the source at zoom 1.
      const zoom = Number.isFinite(crop.zoom) ? Math.min(4, Math.max(1, crop.zoom)) : 1;
      const spans = Math.max(sw / srcW, sh / srcH) * zoom;
      expect(Math.abs(spans - 1), context).toBeLessThan(1e-9);
    }
  });
});

describe("loadImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubImage(outcome: "load" | "error", size = { w: 640, h: 480 }) {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = "auto";
      naturalWidth = 0;
      naturalHeight = 0;
      width = 0;
      height = 0;
      set src(_value: string) {
        queueMicrotask(() => {
          if (outcome === "load") {
            this.naturalWidth = size.w;
            this.naturalHeight = size.h;
            this.onload?.();
          } else {
            this.onerror?.();
          }
        });
      }
    }
    vi.stubGlobal("Image", FakeImage);
    URL.createObjectURL = vi.fn(() => "blob:img");
    URL.revokeObjectURL = vi.fn();
  }

  it("resolves the decoded image and revokes its object URL", async () => {
    stubImage("load");
    const img = await loadImage(new Blob(["x"], { type: "image/png" }));
    expect(img.naturalWidth).toBe(640);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:img");
  });

  it("rejects with a member-facing error, and still revokes, when decoding fails", async () => {
    stubImage("error");
    await expect(loadImage(new Blob(["x"]))).rejects.toBeInstanceOf(ImageProcessingError);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:img");
  });

  it("rejects an image with no dimensions", async () => {
    stubImage("load", { w: 0, h: 0 });
    await expect(loadImage(new Blob(["x"]))).rejects.toThrow(/couldn't read that image/);
  });
});

describe("renderCroppedImage", () => {
  afterEach(() => vi.restoreAllMocks());

  interface FakeContext {
    drawImage: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fillStyle: string;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: string;
  }

  /**
   * jsdom has no canvas. `encoder` decides what toBlob produces for a request,
   * which is how each browser behaviour is simulated.
   */
  function mockCanvas(encoder: (type: string, quality: number, canvas: HTMLCanvasElement) => Blob | null) {
    const contexts = new Map<HTMLCanvasElement, FakeContext>();
    const requests: { type: string; quality: number; width: number; height: number }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      let ctx = contexts.get(this);
      if (!ctx) {
        ctx = {
          drawImage: vi.fn(),
          fillRect: vi.fn(),
          fillStyle: "",
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "low",
        };
        contexts.set(this, ctx);
      }
      return ctx as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement["getContext"]);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ) {
      requests.push({ type: type ?? "", quality: quality ?? 1, width: this.width, height: this.height });
      callback(encoder(type ?? "", quality ?? 1, this));
    });
    return { contexts, requests };
  }

  const sized = (bytes: number, type: string) => new Blob([new Uint8Array(bytes)], { type });
  const image = (w: number, h: number) =>
    ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;
  const crop = { zoom: 1, x: 0, y: 0 };

  it("encodes a WebP of the spec's size at quality 0.85", async () => {
    const { requests } = mockCanvas((type) => sized(40_000, type));
    const blob = await renderCroppedImage(image(1600, 1200), AVATAR_SPEC, crop);
    expect(blob.type).toBe("image/webp");
    expect(requests).toEqual([{ type: "image/webp", quality: 0.85, width: 512, height: 512 }]);
  });

  it("sizes banners and backgrounds by their aspect", async () => {
    const { requests } = mockCanvas((type) => sized(40_000, type));
    await renderCroppedImage(image(4000, 3000), BANNER_SPEC, crop);
    await renderCroppedImage(image(3000, 4000), BACKGROUND_SPEC, crop);
    expect(requests.map((r) => [r.width, r.height])).toEqual([
      [1200, 400],
      [1080, 1620],
    ]);
  });

  it("doesn't enlarge a small photo", async () => {
    const { requests } = mockCanvas((type) => sized(10_000, type));
    await renderCroppedImage(image(300, 200), AVATAR_SPEC, crop);
    expect(requests[0]).toMatchObject({ width: 200, height: 200 });
  });

  it("draws the framed region, stepping down large reductions", async () => {
    const { contexts } = mockCanvas((type) => sized(40_000, type));
    await renderCroppedImage(image(4000, 4000), AVATAR_SPEC, { zoom: 2, x: 1, y: -1 });
    const draws = [...contexts.values()].flatMap((ctx) => ctx.drawImage.mock.calls);
    // The first draw reads the member's region of the original: zoom 2 at the
    // top-right corner of a 4000 px square.
    expect(draws[0].slice(1, 5)).toEqual([2000, 0, 2000, 2000]);
    expect(draws.length).toBeGreaterThan(1);
    expect(draws.at(-1)!.slice(5)).toEqual([0, 0, 512, 512]);
  });

  it("re-encodes as JPEG on a white background where WebP isn't supported", async () => {
    // Older Safari answers a WebP request with a PNG.
    const { requests, contexts } = mockCanvas((type) =>
      type === "image/webp" ? sized(900_000, "image/png") : sized(50_000, type),
    );
    const blob = await renderCroppedImage(image(800, 800), AVATAR_SPEC, crop);
    expect(blob.type).toBe("image/jpeg");
    expect(requests.map((r) => r.type)).toEqual(["image/webp", "image/jpeg"]);
    const flattened = [...contexts.values()].find((ctx) => ctx.fillRect.mock.calls.length > 0);
    expect(flattened?.fillStyle).toBe("#ffffff");
  });

  it("lowers the quality until the file is under the bucket limit", async () => {
    const { requests } = mockCanvas((type, quality) =>
      sized(quality > 0.7 ? CARD_LIMITS.imageBytes : CARD_LIMITS.imageBytes - 1, type),
    );
    const blob = await renderCroppedImage(image(2000, 2000), BANNER_SPEC, crop);
    expect(blob.size).toBeLessThan(CARD_LIMITS.imageBytes);
    expect(requests.map((r) => r.quality)).toEqual([0.85, 0.75, 0.65]);
  });

  it("shrinks the image when even the lowest quality is too big", async () => {
    const { requests } = mockCanvas((type, _quality, canvas) =>
      sized(canvas.width >= 1200 ? CARD_LIMITS.imageBytes * 2 : 1000, type),
    );
    const blob = await renderCroppedImage(image(3600, 1200), BANNER_SPEC, crop);
    expect(blob.size).toBe(1000);
    expect(requests.at(-1)).toMatchObject({ width: 900, height: 300 });
  });

  it("fails with a readable message when nothing fits", async () => {
    mockCanvas((type) => sized(CARD_LIMITS.imageBytes * 2, type));
    await expect(renderCroppedImage(image(1000, 1000), AVATAR_SPEC, crop)).rejects.toThrow(
      /small enough to upload/,
    );
  });

  it("fails with a readable message when the browser can't encode at all", async () => {
    mockCanvas(() => null);
    await expect(renderCroppedImage(image(1000, 1000), AVATAR_SPEC, crop)).rejects.toBeInstanceOf(
      ImageProcessingError,
    );
  });

  it("fails cleanly without a 2D canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(renderCroppedImage(image(1000, 1000), AVATAR_SPEC, crop)).rejects.toThrow(
      /couldn't process that image/,
    );
  });
});

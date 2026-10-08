import { afterEach, describe, expect, it, vi } from "vitest";
import { encode } from "uqr";

import { downloadBlob, qrPngBlob, qrSvg } from "../qr";

const URL_TEXT = "https://washushpe.org/card/diego-gonzalez?src=qr";

/** Module count of the bare code, straight from the encoder. */
function modules(text: string): number {
  return encode(text, { ecc: "M", border: 0 }).size;
}

/** Rebuilds the module matrix from the SVG path, to check it against the encoder. */
function matrixFromSvg(svg: string, margin: number): boolean[][] {
  const d = /<path[^>]* d="([^"]*)"/.exec(svg)?.[1] ?? "";
  const total = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
  const grid = Array.from({ length: total - margin * 2 }, () =>
    Array.from({ length: total - margin * 2 }, () => false),
  );
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(run); i += 1) grid[Number(y) - margin][Number(x) - margin + i] = true;
  }
  return grid;
}

describe("qrSvg", () => {
  it("is one SVG with a square viewBox including the quiet zone, one rect and one path", () => {
    const svg = qrSvg(URL_TEXT);
    const total = modules(URL_TEXT) + 8;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${total} ${total}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg.match(/<rect /g)).toHaveLength(1);
    expect(svg).toContain(`<rect width="${total}" height="${total}" fill="#ffffff"/>`);
    expect(svg).toContain('<path fill="#000000"');
    expect(svg).not.toMatch(/ width="\d+" height="\d+" shape-rendering/);
  });

  it("parses as SVG", () => {
    const doc = new DOMParser().parseFromString(qrSvg(URL_TEXT, { title: "QR code" }), "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.nodeName).toBe("svg");
    expect(doc.querySelector("title")?.textContent).toBe("QR code");
  });

  it("draws exactly the encoder's dark modules", () => {
    for (const margin of [0, 2, 4]) {
      const svg = qrSvg(URL_TEXT, { margin });
      expect(matrixFromSvg(svg, margin)).toEqual(encode(URL_TEXT, { ecc: "M", border: 0 }).data);
    }
  });

  it("starts with the top-left finder pattern at the quiet-zone offset", () => {
    expect(qrSvg(URL_TEXT)).toContain('d="M4 4h7v1h-7z');
    expect(qrSvg(URL_TEXT, { margin: 0 })).toContain('d="M0 0h7v1h-7z');
  });

  it("is deterministic, and differs for different text", () => {
    expect(qrSvg(URL_TEXT)).toBe(qrSvg(URL_TEXT));
    expect(qrSvg(URL_TEXT)).not.toBe(qrSvg(`${URL_TEXT}x`));
  });

  it("takes theme colours, and omits the background when transparent", () => {
    const svg = qrSvg(URL_TEXT, { fg: "#1b365d", bg: "#fef2ee" });
    expect(svg).toContain('<path fill="#1b365d"');
    expect(svg).toContain('fill="#fef2ee"/>');
    expect(qrSvg(URL_TEXT, { bg: "transparent" })).not.toContain("<rect");
  });

  it("escapes attribute values, so a colour or title can't inject markup", () => {
    const svg = qrSvg(URL_TEXT, { fg: '"/><script>alert(1)</script>', title: "<b>&'" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&quot;/&gt;&lt;script&gt;");
    expect(svg).toContain("<title>&lt;b&gt;&amp;&apos;</title>");
  });

  it("sets pixel dimensions only when asked, and clamps a silly margin", () => {
    expect(qrSvg(URL_TEXT, { size: 256 })).toContain('width="256" height="256"');
    const total = modules(URL_TEXT) + 32;
    expect(qrSvg(URL_TEXT, { margin: 1000 })).toContain(`viewBox="0 0 ${total} ${total}"`);
    const bare = modules(URL_TEXT);
    expect(qrSvg(URL_TEXT, { margin: -3 })).toContain(`viewBox="0 0 ${bare} ${bare}"`);
  });

  it("keeps a chip-length card URL small enough to scan easily", () => {
    // Version 4 (33 modules) or below at ECC M for a typical card URL.
    expect(modules(URL_TEXT)).toBeLessThanOrEqual(33);
  });
});

describe("qrPngBlob", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockCanvas(blob: Blob | null) {
    const ctx = { fillRect: vi.fn(), fillStyle: "", imageSmoothingEnabled: true };
    const fills: string[] = [];
    ctx.fillRect.mockImplementation(() => fills.push(ctx.fillStyle));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (callback: BlobCallback) {
        callback(blob);
      });
    return { ctx, fills, toBlob };
  }

  it("paints the background, then every dark run, at the requested scale", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const { ctx, fills, toBlob } = mockCanvas(png);
    const createElement = vi.spyOn(document, "createElement");

    await expect(qrPngBlob(URL_TEXT, { fg: "#1b365d", bg: "#ffffff", scale: 8 })).resolves.toBe(png);

    const canvas = createElement.mock.results[0].value as HTMLCanvasElement;
    const total = (modules(URL_TEXT) + 8) * 8;
    expect(canvas.width).toBe(total);
    expect(canvas.height).toBe(total);
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, total, total]);
    expect(fills[0]).toBe("#ffffff");
    expect(fills.slice(1).every((f) => f === "#1b365d")).toBe(true);
    // The first run is the finder pattern's top edge, 7 modules wide.
    expect(ctx.fillRect.mock.calls[1]).toEqual([32, 32, 56, 8]);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
  });

  it("leaves the background clear when transparent", async () => {
    const { fills } = mockCanvas(new Blob(["png"], { type: "image/png" }));
    await qrPngBlob(URL_TEXT, { bg: "transparent" });
    expect(fills.every((f) => f === "#000000")).toBe(true);
  });

  it("rejects with a readable message when the browser can't produce the PNG", async () => {
    mockCanvas(null);
    await expect(qrPngBlob(URL_TEXT)).rejects.toThrow(/couldn't save the QR code/);
  });

  it("rejects when there's no 2D canvas at all", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(qrPngBlob(URL_TEXT)).rejects.toThrow(/couldn't draw the QR code/);
  });
});

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks a temporary download link and revokes the object URL afterwards", () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:qr");
    URL.revokeObjectURL = vi.fn();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    downloadBlob(new Blob(["x"]), "diego-gonzalez-qr.svg");

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("diego-gonzalez-qr.svg");
    expect(clicked[0].href).toBe("blob:qr");
    expect(clicked[0].isConnected).toBe(false);
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:qr");
  });
});

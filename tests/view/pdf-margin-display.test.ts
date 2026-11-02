/**
 * A PDF page with a margin is drawn from the rasters of the page it was
 * before the margin: dragging the margin's width must never render the PDF
 * again (it went blank at every step, Joost 2026-11-02).
 */
import { describe, expect, it, vi } from "vitest";
import { type PdfBackdropCache } from "../../src/view/pdf-backdrop";
import { wholePageScale } from "../../src/canvas/pdf-raster";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { VaultBackdropRenderer } = await import("../../src/view/backdrop-renderer");
const { InkSurface } = await import("../../src/view/ink-surface");

const plain = { kind: "pdf" as const, path: "Slides.pdf", page: 3 };
const before = { width: 1000, height: 1400 };

function cacheStub() {
  return {
    setVisibleRegions: vi.fn(),
    memoryBudget: { soft: 48 * 1024 * 1024 },
    detailCovers: vi.fn(() => true),
    detailPatches: vi.fn(() => []),
    peek: vi.fn(() => ({ ok: true, canvas: { width: 500, height: 700 } })),
    peekNearest: vi.fn(() => null),
    request: vi.fn(),
  };
}

function context() {
  return {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { translate: ReturnType<typeof vi.fn> };
}

describe("a PDF page with a margin", () => {
  it("asks for the same page image at every margin width", () => {
    const keys: unknown[] = [];
    for (const [left, right] of [
      [0, 0],
      [0, 330],
      [0, 600],
      [400, 0],
      [250, 250],
    ]) {
      const cache = cacheStub();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      const frame = { x: left, y: 0, width: 1000, height: 1400 };
      const backdrop = left || right ? { ...plain, frame } : plain;
      const geometry = { width: 1000 + left + right, height: 1400 };
      const region = { minX: 0, minY: 0, maxX: geometry.width, maxY: 1400 };
      painter.prepare([{ backdrop, geometry, region }], 2, false);
      keys.push(cache.setVisibleRegions.mock.calls[0][0][0]);
    }
    const unframed = {
      path: plain.path,
      page: plain.page,
      dprScale: Math.min(2, wholePageScale(before)),
      area: { geometry: before },
    };
    for (const key of keys) expect(key).toEqual(unframed);
  });

  it("paints that image moved into the frame", () => {
    const cache = cacheStub();
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    const ctx = context();
    const frame = { x: 400, y: 0, width: 1000, height: 1400 };
    painter.paint(ctx, { ...plain, frame }, { width: 1400, height: 1400 }, 1, { deviceScale: 2 });
    expect(ctx.translate).toHaveBeenCalledWith(400, 0);
    expect(cache.peek).toHaveBeenCalledWith(plain.path, plain.page, expect.any(Number), {
      geometry: before,
    });
  });

  it("repaints when that image lands, though the page is wider than it", () => {
    const page = {
      id: "p1",
      geometry: { width: 1330, height: 1400 },
      backdrop: { ...plain, frame: { x: 330, y: 0, width: 1000, height: 1400 } },
      strokes: [],
      images: [],
      textBoxes: [],
    };
    const renderer = { refreshPage: vi.fn(), invalidateBackdrop: vi.fn() };
    const surface = Object.assign(Object.create(InkSurface.prototype) as object, {
      doc: { pages: [page] },
      renderer,
      requestFrame: vi.fn(),
    }) as unknown as { pdfPageReady: (path: string, page: number, area?: unknown) => void };
    surface.pdfPageReady(plain.path, plain.page, { geometry: before });
    expect(renderer.refreshPage).toHaveBeenCalledWith(0);
    const region = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    surface.pdfPageReady(plain.path, plain.page, { geometry: before, region });
    expect(renderer.invalidateBackdrop).toHaveBeenCalledWith(0, {
      minX: 330,
      minY: 0,
      maxX: 430,
      maxY: 100,
    });
  });
});

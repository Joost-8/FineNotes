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
});

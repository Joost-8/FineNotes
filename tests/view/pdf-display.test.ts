import { describe, expect, it, vi } from "vitest";
import { type PdfBackdropCache } from "../../src/view/pdf-backdrop";
import { type PdfRenderArea } from "../../src/canvas/pdf-raster";
import { blankPage } from "../../src/model/document";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { VaultBackdropRenderer } = await import("../../src/view/backdrop-renderer");
const { InkSurface } = await import("../../src/view/ink-surface");
const geometry = { width: 1200, height: 1600 };
const backdrop = { kind: "pdf" as const, path: "Lecture.pdf", page: 2 };
function context() {
  return {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}
describe("PDF backdrop display", () => {
  it("uses the settled tile resolution even above the old scale limit, and draws at page coordinates", () => {
    const canvas = { width: 512, height: 512 };
    const cache = {
      peek: vi.fn(() => ({ ok: true, canvas, box: { x: 128, y: 256, w: 64, h: 64 } })),
    };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    painter.setDeviceScale(1);
    const ctx = context();
    const region = { minX: 128, minY: 256, maxX: 192, maxY: 320 };
    painter.paint(ctx, backdrop, geometry, 1, { deviceScale: 8, region });
    expect(cache.peek).toHaveBeenCalledWith(backdrop.path, backdrop.page, 8, { geometry, region });
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 128, 256, 64, 64);
  });
  it("warms exactly the same resolution key a thumbnail paints with", async () => {
    const entry = {
      ok: true,
      canvas: { width: 600, height: 800 },
      box: { x: 0, y: 0, w: 1200, h: 1600 },
    };
    const cache = { resolve: vi.fn(async () => entry), peek: vi.fn(() => entry) };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    painter.setDeviceScale(0.7);
    await painter.draw(context(), backdrop, geometry);
    painter.paint(context(), backdrop, geometry, 1, { deviceScale: 0.7 });
    expect(cache.resolve.mock.calls[0]).toEqual(cache.peek.mock.calls[0]);
  });
  it("requests only the missing tile region without blocking the paint", () => {
    const cache = { peek: vi.fn(() => null), request: vi.fn() };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    const region = { minX: 0, minY: 0, maxX: 64, maxY: 64 };
    painter.paint(context(), backdrop, geometry, 1, { deviceScale: 8, region });
    expect(cache.request).toHaveBeenCalledWith(backdrop.path, backdrop.page, 8, {
      geometry,
      region,
    });
  });
  it("invalidates only matching PDF page regions when a tile lands", () => {
    const first = { ...blankPage("p1", geometry), backdrop };
    const unrelated = { ...blankPage("p2", geometry), backdrop: { ...backdrop, page: 0 } };
    const resized = { ...blankPage("p3", { width: 500, height: 500 }), backdrop };
    const renderer = { invalidateRegion: vi.fn(), invalidatePage: vi.fn() };
    const state = Object.assign(Object.create(InkSurface.prototype) as object, {
      doc: { pages: [first, unrelated, resized] },
      renderer,
      requestFrame: vi.fn(),
    });
    const area: PdfRenderArea = { geometry, region: { minX: 10, minY: 20, maxX: 74, maxY: 84 } };
    (
      state as unknown as { pdfPageReady(path: string, page: number, area: PdfRenderArea): void }
    ).pdfPageReady(backdrop.path, backdrop.page, area);
    expect(renderer.invalidateRegion).toHaveBeenCalledExactlyOnceWith(0, area.region);
    expect(renderer.invalidatePage).not.toHaveBeenCalled();
  });
});

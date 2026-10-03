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
  it("asks for the visible area plus its margin once above 2.5x, and draws cached patches over the page", () => {
    const canvas = { width: 512, height: 512 };
    const base = { width: 600, height: 800 };
    const patch = { ok: true, canvas, box: { x: 112, y: 240, w: 96, h: 96 } };
    const cache = {
      setVisibleRegions: vi.fn(),
      detailCovers: vi.fn(() => false),
      detailPatches: vi.fn(() => [patch]),
      peek: vi.fn(() => ({ ok: true, canvas: base })),
    };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    const ctx = context();
    const region = { minX: 128, minY: 256, maxX: 192, maxY: 320 };
    painter.prepare([{ backdrop, geometry, region }], 8, 4, false);
    for (let i = 0; i < 30; i++)
      painter.paint(ctx, backdrop, geometry, 1, { deviceScale: 8, region });
    // 25% of the 64 px view on each side.
    const margin = { minX: 112, minY: 240, maxX: 208, maxY: 336 };
    expect(cache.setVisibleRegions).toHaveBeenCalledExactlyOnceWith(
      [
        {
          path: backdrop.path,
          page: backdrop.page,
          dprScale: 8,
          area: { geometry, region: margin },
        },
      ],
      [{ path: backdrop.path, page: backdrop.page, dprScale: 8, geometry, region }],
    );
    expect(cache.detailPatches).toHaveBeenCalledWith(backdrop.path, backdrop.page, 8, geometry);
    expect(ctx.drawImage).toHaveBeenCalledWith(base, 0, 0, 1200, 1600);
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 112, 240, 96, 96);
  });
  it("asks for nothing new when a cached patch already covers the view", () => {
    const cache = {
      setVisibleRegions: vi.fn(),
      detailCovers: vi.fn(() => true),
      detailPatches: vi.fn(() => []),
      peek: vi.fn(() => null),
    };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    const region = { minX: 128, minY: 256, maxX: 192, maxY: 320 };
    painter.prepare([{ backdrop, geometry, region }], 8, 4, false);
    expect(cache.detailCovers).toHaveBeenCalledWith(
      backdrop.path,
      backdrop.page,
      8,
      geometry,
      region,
    );
    expect(cache.setVisibleRegions).toHaveBeenCalledExactlyOnceWith(
      [],
      [{ path: backdrop.path, page: backdrop.page, dprScale: 8, geometry, region }],
    );
  });
  it("draws only the cached patches that meet a tile", () => {
    const near = { ok: true, canvas: { width: 8, height: 8 }, box: { x: 0, y: 0, w: 64, h: 64 } };
    const far = {
      ok: true,
      canvas: { width: 8, height: 8 },
      box: { x: 900, y: 900, w: 64, h: 64 },
    };
    const cache = {
      setVisibleRegions: vi.fn(),
      detailCovers: vi.fn(() => true),
      detailPatches: vi.fn(() => [near, far]),
      peek: vi.fn(() => ({ ok: true, canvas: { width: 600, height: 800 } })),
    };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    painter.prepare(
      [{ backdrop, geometry, region: { minX: 0, minY: 0, maxX: 64, maxY: 64 } }],
      8,
      4,
      false,
    );
    // A tile drawn while the view moves (prepare transient) still uses them.
    painter.prepare([], 8, 4, true);
    const ctx = context();
    painter.paint(ctx, backdrop, geometry, 1, {
      deviceScale: 8,
      region: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
    });
    expect(ctx.drawImage).toHaveBeenCalledWith(near.canvas, 0, 0, 64, 64);
    expect(ctx.drawImage).not.toHaveBeenCalledWith(far.canvas, 900, 900, 64, 64);
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
  it("uses one whole-page key at ordinary zoom and no tile regions", () => {
    const cache = {
      peek: vi.fn(() => null),
      peekNearest: vi.fn(() => null),
      request: vi.fn(),
      setVisibleRegions: vi.fn(),
    };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    const region = { minX: 0, minY: 0, maxX: 64, maxY: 64 };
    painter.prepare([{ backdrop, geometry, region }], 2, 2.5, false);
    for (let i = 0; i < 30; i++)
      painter.paint(context(), backdrop, geometry, 1, {
        deviceScale: 2,
        region: { ...region, minX: i },
      });
    expect(cache.setVisibleRegions).toHaveBeenCalledExactlyOnceWith([], []);
    expect(cache.request).toHaveBeenCalledWith(backdrop.path, backdrop.page, 2, { geometry });
    expect(new Set(cache.request.mock.calls.map((args) => JSON.stringify(args))).size).toBe(1);
  });
  it("does not mint page or region rasters during pinch zoom, and never requests detail for thumbnails", () => {
    const cache = {
      peek: vi.fn(() => null),
      peekNearest: vi.fn(() => null),
      request: vi.fn(),
      setVisibleRegions: vi.fn(),
      detailCovers: vi.fn(() => false),
      detailPatches: vi.fn(() => []),
    };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    const region = { minX: 10, minY: 10, maxX: 100, maxY: 100 };
    painter.prepare([{ backdrop, geometry, region }], 2, 1, false);
    for (let zoom = 1; zoom < 6; zoom += 0.2) {
      painter.prepare([{ backdrop, geometry, region }], 2, zoom, true);
      painter.paint(context(), backdrop, geometry, 1, { deviceScale: 2, region });
    }
    expect(cache.setVisibleRegions.mock.calls.every(([areas]) => areas.length === 0)).toBe(true);
    expect(new Set(cache.request.mock.calls.map((args) => JSON.stringify(args))).size).toBe(1);
    painter.prepare([{ backdrop, geometry, region }], 8, 4, false);
    cache.peek.mockClear();
    painter.paint(context(), backdrop, geometry, 1, { deviceScale: 0.5 });
    expect(cache.peek).toHaveBeenCalledOnce();
    expect(cache.peek).toHaveBeenCalledWith(backdrop.path, backdrop.page, 4, { geometry });
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
  describe("with the PDF worker", () => {
    const tileCache = () => ({
      usesWorker: true,
      setVisibleRegions: vi.fn(),
      detailCovers: vi.fn(() => false),
      detailPatches: vi.fn(() => []),
      peek: vi.fn(() => null),
    });
    // At 8 device px per page px a tile is 64 page px: this view is tiles 2-3 by 4-5.
    const view = { minX: 140, minY: 270, maxX: 250, maxY: 380 };

    it("asks for the grid tiles on screen, nearest the middle first, even while moving", () => {
      const cache = tileCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      painter.prepare([{ backdrop, geometry, region: view }], 8, 4, false, true);
      const [requests, shown] = cache.setVisibleRegions.mock.calls[0];
      expect(shown).toEqual([
        { path: backdrop.path, page: backdrop.page, dprScale: 8, geometry, region: view },
      ]);
      const regions = requests.map((r: { area: { region: unknown } }) => r.area.region);
      expect(regions).toHaveLength(4);
      // The middle of the view is x 195, y 325: tile 3,5 (192-256, 320-384) is nearest.
      expect(regions[0]).toEqual({ minX: 192, minY: 320, maxX: 256, maxY: 384 });
      expect(requests.every((r: { dprScale: number }) => r.dprScale === 8)).toBe(true);
      expect(cache.detailCovers).not.toHaveBeenCalled();
    });

    it("reaches one column ahead the way the view moves", () => {
      const cache = tileCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      painter.prepare([{ backdrop, geometry, region: view }], 8, 4, false, true);
      const right = { ...view, minX: view.minX + 10, maxX: view.maxX + 10 };
      painter.prepare([{ backdrop, geometry, region: right }], 8, 4, false, true);
      const requests = cache.setVisibleRegions.mock.calls[1][0];
      expect(
        requests.some((r: { area: { region: { minX: number } } }) => r.area.region.minX === 256),
      ).toBe(true);
    });

    it("asks for nothing mid-zoom, nor at or below 2.5x", () => {
      const cache = tileCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      painter.prepare([{ backdrop, geometry, region: view }], 8, 4, true, true);
      expect(cache.setVisibleRegions).not.toHaveBeenCalled();
      painter.prepare([{ backdrop, geometry, region: view }], 5, 2.5, false, false);
      expect(cache.setVisibleRegions).toHaveBeenCalledExactlyOnceWith([], []);
    });

    it("without the worker, still waits until the view rests", () => {
      const cache = { ...tileCache(), usesWorker: false };
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      painter.prepare([{ backdrop, geometry, region: view }], 8, 4, false, true);
      expect(cache.setVisibleRegions).not.toHaveBeenCalled();
      painter.prepare([{ backdrop, geometry, region: view }], 8, 4, false, false);
      expect(cache.setVisibleRegions).toHaveBeenCalledOnce();
      expect(cache.detailCovers).toHaveBeenCalledOnce();
    });
  });
});

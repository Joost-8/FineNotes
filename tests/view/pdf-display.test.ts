import { describe, expect, it, vi } from "vitest";
import { type PdfBackdropCache } from "../../src/view/pdf-backdrop";
import { type PdfRenderArea, wholePageScale } from "../../src/canvas/pdf-raster";
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
  it("asks for the visible area plus its margin where the page image falls short, and draws cached patches over the page", () => {
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
    painter.prepare([{ backdrop, geometry, region }], 8, false);
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
    painter.prepare([{ backdrop, geometry, region }], 8, false);
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
      false,
    );
    // A tile drawn while the view moves (prepare transient) still uses them.
    painter.prepare([], 8, true);
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
  it("uses one whole-page key, at exactly the tiles' level, while that is sharp enough", () => {
    const cache = {
      peek: vi.fn(() => null),
      peekNearest: vi.fn(() => null),
      request: vi.fn(),
      setVisibleRegions: vi.fn(),
    };
    const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
    const region = { minX: 0, minY: 0, maxX: 64, maxY: 64 };
    // 1200 x 1600 page px: a whole page is at most 1.44 device px per page px.
    painter.prepare([{ backdrop, geometry, region }], 1.3712, false);
    for (let i = 0; i < 30; i++)
      painter.paint(context(), backdrop, geometry, 1, {
        deviceScale: 1.3712,
        region: { ...region, minX: i },
      });
    expect(cache.setVisibleRegions).toHaveBeenCalledExactlyOnceWith([], []);
    expect(cache.request).toHaveBeenCalledWith(backdrop.path, backdrop.page, 1.3712, { geometry });
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
    painter.prepare([{ backdrop, geometry, region }], 1, false);
    for (let level = 1; level < 6; level += 0.2) {
      painter.prepare([{ backdrop, geometry, region }], level, true);
      painter.paint(context(), backdrop, geometry, 1, { deviceScale: level, region });
    }
    expect(cache.setVisibleRegions.mock.calls.every(([areas]) => areas.length === 0)).toBe(true);
    expect(new Set(cache.request.mock.calls.map((args) => JSON.stringify(args))).size).toBe(1);
    // Settled past what a whole page can be, the page image is the sharpest one.
    painter.prepare([{ backdrop, geometry, region }], 8, false);
    cache.peek.mockClear();
    painter.paint(context(), backdrop, geometry, 1, { deviceScale: 0.5 });
    expect(cache.peek).toHaveBeenCalledOnce();
    expect(cache.peek).toHaveBeenCalledWith(
      backdrop.path,
      backdrop.page,
      wholePageScale(geometry),
      { geometry },
    );
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
  describe("an A4 study sheet on an iPad (FineNotes#80)", () => {
    const a4 = { width: 595.28, height: 841.89 };
    const sheet = { kind: "pdf" as const, path: "pcos.pdf", page: 0 };
    const workerCache = () => ({
      usesWorker: true,
      setVisibleRegions: vi.fn(),
      detailCovers: vi.fn(() => false),
      detailPatches: vi.fn(() => []),
      peek: vi.fn(() => null),
      peekNearest: vi.fn(() => null),
      request: vi.fn(),
    });

    it("at the default zoom draws the page from a raster at exactly the screen's resolution", () => {
      const cache = workerCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      const region = { minX: 0, minY: 0, maxX: 595.28, maxY: 536 };
      // Capture A: zoom 0.68, level 1.36.
      painter.prepare([{ backdrop: sheet, geometry: a4, region }], 1.36, false);
      painter.paint(context(), sheet, a4, 1, { deviceScale: 1.36, region });
      expect(cache.request).toHaveBeenCalledExactlyOnceWith(sheet.path, sheet.page, 1.36, {
        geometry: a4,
      });
      expect(cache.setVisibleRegions).toHaveBeenCalledExactlyOnceWith([], []);
      expect(cache.detailPatches).not.toHaveBeenCalled();
    });

    it("at 2x draws sharp tiles over the page instead of stretching it", () => {
      const cache = workerCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      // Capture B: zoom 1.99, level 3.98, the view 2698 x 1458 device px.
      const region = { minX: 119, minY: 181, maxX: 119 + 678, maxY: 181 + 366 };
      painter.prepare([{ backdrop: sheet, geometry: a4, region }], 3.98, false);
      const [requests, shown] = cache.setVisibleRegions.mock.calls[0];
      expect(shown).toHaveLength(1);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((r: { dprScale: number }) => r.dprScale === 3.98)).toBe(true);
      painter.paint(context(), sheet, a4, 1, { deviceScale: 3.98, region });
      expect(cache.detailPatches).toHaveBeenCalledWith(sheet.path, sheet.page, 3.98, a4);
      // Under the tiles, the sharpest page image that fits, not one at 3.98.
      expect(cache.request).toHaveBeenCalledWith(sheet.path, sheet.page, wholePageScale(a4), {
        geometry: a4,
      });
    });

    it("decides per page: a slide beside it needs no tiles at a level the A4 page does", () => {
      const cache = workerCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      const slide = { width: 720, height: 405 };
      const deck = { kind: "pdf" as const, path: "deck.pdf", page: 0 };
      painter.prepare(
        [
          { backdrop: sheet, geometry: a4, region: { minX: 0, minY: 0, maxX: 300, maxY: 300 } },
          { backdrop: deck, geometry: slide, region: { minX: 0, minY: 0, maxX: 300, maxY: 300 } },
        ],
        3.2,
        false,
      );
      const [requests, shown] = cache.setVisibleRegions.mock.calls[0];
      expect(shown.map((v: { path: string }) => v.path)).toEqual([sheet.path]);
      expect(requests.every((r: { path: string }) => r.path === sheet.path)).toBe(true);
      painter.paint(context(), deck, slide, 1, { deviceScale: 3.2 });
      expect(cache.request).toHaveBeenCalledWith(deck.path, deck.page, 3.2, { geometry: slide });
    });
  });

  describe("with the PDF worker", () => {
    const tileCache = () => ({
      usesWorker: true,
      setVisibleRegions: vi.fn(),
      detailCovers: vi.fn(() => false),
      detailPatches: vi.fn(() => []),
      peek: vi.fn(() => null),
    });
    // At 16 device px per page px a tile is 64 page px: this view is tiles 2-3 by 4-5.
    const view = { minX: 140, minY: 270, maxX: 250, maxY: 380 };

    it("asks for the grid tiles on screen, nearest the middle first, even while moving", () => {
      const cache = tileCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      painter.prepare([{ backdrop, geometry, region: view }], 16, false, true);
      const [requests, shown] = cache.setVisibleRegions.mock.calls[0];
      expect(shown).toEqual([
        { path: backdrop.path, page: backdrop.page, dprScale: 16, geometry, region: view },
      ]);
      const regions = requests.map((r: { area: { region: unknown } }) => r.area.region);
      expect(regions).toHaveLength(4);
      // The middle of the view is x 195, y 325: tile 3,5 (192-256, 320-384) is nearest.
      expect(regions[0]).toEqual({ minX: 192, minY: 320, maxX: 256, maxY: 384 });
      expect(requests.every((r: { dprScale: number }) => r.dprScale === 16)).toBe(true);
      expect(cache.detailCovers).not.toHaveBeenCalled();
    });

    it("reaches one column ahead the way the view moves", () => {
      const cache = tileCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      painter.prepare([{ backdrop, geometry, region: view }], 16, false, true);
      const right = { ...view, minX: view.minX + 10, maxX: view.maxX + 10 };
      painter.prepare([{ backdrop, geometry, region: right }], 16, false, true);
      const requests = cache.setVisibleRegions.mock.calls[1][0];
      expect(
        requests.some((r: { area: { region: { minX: number } } }) => r.area.region.minX === 256),
      ).toBe(true);
    });

    it("asks for nothing mid-zoom, nor where the page image is sharp enough", () => {
      const cache = tileCache();
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      painter.prepare([{ backdrop, geometry, region: view }], 16, true, true);
      expect(cache.setVisibleRegions).not.toHaveBeenCalled();
      painter.prepare([{ backdrop, geometry, region: view }], 1.4, false, false);
      expect(cache.setVisibleRegions).toHaveBeenCalledExactlyOnceWith([], []);
    });

    it("without the worker, still waits until the view rests", () => {
      const cache = { ...tileCache(), usesWorker: false };
      const painter = new VaultBackdropRenderer(cache as unknown as PdfBackdropCache);
      painter.prepare([{ backdrop, geometry, region: view }], 8, false, true);
      expect(cache.setVisibleRegions).not.toHaveBeenCalled();
      painter.prepare([{ backdrop, geometry, region: view }], 8, false, false);
      expect(cache.setVisibleRegions).toHaveBeenCalledOnce();
      expect(cache.detailCovers).toHaveBeenCalledOnce();
    });
  });
});

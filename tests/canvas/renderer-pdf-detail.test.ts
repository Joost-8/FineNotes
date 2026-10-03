import { describe, expect, it, vi } from "vitest";
import { Renderer, type BackdropPainter } from "../../src/canvas/renderer";
import { blankPage, type InkDocument } from "../../src/model/document";

describe("renderer visible PDF request boundary", () => {
  it("prepares the page-local viewport once, independently of the ink tile grid", () => {
    const page = blankPage("p1", { width: 1000, height: 1000 });
    page.backdrop = { kind: "pdf", path: "slides.pdf", page: 0 };
    const box = { index: 0, x: 0, y: 0, width: 1000, height: 1000 };
    const ctx = { drawImage: vi.fn(), setTransform: vi.fn() };
    const prepare = vi.fn();
    const rasterTile = vi.fn(() => ({ canvas: {} }));
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      dry: { canvas: { width: 600, height: 400 }, ctx },
      screen: { dpr: 2 },
      view: { scale: 4, scrollY: 25, width: 1000 },
      originX: -100,
      level: 8,
      pdfZoom: 4,
      painter: { paint: vi.fn(), prepare } as BackdropPainter,
      wipe: vi.fn(),
      boxesOnScreen: () => [box],
      tiles: { has: () => false, get: () => undefined },
      previews: { get: () => undefined },
      rasterTile,
    }) as Renderer;
    const doc = { pages: [page] } as InkDocument;
    renderer.renderDocument(doc, false);
    expect(prepare).toHaveBeenCalledExactlyOnceWith(
      [
        {
          backdrop: page.backdrop,
          geometry: page.geometry,
          region: { minX: 25, minY: 25, maxX: 100, maxY: 75 },
        },
      ],
      8,
      4,
      false,
    );
    expect(rasterTile.mock.calls.length).toBeGreaterThan(1);
    prepare.mockClear();
    renderer.renderDocument(doc, false, undefined, null, undefined, Infinity, true);
    expect(prepare.mock.calls[0][3]).toBe(true);
  });
});

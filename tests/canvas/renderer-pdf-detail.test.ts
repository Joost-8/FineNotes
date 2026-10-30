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
      painter: { paint: vi.fn(), prepare } as BackdropPainter,
      wipe: vi.fn(),
      boxesOnScreen: () => [box],
      layout: { boxes: [box] },
      lastLook: null,
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
      false,
      false,
      // The only page is on screen: none near it.
      [],
    );
    expect(rasterTile.mock.calls.length).toBeGreaterThan(1);
    prepare.mockClear();
    renderer.renderDocument(doc, false, undefined, null, undefined, Infinity, true);
    // Moving is passed on as such, not as a zoom in progress.
    expect(prepare.mock.calls[0][2]).toBe(false);
    expect(prepare.mock.calls[0][3]).toBe(true);
  });
});

describe("the pages a scroll shows next, for the painter (FineNotes#80)", () => {
  it("hands over the pages near the view, the way it moves first", () => {
    const pages = Array.from({ length: 20 }, (_, i) => {
      const page = blankPage(`p${i}`, { width: 1024, height: 1448 });
      page.backdrop = { kind: "pdf", path: "Handout.pdf", page: i };
      return page;
    });
    const boxes = pages.map((page, index) => ({
      index,
      id: page.id,
      x: 0,
      y: index * 1472,
      width: 1024,
      height: 1448,
    }));
    // An iPad's 820 x 1180 CSS px at 55% (scale 0.43): about two pages in view.
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      screen: { width: 820, height: 1180, dpr: 2 },
      view: { scale: 0.43, scrollY: 5 * 1472, width: 1024 },
      originX: 0,
      layout: { boxes },
      lastLook: null,
    }) as Renderer;
    const doc = { pages } as InkDocument;
    const near = (scrollY: number) => {
      (renderer as unknown as { view: { scrollY: number } }).view.scrollY = scrollY;
      return (
        renderer as unknown as {
          nearPages(doc: InkDocument): Array<{ backdrop: { page: number } }>;
        }
      )
        .nearPages(doc)
        .map((n) => n.backdrop.page);
    };
    // Pages 5, 6 and 7 are in view; page 8 starts 672 px below it, page 4
    // ends 1024 px above.
    const at = 5 * 1472 + 1000;
    near(at);
    const down = near(at + 40);
    expect(down[0]).toBe(8);
    for (const index of [5, 6, 7]) expect(down).not.toContain(index);
    // Back up, page 4 is the one coming: at half its distance, before page 8.
    const up = near(at);
    expect(up[0]).toBe(4);
    expect(up.indexOf(4)).toBeLessThan(up.indexOf(8));
  });
});

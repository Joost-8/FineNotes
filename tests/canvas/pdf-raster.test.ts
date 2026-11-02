import { describe, expect, it } from "vitest";
import type { Bounds } from "../../src/model/document";
import {
  DETAIL_MARGIN,
  boundsCover,
  boundsMeet,
  detailPdfArea,
  needsDetail,
  pageRasterScale,
  pdfAreaKey,
  planPdfRaster,
  visiblePdfArea,
  wholePageScale,
} from "../../src/canvas/pdf-raster";

const source = { width: 600, height: 800 };
const geometry = { width: 1024, height: 4096 / 3 };
describe("PDF display raster planning", () => {
  it("matches notebook pixels, rather than confusing source PDF points with page pixels", () => {
    const plan = planPdfRaster(source, 2, {
      geometry,
      region: { minX: 0, minY: 0, maxX: 256, maxY: 256 },
    });
    expect(plan.width).toBe(512);
    expect(plan.height).toBe(512);
    expect(plan.sourceScale).toBeCloseTo((1024 / 600) * 2);
  });
  it("renders deep zoom from the original PDF with no whole-page edge limit", () => {
    const plan = planPdfRaster(source, 12, {
      geometry,
      region: { minX: 100, minY: 200, maxX: 100 + 512 / 12, maxY: 200 + 512 / 12 },
    });
    expect(plan.sourceScale).toBeCloseTo((1024 / 600) * 12);
    expect(plan.width).toBeLessThanOrEqual(513);
    expect(plan.height).toBeLessThanOrEqual(513);
    expect(plan.transform.slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(plan.transform[4]).toBeCloseTo(-1200);
    expect(plan.transform[5]).toBeCloseTo(-2400);
    expect(plan.box.x).toBe(100);
    expect(plan.box.y).toBe(200);
    expect(plan.width * plan.height * 4).toBeLessThan(2 * 1024 * 1024);
  });
  it("contains and centers a PDF when the notebook page has a different aspect", () => {
    const plan = planPdfRaster(source, 1, {
      geometry: { width: 1000, height: 1000 },
      region: { minX: 100, minY: 200, maxX: 500, maxY: 600 },
    });
    expect(plan.sourceScale).toBe(1.25);
    expect(plan.transform).toEqual([1, 0, 0, 1, 25, -200]);
  });
  it("clips edge tiles to the page, and bounds thumbnail memory", () => {
    const plan = planPdfRaster(source, 100, { geometry });
    expect(plan.width).toBeLessThanOrEqual(2400);
    expect(plan.height).toBeLessThanOrEqual(2400);
    expect(plan.width * plan.height).toBeLessThan(4_010_000);
    const edge = planPdfRaster(source, 2, {
      geometry,
      region: { minX: 1000, minY: 0, maxX: 1200, maxY: 256 },
    });
    expect(edge.width).toBe(48);
  });
  it("draws an export's whole page at exactly its scale, past the whole-page bounds", () => {
    const a4 = { width: 1024, height: 1448 };
    const plan = planPdfRaster({ width: 595, height: 842 }, 2, { geometry: a4, exact: true });
    expect(plan.width).toBe(2048);
    expect(plan.height).toBe(2896);
    expect(plan.box).toEqual({ x: 0, y: 0, w: 1024, h: 1448 });
    // Without it, the same page is bounded at 4 MP and drawn softer.
    expect(planPdfRaster({ width: 595, height: 842 }, 2, { geometry: a4 }).width).toBeLessThan(
      1700,
    );
    // Still bounded, as the export itself is.
    const huge = planPdfRaster(source, 40, { geometry, exact: true });
    expect(huge.width * huge.height).toBeLessThanOrEqual(12_010_000);
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(4096);
  });
  it("distinguishes page geometries and visible regions in cache keys", () => {
    const area = { geometry, region: { minX: 0, minY: 0, maxX: 256, maxY: 256 } };
    expect(pdfAreaKey(area)).not.toBe(pdfAreaKey({ geometry }));
    expect(pdfAreaKey(area)).not.toBe(pdfAreaKey({ ...area, region: { ...area.region, minX: 1 } }));
    expect(pdfAreaKey(area)).not.toBe(
      pdfAreaKey({ ...area, geometry: { width: 512, height: 512 } }),
    );
  });
  it("rejects invalid geometry and empty regions before allocating canvas memory", () => {
    expect(() => planPdfRaster(source, 0, { geometry })).toThrow();
    expect(() => planPdfRaster({ width: NaN, height: 800 }, 1, { geometry })).toThrow();
    expect(() =>
      planPdfRaster(source, 1, { geometry, region: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }),
    ).toThrow();
  });
});

describe("page image or detail (FineNotes#80)", () => {
  // The reporter's 7-page A4 study sheet on an iPad (device pixel ratio 2).
  const a4 = { width: 595.28, height: 841.89 };

  it("bounds a whole page at 2400 px a side and 4 MP", () => {
    expect(wholePageScale(a4)).toBeCloseTo(2.825, 3);
    const plan = planPdfRaster(a4, wholePageScale(a4), { geometry: a4 });
    expect(plan.width * plan.height).toBeLessThanOrEqual(4_000_000 * 1.01);
    // A wide page is held to its edge instead.
    expect(wholePageScale({ width: 4800, height: 100 })).toBe(0.5);
    expect(wholePageScale({ width: 0, height: 100 })).toBe(1);
  });

  it("draws the page image at exactly the tiles' level while it fits, never a rounded neighbour", () => {
    // Capture A, zoom 0.68: it was drawn from a 1.25 raster, softening 8 pt text.
    expect(pageRasterScale(a4, 1.36)).toBe(1.36);
    expect(pageRasterScale(a4, 2.8)).toBe(2.8);
    expect(needsDetail(a4, 1.36)).toBe(false);
    expect(needsDetail(a4, 2.8)).toBe(false);
  });

  it("draws the issue's own PDF at max zoom out from a page image at exactly the screen's level", () => {
    // 612 x 576.4 pt pages, imported short side 1024 (pdfPageGeometry): 1087 x 1024.
    const pcos = { width: 1087, height: 1024 };
    expect(wholePageScale(pcos)).toBeCloseTo(1.896, 3);
    // The zoom floor on the reporter's landscape iPad (Capture A) and in portrait.
    for (const level of [1.3601, 1.2786]) {
      expect(pageRasterScale(pcos, level)).toBe(level);
      expect(needsDetail(pcos, level)).toBe(false);
      const plan = planPdfRaster({ width: 612, height: 576.4 }, level, { geometry: pcos });
      // Drawn back at `level`, one raster pixel per device pixel.
      expect((plan.box.w * level) / plan.width).toBeCloseTo(1, 9);
    }
  });

  it("draws detail over the page from where the page image falls short, not from 2.5x zoom", () => {
    // Captures B-D, zoom 1.99 to 2.32 (level 3.98 to 4.64): soft, with no detail.
    for (const level of [2.9, 3.98, 4.33, 4.64, 5.84]) {
      expect(needsDetail(a4, level)).toBe(true);
      expect(pageRasterScale(a4, level)).toBeCloseTo(2.825, 3);
    }
    // A 16:9 slide fits sharper, which is why slides rarely showed it.
    expect(needsDetail({ width: 720, height: 405 }, 3.2)).toBe(false);
    expect(needsDetail(a4, Number.NaN)).toBe(false);
    expect(needsDetail(a4, Infinity)).toBe(false);
  });
});

describe("visible PDF detail policy", () => {
  const visible = { minX: -10, minY: 100, maxX: 200, maxY: 2000 };
  it("uses the whole page while it is sharp enough and clips the actual visible region past it", () => {
    // 1024 x 1365 page px: a whole page is at most 1.69 device px per page px.
    for (const level of [0, 1, 1.69, NaN, Infinity])
      expect(visiblePdfArea(geometry, visible, level)).toBeNull();
    expect(visiblePdfArea(geometry, visible, 1.7)).toEqual({
      geometry,
      region: { minX: 0, minY: 100, maxX: 200, maxY: geometry.height },
    });
  });
  it("does not render gutters, inverted bounds, empty or invalid viewports", () => {
    expect(visiblePdfArea(geometry, { minX: 2000, minY: 0, maxX: 3000, maxY: 100 }, 4)).toBeNull();
    expect(visiblePdfArea(geometry, { minX: 0, minY: 100, maxX: 100, maxY: 0 }, 4)).toBeNull();
    expect(visiblePdfArea(geometry, { ...visible, maxX: Infinity }, 4)).toBeNull();
  });
});

describe("detail margin and coverage", () => {
  const geometry = { width: 1000, height: 1400 };

  it("grows the visible area by DETAIL_MARGIN on each side, kept on the page", () => {
    const visible = { minX: 400, minY: 400, maxX: 600, maxY: 800 };
    expect(detailPdfArea(geometry, visible, 4)?.region).toEqual({
      minX: 400 - 200 * DETAIL_MARGIN,
      minY: 400 - 400 * DETAIL_MARGIN,
      maxX: 600 + 200 * DETAIL_MARGIN,
      maxY: 800 + 400 * DETAIL_MARGIN,
    });
    const corner = detailPdfArea(geometry, { minX: -50, minY: -50, maxX: 150, maxY: 150 }, 4);
    expect(corner?.region).toEqual({
      minX: 0,
      minY: 0,
      maxX: 150 + 150 * DETAIL_MARGIN,
      maxY: 150 + 150 * DETAIL_MARGIN,
    });
  });

  it("lays a patch on whole device pixels, where the ink tiles' pixels are", () => {
    const level = 3.98;
    const area = detailPdfArea(
      geometry,
      { minX: 101.3, minY: 207.7, maxX: 400.1, maxY: 500.9 },
      level,
    );
    const region = area?.region as Bounds;
    for (const edge of [region.minX, region.minY, region.maxX, region.maxY]) {
      expect(Math.abs(edge * level - Math.round(edge * level))).toBeLessThan(1e-6);
    }
    // Out, never in: all of the margin is kept.
    expect(region.minX).toBeLessThanOrEqual(101.3 - 298.8 * DETAIL_MARGIN);
    expect(region.maxY).toBeGreaterThanOrEqual(500.9 + 293.2 * DETAIL_MARGIN);
    const plan = planPdfRaster(
      { width: 600, height: 840 },
      level,
      area as NonNullable<typeof area>,
    );
    expect(Math.abs(plan.box.x * level - Math.round(plan.box.x * level))).toBeLessThan(1e-6);
  });

  it("asks for no detail where the page image is sharp enough, or off the page", () => {
    expect(detailPdfArea(geometry, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 1.69)).toBeNull();
    expect(detailPdfArea(geometry, { minX: 2000, minY: 0, maxX: 2100, maxY: 100 }, 4)).toBeNull();
  });

  it("keeps a margin patch at full resolution on an iPad-sized screen", () => {
    // 2360 x 1640 device px at 6.4 px per page px, plus the margin.
    const w = 2360 / 6.4;
    const h = 1640 / 6.4;
    const area = detailPdfArea(
      geometry,
      { minX: 300, minY: 300, maxX: 300 + w, maxY: 300 + h },
      6.4,
    );
    const plan = planPdfRaster({ width: 600, height: 840 }, 6.4, area as NonNullable<typeof area>);
    expect(plan.width * plan.height).toBeLessThanOrEqual(9_000_000);
    expect(plan.sourceScale / (1000 / 600)).toBeCloseTo(6.4);
  });

  it("caps a huge patch at 9 MP and 4096 px a side", () => {
    const plan = planPdfRaster({ width: 600, height: 840 }, 40, {
      geometry,
      region: { minX: 0, minY: 0, maxX: 1000, maxY: 1400 },
    });
    expect(plan.width * plan.height).toBeLessThanOrEqual(9_000_000 * 1.01);
    expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(4096);
  });

  it("tells covering from meeting", () => {
    const outer = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(boundsCover(outer, { minX: 10, minY: 10, maxX: 100, maxY: 90 })).toBe(true);
    expect(boundsCover(outer, { minX: 10, minY: 10, maxX: 101, maxY: 90 })).toBe(false);
    expect(boundsMeet(outer, { minX: 99, minY: 99, maxX: 200, maxY: 200 })).toBe(true);
    expect(boundsMeet(outer, { minX: 100, minY: 0, maxX: 200, maxY: 100 })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  DETAIL_MARGIN,
  boundsCover,
  boundsMeet,
  detailPdfArea,
  pdfAreaKey,
  planPdfRaster,
  visiblePdfArea,
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

describe("visible PDF detail policy", () => {
  const visible = { minX: -10, minY: 100, maxX: 200, maxY: 2000 };
  it("uses whole pages through 2.5x and clips the actual visible region above it", () => {
    for (const zoom of [0, 1, 2, 2.5, NaN, Infinity])
      expect(visiblePdfArea(geometry, visible, zoom)).toBeNull();
    expect(visiblePdfArea(geometry, visible, 2.501)).toEqual({
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

  it("asks for no detail at or below 2.5x, or off the page", () => {
    expect(detailPdfArea(geometry, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 2.5)).toBeNull();
    expect(detailPdfArea(geometry, { minX: 2000, minY: 0, maxX: 2100, maxY: 100 }, 4)).toBeNull();
  });

  it("keeps a margin patch at full resolution on an iPad-sized screen", () => {
    // 2360 x 1640 device px at 6.4 px per page px, plus the margin.
    const w = 2360 / 6.4;
    const h = 1640 / 6.4;
    const area = detailPdfArea(
      geometry,
      { minX: 300, minY: 300, maxX: 300 + w, maxY: 300 + h },
      4.8,
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

import { describe, expect, it } from "vitest";
import { pdfAreaKey, planPdfRaster } from "../../src/canvas/pdf-raster";

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

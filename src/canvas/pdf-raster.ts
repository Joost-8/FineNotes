/** Geometry for rendering a PDF directly into a bounded page-space patch. Pure. */
import type { Bounds, PageGeometry } from "../model/document";

export interface PdfRenderArea {
  geometry: PageGeometry;
  /** Absent for a whole-page thumbnail; supplied by settled notebook tiles. */
  region?: Bounds;
}

export interface PdfRasterPlan {
  sourceScale: number;
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
  box: { x: number; y: number; w: number; h: number };
}

/** Thumbnails stay bounded; screen tiles never allocate a whole zoomed PDF page. */
const MAX_PATCH_EDGE = 2400;
const MAX_PATCH_PIXELS = 4_000_000;

export function planPdfRaster(
  source: PageGeometry,
  deviceScale: number,
  area: PdfRenderArea,
): PdfRasterPlan {
  const geometry = area.geometry;
  if (
    ![source.width, source.height, geometry.width, geometry.height, deviceScale].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  ) {
    throw new Error("PDF page has no usable size");
  }
  const fit = Math.min(geometry.width / source.width, geometry.height / source.height);
  const region = area.region ?? { minX: 0, minY: 0, maxX: geometry.width, maxY: geometry.height };
  const x = Math.max(0, region.minX);
  const y = Math.max(0, region.minY);
  const w = Math.min(geometry.width, region.maxX) - x;
  const h = Math.min(geometry.height, region.maxY) - y;
  if (!(w > 0 && h > 0 && Number.isFinite(w * h))) throw new Error("PDF patch has no usable size");
  const scale = Math.min(
    deviceScale,
    MAX_PATCH_EDGE / Math.max(w, h),
    Math.sqrt(MAX_PATCH_PIXELS / (w * h)),
  );
  const width = Math.max(1, Math.ceil(w * scale));
  const height = Math.max(1, Math.ceil(h * scale));
  return {
    sourceScale: fit * scale,
    width,
    height,
    transform: [
      1,
      0,
      0,
      1,
      ((geometry.width - source.width * fit) / 2 - x) * scale,
      ((geometry.height - source.height * fit) / 2 - y) * scale,
    ],
    box: { x, y, w: width / scale, h: height / scale },
  };
}

/** Tile scales are already settled and use the renderer's stable precision. */
export function pdfAreaKey(area: PdfRenderArea): string {
  const { geometry, region } = area;
  return JSON.stringify([
    geometry.width,
    geometry.height,
    ...(region ? [region.minX, region.minY, region.maxX, region.maxY] : []),
  ]);
}

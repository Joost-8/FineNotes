/** Geometry for rendering a PDF directly into a bounded page-space patch. Pure. */
import type { Bounds, PageGeometry } from "../model/document";

export interface PdfRenderArea {
  geometry: PageGeometry;
  /** Absent for a whole-page thumbnail; supplied for the visible area of a settled, deeply zoomed page. */
  region?: Bounds;
}

export interface PdfRasterPlan {
  sourceScale: number;
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
  box: { x: number; y: number; w: number; h: number };
}

/** Thumbnails and visible patches stay bounded; never allocate a whole zoomed PDF page. */
const MAX_PATCH_EDGE = 2400;
const MAX_PATCH_PIXELS = 4_000_000;
/**
 * A detail patch: an iPad screen (~3.9 MP) plus `DETAIL_MARGIN` all round,
 * still at full resolution. 4096 a side keeps inside WebKit's canvas limits.
 */
const DETAIL_MAX_PIXELS = 9_000_000;
const DETAIL_MAX_EDGE = 4096;

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
  const detail = area.region !== undefined;
  const scale = Math.min(
    deviceScale,
    (detail ? DETAIL_MAX_EDGE : MAX_PATCH_EDGE) / Math.max(w, h),
    Math.sqrt((detail ? DETAIL_MAX_PIXELS : MAX_PATCH_PIXELS) / (w * h)),
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

/** Whole-page rasters are sufficient at ordinary zoom, independent of device pixel ratio. */
export const PDF_DETAIL_ZOOM = 2.5;

/** The clipped, visible area only; gutters and invalid viewports request nothing. */
export function visiblePdfArea(
  geometry: PageGeometry,
  visible: Bounds,
  zoom: number,
): PdfRenderArea | null {
  if (
    !Number.isFinite(zoom) ||
    zoom <= PDF_DETAIL_ZOOM ||
    ![
      geometry.width,
      geometry.height,
      visible.minX,
      visible.minY,
      visible.maxX,
      visible.maxY,
    ].every(Number.isFinite)
  )
    return null;
  const region = {
    minX: Math.max(0, visible.minX),
    minY: Math.max(0, visible.minY),
    maxX: Math.min(geometry.width, visible.maxX),
    maxY: Math.min(geometry.height, visible.maxY),
  };
  return region.maxX > region.minX && region.maxY > region.minY ? { geometry, region } : null;
}

/**
 * Detail is rendered this far beyond the visible area on each side, as a
 * fraction of its size, so a small move stays sharp without a new render.
 */
export const DETAIL_MARGIN = 0.25;

/** The visible area of a deeply zoomed page plus `DETAIL_MARGIN`, kept on the page. */
export function detailPdfArea(
  geometry: PageGeometry,
  visible: Bounds,
  zoom: number,
): PdfRenderArea | null {
  const shown = visiblePdfArea(geometry, visible, zoom)?.region;
  if (!shown) return null;
  const mx = (shown.maxX - shown.minX) * DETAIL_MARGIN;
  const my = (shown.maxY - shown.minY) * DETAIL_MARGIN;
  return {
    geometry,
    region: {
      minX: Math.max(0, shown.minX - mx),
      minY: Math.max(0, shown.minY - my),
      maxX: Math.min(geometry.width, shown.maxX + mx),
      maxY: Math.min(geometry.height, shown.maxY + my),
    },
  };
}

/** Whether `outer` contains all of `inner`. */
export function boundsCover(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

/** Whether two bounds overlap (touching edges do not count). */
export function boundsMeet(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

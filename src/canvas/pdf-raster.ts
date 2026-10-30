/** Geometry for rendering a PDF directly into a bounded page-space patch. Pure. */
import type { Bounds, PageGeometry } from "../model/document";

export interface PdfRenderArea {
  geometry: PageGeometry;
  /** Absent for a whole page; supplied for detail, the visible area of a page that needs it. */
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

/**
 * The scale (device px per page px) a page's one whole-page raster is drawn
 * at for ink tiles at `level`: `level` itself while a raster that sharp fits
 * the whole-page bounds, else the sharpest one that does, with detail drawn
 * over it ({@link needsDetail}).
 *
 * Exactly `level`, never a rounded neighbour: the raster is resampled into
 * tiles at `level`, and resampling 8 pt text by even 10% either way loses a
 * third of its edge contrast, which reads as blur (FineNotes#80, measured
 * with pdf.js in Chromium: 1.25 drawn at 1.36 kept 57% of the edge energy).
 */
export function pageRasterScale(geometry: PageGeometry, level: number): number {
  return Math.min(level, wholePageScale(geometry));
}

/**
 * The sharpest whole-page raster of a page that stays inside the bounds
 * every whole-page raster keeps to (2400 px a side, 4 MP): 2.82 for A4.
 */
export function wholePageScale(geometry: PageGeometry): number {
  const { width, height } = geometry;
  if (!(width > 0 && height > 0 && Number.isFinite(width * height))) return 1;
  return Math.min(
    MAX_PATCH_EDGE / Math.max(width, height),
    Math.sqrt(MAX_PATCH_PIXELS / (width * height)),
  );
}

/**
 * Whether a page at `level` is drawn sharp from detail (worker tiles, or one
 * patch of the view) over its page image: whenever the page image cannot be
 * that sharp. A fixed zoom (2.5x, until FineNotes#80) left A4 pages on an
 * iPad blurry between about 1.4x and 2.5x, where the image fell short; a
 * slide, larger and with bigger text, rarely showed it.
 */
export function needsDetail(geometry: PageGeometry, level: number): boolean {
  return Number.isFinite(level) && level > wholePageScale(geometry) * (1 + 1e-3);
}

/** The clipped, visible area only; gutters, invalid viewports and pages that need no detail request nothing. */
export function visiblePdfArea(
  geometry: PageGeometry,
  visible: Bounds,
  level: number,
): PdfRenderArea | null {
  if (
    !needsDetail(geometry, level) ||
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

/** The visible area of a page that needs detail, plus `DETAIL_MARGIN`, kept on the page. */
export function detailPdfArea(
  geometry: PageGeometry,
  visible: Bounds,
  level: number,
): PdfRenderArea | null {
  const shown = visiblePdfArea(geometry, visible, level)?.region;
  if (!shown) return null;
  const mx = (shown.maxX - shown.minX) * DETAIL_MARGIN;
  const my = (shown.maxY - shown.minY) * DETAIL_MARGIN;
  // Out to whole device pixels at `level`, where the ink tiles' pixels lie:
  // a patch a fraction of a pixel off them is resampled into them, which
  // left it at 82% of the edge contrast of the PDF drawn there directly.
  const down = (v: number) => Math.floor(v * level) / level;
  const up = (v: number) => Math.ceil(v * level) / level;
  return {
    geometry,
    region: {
      minX: Math.max(0, down(shown.minX - mx)),
      minY: Math.max(0, down(shown.minY - my)),
      maxX: Math.min(geometry.width, up(shown.maxX + mx)),
      maxY: Math.min(geometry.height, up(shown.maxY + my)),
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

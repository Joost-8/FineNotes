/**
 * Where a PDF page has pictures, and what that makes of the page for OCR.
 *
 * Real lecture PDFs are digital pages (a full text layer) with embedded
 * figures whose labels exist only as pixels. This module finds those
 * pictures from the PDF's own drawing operators, rather than guessing from
 * pixels, and decides, for every page, which of five conditions it is in
 * and which parts of it are to be read:
 *
 * - `TEXT_ONLY`: text of its own, no picture worth reading: no OCR at all.
 * - `TEXT_WITH_FIGURES`: text of its own and at least one picture: only the
 *   pictures' areas are read.
 * - `SCANNED`: hardly any text of its own, one picture covering most of the
 *   page (or other ink beside the pictures): the whole page is read.
 * - `NO_TEXT_NO_IMAGE_NOT_BLANK`: no text, no picture, but ink (text drawn as
 *   outlines, say): the whole page is read.
 * - `BLANK`: nothing on it: nothing is read.
 *
 * The geometry is here and pure: the current transformation matrix is
 * followed through save, restore and transform operators, each image is the
 * unit square under it, mapped to the page as pdf.js shows it (y down,
 * rotation applied), clipped to the page, merged with the images touching it
 * (a picture cut into strips is one picture) and filtered by size (icons,
 * logos, bullets and badges are not figures). The pdf.js call itself is in
 * `view/pdf-figures.ts`.
 *
 * Not tracked: clip paths other than the page's edge. A picture cropped by a
 * clip is taken whole; the part clipped away draws as white, so reading it
 * finds nothing.
 *
 * PURE: no DOM, no Obsidian, no pdf.js.
 */

import type { Matrix } from "../../canvas/pdf-text";
import { OCR_DPI, OCR_MAX_EDGE } from "./det";
import { OCR_TUNING, type OcrTuning } from "./ocr-words";

/** Which kind of page this is, for what is read of it. */
export type PageCondition =
  "TEXT_ONLY" | "TEXT_WITH_FIGURES" | "SCANNED" | "NO_TEXT_NO_IMAGE_NOT_BLANK" | "BLANK";

export const PAGE_CONDITIONS: readonly PageCondition[] = [
  "TEXT_ONLY",
  "TEXT_WITH_FIGURES",
  "SCANNED",
  "NO_TEXT_NO_IMAGE_NOT_BLANK",
  "BLANK",
];

/**
 * Bumped when the rules that tell a page's condition change: a page recorded
 * as `TEXT_ONLY` under older rules is looked at again (it costs nothing but
 * a pass over the page's operators).
 */
export const CLASSIFY_VERSION = 1;

/** A rectangle in the page's points as pdf.js shows it at scale 1 (y down). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle to read, and the resolution of the picture inside it, dots per inch (null: not known). */
export interface Region extends Rect {
  dpi: number | null;
  /**
   * A picture over most of the page under text of its own: a slide background,
   * a watermark, a paper texture. It is read only if it has content beyond the
   * page's own text and the other figures (see `hasEdgesOutside`).
   */
  backdrop?: true;
}

/** An image placed on the page: where, and at what resolution it was stored. */
export type PageImage = Region;

/**
 * The drawing operators that matter here, in the order the page runs them.
 * `image` draws the unit square, under `extra` first when given (an
 * operator that repeats an image places each copy with its own matrix).
 */
export type GfxOp =
  | { op: "save" }
  | { op: "restore" }
  | { op: "transform"; m: Matrix }
  | { op: "image"; extra?: Matrix; width?: number; height?: number };

/** pdf.js's operator numbers (`OPS`) for the operators used here; any may be missing in an old build. */
export interface OpCodes {
  save?: number;
  restore?: number;
  transform?: number;
  paintFormXObjectBegin?: number;
  paintFormXObjectEnd?: number;
  paintImageXObject?: number;
  paintInlineImageXObject?: number;
  paintImageXObjectRepeat?: number;
  paintImageMaskXObject?: number;
  paintImageMaskXObjectGroup?: number;
  paintImageMaskXObjectRepeat?: number;
  paintInlineImageXObjectGroup?: number;
  paintJpegXObject?: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a` after `b` (b applied first): the matrix of the two transformations in a row. */
export function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function matrixOf(value: unknown): Matrix | null {
  if (!Array.isArray(value) || value.length < 6) return null;
  const m = value.slice(0, 6) as unknown[];
  return m.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (m as unknown as Matrix)
    : null;
}

function size(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 && Number.isFinite(value) ? value : undefined;
}

/**
 * pdf.js's operator list as {@link GfxOp}s. A form XObject is a saved state
 * with its own matrix, so it becomes save + transform and restore. Images
 * whose operators carry their own placement (groups, repeats) become one
 * `image` per placement.
 */
export function gfxOpsFrom(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  codes: OpCodes,
): GfxOp[] {
  const ops: GfxOp[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    const list = Array.isArray(args) ? (args as unknown[]) : [];
    if (fn === codes.save) ops.push({ op: "save" });
    else if (fn === codes.restore) ops.push({ op: "restore" });
    else if (fn === codes.transform) {
      const m = matrixOf(list);
      if (m) ops.push({ op: "transform", m });
    } else if (fn === codes.paintFormXObjectBegin) {
      ops.push({ op: "save" });
      const m = matrixOf(list[0]);
      if (m) ops.push({ op: "transform", m });
    } else if (fn === codes.paintFormXObjectEnd) ops.push({ op: "restore" });
    else if (fn === codes.paintImageXObject || fn === codes.paintJpegXObject) {
      ops.push({ op: "image", width: size(list[1]), height: size(list[2]) });
    } else if (fn === codes.paintInlineImageXObject || fn === codes.paintImageMaskXObject) {
      const img = (list[0] ?? {}) as { width?: unknown; height?: unknown };
      ops.push({ op: "image", width: size(img.width), height: size(img.height) });
    } else if (fn === codes.paintImageXObjectRepeat) {
      const sx = typeof list[1] === "number" ? list[1] : 1;
      const sy = typeof list[2] === "number" ? list[2] : 1;
      const at = Array.isArray(list[3]) ? (list[3] as unknown[]) : [];
      for (let k = 0; k + 1 < at.length; k += 2) {
        const x = at[k];
        const y = at[k + 1];
        if (typeof x === "number" && typeof y === "number") {
          ops.push({ op: "image", extra: [sx, 0, 0, sy, x, y] });
        }
      }
    } else if (fn === codes.paintImageMaskXObjectRepeat) {
      const [img, sx, skewX, skewY, sy, at] = list as [
        unknown,
        number,
        number,
        number,
        number,
        unknown,
      ];
      const dims = (img ?? {}) as { width?: unknown; height?: unknown };
      const pos = Array.isArray(at) ? (at as unknown[]) : [];
      for (let k = 0; k + 1 < pos.length; k += 2) {
        const x = pos[k];
        const y = pos[k + 1];
        if (typeof x === "number" && typeof y === "number") {
          ops.push({
            op: "image",
            extra: [sx, skewX, skewY, sy, x, y],
            width: size(dims.width),
            height: size(dims.height),
          });
        }
      }
    } else if (fn === codes.paintImageMaskXObjectGroup) {
      for (const img of list[0] && Array.isArray(list[0]) ? (list[0] as unknown[]) : []) {
        const e = (img ?? {}) as { transform?: unknown; width?: unknown; height?: unknown };
        const m = matrixOf(e.transform);
        if (m) ops.push({ op: "image", extra: m, width: size(e.width), height: size(e.height) });
      }
    } else if (fn === codes.paintInlineImageXObjectGroup) {
      const img = (list[0] ?? {}) as { width?: unknown; height?: unknown };
      for (const entry of Array.isArray(list[1]) ? (list[1] as unknown[]) : []) {
        const e = (entry ?? {}) as { transform?: unknown };
        const m = matrixOf(e.transform);
        if (m)
          ops.push({ op: "image", extra: m, width: size(img.width), height: size(img.height) });
      }
    }
  }
  return ops;
}

/** The most images read from one page: a page of thousands of tiles is a pattern, not a figure. */
export const MAX_IMAGES = 1000;

/**
 * Every image the operators draw, as a box in the page (the viewport's space,
 * clipped to `page`, which is `[0, width] x [0, height]`). `viewport` is
 * pdf.js's `getViewport({ scale: 1 }).transform`. An image placed outside the
 * page, or with no area, is left out. Its `dpi` is the pixels it was stored
 * with over the inches it covers (null when the operator did not say).
 */
export function collectImages(
  ops: readonly GfxOp[],
  viewport: Matrix,
  page: { width: number; height: number },
): PageImage[] {
  const out: PageImage[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  for (const op of ops) {
    if (op.op === "save") stack.push(ctm);
    else if (op.op === "restore") ctm = stack.pop() ?? ctm;
    else if (op.op === "transform") ctm = multiplyMatrix(ctm, op.m);
    else {
      if (out.length >= MAX_IMAGES) break;
      const placed = multiplyMatrix(ctm, op.extra ?? IDENTITY);
      const m = multiplyMatrix(viewport, placed);
      // The unit square's corners; a rotated or skewed image is boxed.
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
      const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      if (![...xs, ...ys].every(Number.isFinite)) continue;
      const x0 = Math.max(0, Math.min(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const x1 = Math.min(page.width, Math.max(...xs));
      const y1 = Math.min(page.height, Math.max(...ys));
      if (!(x1 > x0) || !(y1 > y0)) continue;
      // Edge lengths of the whole image (before clipping), in points.
      const wPt = Math.hypot(m[0], m[1]);
      const hPt = Math.hypot(m[2], m[3]);
      let dpi: number | null = null;
      if (op.width !== undefined && wPt > 0) dpi = (op.width / wPt) * 72;
      if (op.height !== undefined && hPt > 0) dpi = Math.max(dpi ?? 0, (op.height / hPt) * 72);
      out.push({ x0, y0, x1, y1, dpi });
    }
  }
  return out;
}

/** The gap between two rectangles along the axis where it is larger (negative: they overlap). */
function gapBetween(a: Rect, b: Rect): number {
  return Math.max(a.x0 - b.x1, b.x0 - a.x1, a.y0 - b.y1, b.y0 - a.y1);
}

/**
 * `images` with those that overlap, or lie within `gap` points of each
 * other, joined into one box (repeatedly, until none are): a picture cut
 * into strips, or a figure of several pieces, is one figure. A merged box
 * keeps the highest resolution of its parts.
 */
export function mergeImages(images: readonly PageImage[], gap: number): PageImage[] {
  let boxes = images.map((i) => ({ ...i }));
  for (;;) {
    let joined = false;
    const next: PageImage[] = [];
    for (const box of boxes) {
      const target = next.find((n) => gapBetween(n, box) <= gap);
      if (target) {
        target.x0 = Math.min(target.x0, box.x0);
        target.y0 = Math.min(target.y0, box.y0);
        target.x1 = Math.max(target.x1, box.x1);
        target.y1 = Math.max(target.y1, box.y1);
        if (box.dpi !== null) target.dpi = Math.max(target.dpi ?? 0, box.dpi);
        joined = true;
      } else next.push(box);
    }
    boxes = next;
    if (!joined) return boxes;
  }
}

/** Whether a box is big enough to be a figure rather than an icon, a logo, a bullet or a badge. */
export function isFigureSized(
  box: Rect,
  page: { width: number; height: number },
  tuning: OcrTuning = OCR_TUNING,
): boolean {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w < tuning.figureMinSide || h < tuning.figureMinSide) return false;
  return (w * h) / (page.width * page.height) >= tuning.figureMinAreaShare;
}

/** What a page's operators say of its pictures. */
export interface FigureScan {
  /** Pictures big enough to read, merged. */
  figures: PageImage[];
  /** Merged pictures too small to be figures (icons, logos, bullets, badges). */
  skipped: PageImage[];
  /** Images drawn on the page before merging (clipped to it). */
  drawn: number;
}

/** The page's pictures from its operators: collected, merged, then split by size. */
export function scanFigures(
  ops: readonly GfxOp[],
  viewport: Matrix,
  page: { width: number; height: number },
  tuning: OcrTuning = OCR_TUNING,
): FigureScan {
  const drawn = collectImages(ops, viewport, page);
  // A backdrop is not merged with the figures on it: they stay readable apart.
  const area = page.width * page.height;
  const isBackdrop = (b: Rect): boolean =>
    area > 0 && ((b.x1 - b.x0) * (b.y1 - b.y0)) / area >= tuning.scannedShare;
  const merged = [
    ...mergeImages(
      drawn.filter((b) => !isBackdrop(b)),
      tuning.figureMergeGap,
    ),
    ...mergeImages(drawn.filter(isBackdrop), tuning.figureMergeGap),
  ];
  return {
    figures: merged.filter((b) => isFigureSized(b, page, tuning)),
    skipped: merged.filter((b) => !isFigureSized(b, page, tuning)),
    drawn: drawn.length,
  };
}

/**
 * `regions` widened by `pad` points (a label sits at the edge of its
 * picture), kept inside the page, and merged again where that made them
 * touch: no area is read twice.
 */
export function padRegions(
  regions: readonly Region[],
  pad: number,
  page: { width: number; height: number },
): Region[] {
  const padded = regions.map((r) => ({
    x0: Math.max(0, r.x0 - pad),
    y0: Math.max(0, r.y0 - pad),
    x1: Math.min(page.width, r.x1 + pad),
    y1: Math.min(page.height, r.y1 + pad),
    dpi: r.dpi,
  }));
  return mergeImages(padded, 0);
}

/**
 * The areas to read for these figures: padded and merged, except a backdrop
 * (a figure over most of the page), which stays whole and apart, flagged.
 */
function regionsOf(
  figures: readonly PageImage[],
  tuning: OcrTuning,
  page: { width: number; height: number },
): Region[] {
  const area = page.width * page.height;
  const isBackdrop = (b: Rect): boolean =>
    area > 0 && ((b.x1 - b.x0) * (b.y1 - b.y0)) / area >= tuning.scannedShare;
  const plain = padRegions(
    figures.filter((f) => !isBackdrop(f)),
    tuning.figurePad,
    page,
  );
  const backdrops = figures.filter(isBackdrop).map((f) => ({ ...f, backdrop: true as const }));
  return [...plain, ...backdrops];
}

/** What a page is, and what is to be read of it. */
export interface PagePlan {
  condition: PageCondition;
  /** The areas to read: the padded figures, or the whole page; none for `TEXT_ONLY`. */
  regions: Region[];
  /**
   * A page with hardly any text of its own and pictures that do not cover
   * most of it: whether anything but the pictures and the text has ink must
   * still be looked at (a raster of the page), and if so the whole page is read.
   */
  checkRest: boolean;
  /** False when the pictures were not looked at (the setting is off, or the operators could not be read). */
  known: boolean;
}

/**
 * The page's condition from what the PDF says of it. `sparse` is
 * {@link isSparse} of its own text; `scan` its pictures, or null when they
 * are not known (then a page is `TEXT_ONLY`, or, if sparse, `SCANNED`: the
 * way pages were read before pictures were looked at).
 *
 * `BLANK` is never returned: only a raster can tell (see {@link settledCondition}).
 */
export function classifyPage(
  sparse: boolean,
  scan: FigureScan | null,
  page: { width: number; height: number },
  tuning: OcrTuning = OCR_TUNING,
): PagePlan {
  const whole: Region[] = [{ x0: 0, y0: 0, x1: page.width, y1: page.height, dpi: null }];
  if (!scan) {
    return sparse
      ? { condition: "SCANNED", regions: whole, checkRest: false, known: false }
      : { condition: "TEXT_ONLY", regions: [], checkRest: false, known: false };
  }
  const regions = regionsOf(scan.figures, tuning, page);
  if (!sparse) {
    return regions.length > 0
      ? { condition: "TEXT_WITH_FIGURES", regions, checkRest: false, known: true }
      : { condition: "TEXT_ONLY", regions: [], checkRest: false, known: true };
  }
  const area = page.width * page.height;
  const biggest = Math.max(0, ...scan.figures.map((f) => (f.x1 - f.x0) * (f.y1 - f.y0)));
  if (area > 0 && biggest / area >= tuning.scannedShare) {
    return { condition: "SCANNED", regions: whole, checkRest: false, known: true };
  }
  if (regions.length > 0) {
    return { condition: "TEXT_WITH_FIGURES", regions, checkRest: true, known: true };
  }
  return { condition: "NO_TEXT_NO_IMAGE_NOT_BLANK", regions: whole, checkRest: false, known: true };
}

/**
 * The condition of a page once the raster has been looked at, for a page
 * read whole: with no ink (beyond its own text) it is `BLANK` when it has
 * no text of its own and `TEXT_ONLY` when it has some (a page number); with
 * ink it keeps the condition it was classified as.
 */
export function settledCondition(
  plan: PagePlan,
  hasNativeText: boolean,
  hasInk: boolean,
): PageCondition {
  if (hasInk) return plan.condition;
  return hasNativeText ? "TEXT_ONLY" : "BLANK";
}

/** How a region is drawn for reading. */
export interface RegionRaster {
  /** Pixels per point. */
  scale: number;
  /** The image's size, px. */
  width: number;
  height: number;
}

/**
 * The raster for a region: about the resolution its picture was stored at,
 * so small labels stay legible, but never below the page rate
 * (`figureMinDpi`) nor above `figureMaxDpi`, and never with a side longer
 * than `figureMaxEdge` px (memory on a phone).
 */
export function regionRaster(region: Region, tuning: OcrTuning = OCR_TUNING): RegionRaster {
  const w = Math.max(1, region.x1 - region.x0);
  const h = Math.max(1, region.y1 - region.y0);
  const dpi = Math.min(tuning.figureMaxDpi, Math.max(tuning.figureMinDpi, region.dpi ?? OCR_DPI));
  const scale = Math.min(dpi / 72, tuning.figureMaxEdge / Math.max(w, h));
  return {
    scale,
    width: Math.max(1, Math.ceil(w * scale)),
    height: Math.max(1, Math.ceil(h * scale)),
  };
}

/** Pixels per point and size for reading the whole page, as pages have always been read. */
export function pageRaster(page: { width: number; height: number }): RegionRaster {
  const longest = Math.max(page.width, page.height);
  const scale = longest > 0 ? Math.min(OCR_DPI / 72, OCR_MAX_EDGE / longest) : OCR_DPI / 72;
  return {
    scale,
    width: Math.max(1, Math.round(page.width * scale)),
    height: Math.max(1, Math.round(page.height * scale)),
  };
}

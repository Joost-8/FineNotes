/**
 * The lasso (0.5): the loop a selection is drawn with, what it picks up, and
 * the geometry of the selection it makes. Pure — no DOM, no canvas, no
 * Obsidian.
 *
 * GoodNotes' lasso is freehand by default, with a rectangular one as an
 * option, and a list of switches for what it includes. Both kinds end as a
 * closed polygon in page space, so one set of hit rules serves both:
 *
 * - a **stroke** is selected when at least half of its length lies inside
 *   (measured at {@link STROKE_SAMPLES} evenly spaced points along it, so a
 *   five-point rectangle is judged by its edges, not by its corners);
 * - an **image** or a **text box** when its centre lies inside, or more than
 *   half of its (rotated) rectangle does.
 *
 * Point-in-polygon is even–odd, so a loop that crosses itself (a figure
 * eight, a lasso that overshoots its start) still means "inside the lines".
 * Everything here is page space; a lasso stays on the page it started on.
 */

import { type Bounds, type Stroke, type TextBoxElement, POINT_STRIDE } from "../model/document";
import type { ImageTransform } from "../model/commands";
import { fromImageLocal, imageBounds, imageCentre } from "./image-geometry";

export interface Pt {
  x: number;
  y: number;
}

/** GoodNotes' two lasso types: drawn freehand (the default), or dragged out as a rectangle. */
export type LassoMode = "freehand" | "rect";

export const LASSO_MODES: readonly LassoMode[] = ["freehand", "rect"];

/** A stored lasso mode, or the default when plugin data holds anything else. */
export function lassoModeOf(raw: unknown): LassoMode {
  return raw === "rect" ? "rect" : "freehand";
}

/**
 * What the lasso picks up. GoodNotes' "What to include in the selection",
 * less the elements this plugin does not have.
 */
export interface LassoFilter {
  /** Freehand ink, highlighter included. */
  handwriting: boolean;
  images: boolean;
  /** Strokes with a `shape` other than an arrow — snapped shapes, presets, table lines. */
  shapes: boolean;
  /** Strokes with `shape: "arrow"`. */
  arrows: boolean;
  textBoxes: boolean;
}

export const LASSO_FILTER_KEYS: readonly (keyof LassoFilter)[] = [
  "handwriting",
  "images",
  "shapes",
  "arrows",
  "textBoxes",
];

/** Everything on, as GoodNotes ships it. */
export const DEFAULT_LASSO_FILTER: Readonly<LassoFilter> = {
  handwriting: true,
  images: true,
  shapes: true,
  arrows: true,
  textBoxes: true,
};

/**
 * A stored filter, sanitised: plugin data may hold anything, and a key that is
 * missing or not a boolean counts as on, so a filter saved by an older build
 * never silently hides a kind of element it did not know about.
 */
export function lassoFilterOf(raw: unknown): LassoFilter {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LASSO_FILTER };
  for (const key of LASSO_FILTER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key) && typeof source[key] === "boolean") {
      out[key] = source[key];
    }
  }
  return out;
}

/** Which lasso switch a stroke answers to. */
export type StrokeKind = "handwriting" | "shape" | "arrow";

export function strokeKind(stroke: Pick<Stroke, "shape">): StrokeKind {
  if (stroke.shape === undefined) return "handwriting";
  return stroke.shape === "arrow" ? "arrow" : "shape";
}

/** Whether the lasso may pick up this stroke at all, before any geometry. */
export function lassoTakesStroke(stroke: Pick<Stroke, "shape">, filter: LassoFilter): boolean {
  switch (strokeKind(stroke)) {
    case "handwriting":
      return filter.handwriting;
    case "arrow":
      return filter.arrows;
    default:
      return filter.shapes;
  }
}

// --- The loop ---------------------------------------------------------------

/** Retained lasso points closer than this to the previous one are dropped, page px. */
export const LASSO_MIN_SPACING = 2;
/** Past this many points the loop is thinned by half, so a long lasso stays cheap. */
export const LASSO_MAX_POINTS = 1024;

/**
 * The loop a freehand lasso has drawn so far, as flat `[x, y, …]` pairs in
 * page space. Points are clamped to the page (a lasso stays on the page it
 * started on) and decimated by distance, and a very long loop is thinned
 * rather than allowed to grow without bound: every pointermove redraws it.
 */
export class LassoPath {
  private pts: number[] = [];
  private spacing: number;

  constructor(
    private readonly page: { width: number; height: number },
    spacing = LASSO_MIN_SPACING,
    private readonly maxPoints = LASSO_MAX_POINTS,
  ) {
    this.spacing = Math.max(0, spacing);
  }

  /** Add a point; returns whether it was kept. */
  add(p: Pt): boolean {
    const x = clamp(p.x, 0, this.page.width);
    const y = clamp(p.y, 0, this.page.height);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const n = this.pts.length;
    if (n >= 2 && Math.hypot(x - this.pts[n - 2], y - this.pts[n - 1]) < this.spacing) {
      return false;
    }
    this.pts.push(x, y);
    if (this.pts.length / 2 > this.maxPoints) this.thin();
    return true;
  }

  /** The loop so far, flat `[x, y, …]`. */
  get points(): readonly number[] {
    return this.pts;
  }

  get count(): number {
    return this.pts.length / 2;
  }

  /** Keep every other point (always the first and the newest) and double the spacing. */
  private thin(): void {
    const kept: number[] = [];
    const last = this.pts.length - 2;
    for (let i = 0; i <= last; i += 4) kept.push(this.pts[i], this.pts[i + 1]);
    if (kept[kept.length - 2] !== this.pts[last] || kept[kept.length - 1] !== this.pts[last + 1]) {
      kept.push(this.pts[last], this.pts[last + 1]);
    }
    this.pts = kept;
    this.spacing = Math.max(this.spacing * 2, LASSO_MIN_SPACING);
  }
}

/**
 * The lasso as it is *drawn*: the loop with its corners rounded off, by
 * Chaikin's corner cutting, `passes` times (each doubles the points). A
 * rough rectangle comes out a rounded one and a wobbly ellipse stays
 * wobbly — the person's own loop, as GoodNotes draws it, never a hull or
 * a box (research/goodnotes-smoothness §8). Display only: what the lasso
 * takes is still decided on the raw loop. Closed: the last point joins the
 * first. Fewer than three points come back as they are.
 */
export function smoothLoop(loop: readonly number[], passes = 2): number[] {
  let pts = loop.slice(0, loop.length - (loop.length % 2));
  if (pts.length < 6) return pts;
  for (let pass = 0; pass < passes; pass++) {
    const out: number[] = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = pts[2 * i];
      const ay = pts[2 * i + 1];
      const j = (i + 1) % n;
      const bx = pts[2 * j];
      const by = pts[2 * j + 1];
      out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by);
      out.push(0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
    }
    pts = out;
  }
  return pts;
}

/** A rectangular lasso from one corner to the other, clamped to the page, as a closed loop. */
export function rectLoop(a: Pt, b: Pt, page: { width: number; height: number }): number[] {
  const x0 = clamp(Math.min(a.x, b.x), 0, page.width);
  const x1 = clamp(Math.max(a.x, b.x), 0, page.width);
  const y0 = clamp(Math.min(a.y, b.y), 0, page.height);
  const y1 = clamp(Math.max(a.y, b.y), 0, page.height);
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

/** A closed polygon, flat `[x, y, …]`, with its bounds for the broad phase. */
export interface Polygon {
  pts: readonly number[];
  bounds: Bounds;
}

/** Wrap a loop for hit-testing; `null` when it has fewer than three vertices. */
export function polygonOf(pts: readonly number[]): Polygon | null {
  const n = pts.length - (pts.length % 2);
  if (n < 6) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  return { pts: pts.slice(0, n), bounds: { minX, minY, maxX, maxY } };
}

/**
 * Even–odd point-in-polygon: count the edges a ray to the right crosses. A
 * self-crossing loop is handled by the same rule, so a region wrapped twice
 * reads as outside, as it does when a fill uses the even–odd rule.
 */
export function pointInPolygon(x: number, y: number, poly: Polygon): boolean {
  const { pts, bounds } = poly;
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return false;
  const n = pts.length;
  let inside = false;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// --- What a lasso selects ---------------------------------------------------

/** How many evenly spaced points along a stroke the half-inside rule reads. */
export const STROKE_SAMPLES = 64;
/** Share of a stroke's length that must lie inside the lasso. */
export const STROKE_SHARE = 0.5;

/**
 * The share of a polyline (`[x, y, p, …]`) that lies inside `poly`, read at
 * the midpoints of `samples` equal pieces of its length. A single point, or a
 * stroke that never moves, is all inside or all outside.
 */
export function strokeShareInside(
  pts: readonly number[],
  poly: Polygon,
  samples = STROKE_SAMPLES,
): number {
  // Whole points only: a ragged array from disk must not be read past its end.
  const usable = pts.length - (pts.length % POINT_STRIDE);
  if (usable === 0) return 0;
  let total = 0;
  for (let i = POINT_STRIDE; i < usable; i += POINT_STRIDE) {
    total += Math.hypot(pts[i] - pts[i - POINT_STRIDE], pts[i + 1] - pts[i + 1 - POINT_STRIDE]);
  }
  if (!(total > 0)) return pointInPolygon(pts[0], pts[1], poly) ? 1 : 0;

  const n = Math.max(1, Math.floor(samples));
  let inside = 0;
  let seg = POINT_STRIDE;
  let walked = 0;
  let segLength = Math.hypot(pts[seg] - pts[0], pts[seg + 1] - pts[1]);
  for (let k = 0; k < n; k++) {
    const target = ((k + 0.5) / n) * total;
    // Advance to the segment holding `target`.
    while (walked + segLength < target && seg + POINT_STRIDE < usable) {
      walked += segLength;
      seg += POINT_STRIDE;
      segLength = Math.hypot(
        pts[seg] - pts[seg - POINT_STRIDE],
        pts[seg + 1] - pts[seg + 1 - POINT_STRIDE],
      );
    }
    const t = segLength > 0 ? Math.min(1, (target - walked) / segLength) : 0;
    const ax = pts[seg - POINT_STRIDE];
    const ay = pts[seg + 1 - POINT_STRIDE];
    const x = ax + (pts[seg] - ax) * t;
    const y = ay + (pts[seg + 1] - ay) * t;
    if (pointInPolygon(x, y, poly)) inside++;
  }
  return inside / n;
}

/** The lasso's rule for a stroke: at least half of its length inside. */
export function strokeInLasso(stroke: Pick<Stroke, "pts">, poly: Polygon): boolean {
  return strokeShareInside(stroke.pts, poly) >= STROKE_SHARE;
}

/** Grid the rectangle rule reads, per side. */
const BOX_GRID = 5;

/**
 * The lasso's rule for a rectangle — an image (possibly rotated) or a text
 * box's frame: its centre inside, or more than half of it (read on a 5 × 5
 * grid of cell centres in its own frame).
 */
export function boxInLasso(box: ImageTransform, poly: Polygon): boolean {
  if (!(box.w > 0) || !(box.h > 0)) return false;
  const centre = imageCentre(box);
  if (pointInPolygon(centre.x, centre.y, poly)) return true;
  const b = imageBounds(box);
  if (
    b.maxX < poly.bounds.minX ||
    b.minX > poly.bounds.maxX ||
    b.maxY < poly.bounds.minY ||
    b.minY > poly.bounds.maxY
  ) {
    return false;
  }
  let inside = 0;
  for (let i = 0; i < BOX_GRID; i++) {
    for (let j = 0; j < BOX_GRID; j++) {
      const p = fromImageLocal(box, {
        x: ((i + 0.5) / BOX_GRID - 0.5) * box.w,
        y: ((j + 0.5) / BOX_GRID - 0.5) * box.h,
      });
      if (pointInPolygon(p.x, p.y, poly)) inside++;
    }
  }
  return inside * 2 > BOX_GRID * BOX_GRID;
}

// --- The selection's geometry -----------------------------------------------

/** A text box's frame with a height: auto-height boxes are measured by the view. */
export interface BoxFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bounds of everything selected, in page space: strokes as their ink reaches
 * (half the nib past the centreline), images as their rotated rectangles
 * cover, text boxes by their frames. `null` when there is nothing.
 */
export function selectionBounds(
  strokes: readonly Pick<Stroke, "pts" | "size">[],
  images: readonly ImageTransform[],
  frames: readonly BoxFrame[],
): Bounds | null {
  let acc: Bounds | null = null;
  const grow = (b: Bounds): void => {
    acc = acc
      ? {
          minX: Math.min(acc.minX, b.minX),
          minY: Math.min(acc.minY, b.minY),
          maxX: Math.max(acc.maxX, b.maxX),
          maxY: Math.max(acc.maxY, b.maxY),
        }
      : b;
  };
  for (const stroke of strokes) {
    const b = pointsBounds(stroke.pts);
    if (!b) continue;
    const pad = Math.max(0, stroke.size) / 2;
    grow({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad });
  }
  for (const image of images) grow(imageBounds(image));
  for (const f of frames) grow({ minX: f.x, minY: f.y, maxX: f.x + f.w, maxY: f.y + f.h });
  return acc;
}

/** Bounds of a stroke's whole points, or `null` when it has none. */
function pointsBounds(pts: readonly number[]): Bounds | null {
  const usable = pts.length - (pts.length % POINT_STRIDE);
  if (usable === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Clamp a move of the whole selection so its centre stays on the page — as
 * `moveImage` does for one picture: it may hang off the edge, as ink may, but
 * never so far that nothing is left to grab. A selection whose centre is
 * already off the page may stay where it is, but not go further out.
 */
export function clampGroupDelta(
  bounds: Bounds,
  dx: number,
  dy: number,
  page: { width: number; height: number },
): { dx: number; dy: number } {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const x = clamp(cx + dx, Math.min(0, cx), Math.max(page.width, cx));
  const y = clamp(cy + dy, Math.min(0, cy), Math.max(page.height, cy));
  return { dx: x - cx, dy: y - cy };
}

/** A text box's frame, given the height the view measured for an auto-height one. */
export function textBoxFrame(box: TextBoxElement, measuredHeight: number): BoxFrame {
  return { x: box.x, y: box.y, w: box.w, h: box.h ?? Math.max(0, measuredHeight) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

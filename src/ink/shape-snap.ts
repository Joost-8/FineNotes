/**
 * Snapping to other shapes (FineNotes discussion #51): while a shape is
 * drawn, its ends and corners land on the corners, ends and midpoints of
 * the shapes already on the page when they come within a few screen px.
 *
 * Built to run on every pointer move on a page of hundreds of shapes:
 *
 * - **Candidates come from the spatial index**, a square of the snap radius
 *   around the pen — never a scan of the page (`SnapSource`).
 * - **Targets are computed once per points array** and kept in a
 *   `WeakMap` keyed on it. Every command gives a stroke a fresh array
 *   (CLAUDE.md "A stroke's end points cannot see a turn"), so an edited
 *   shape is read again and a dropped one is collected.
 * - **No allocation per query**: the search keeps its state in fields and
 *   visits candidates through one callback made with the snapper, and its
 *   answer is written into {@link ShapeSnapper.hit}.
 *
 * What a shape offers, read off its points rather than its kind's layout
 * (contracts/api.md §2: an erased piece keeps its kind, not its layout):
 *
 * - A polygonal shape or piece (no more than {@link MAX_CORNERS} distinct
 *   vertices: lines, rectangles, triangles, diamonds, polygons, stars, and
 *   what the eraser left of them): every vertex, and the middle of every
 *   side.
 * - A whole arrow: its tail, its tip and the middle of its shaft — not the
 *   barbs.
 * - A circle or an ellipse: its centre, and its leftmost, rightmost, top and
 *   bottom points (the ends of its axes when it is level).
 * - A rounded rectangle or a cloud: its centre. Any other curved piece: its
 *   two ends.
 * - Handwriting: nothing.
 *
 * PURE: no DOM.
 */

import { POINT_STRIDE, type ShapeKind, type Stroke } from "../model/document";

/** More distinct vertices than a star's ten is a curve's samples, not corners. */
export const MAX_CORNERS = 12;

/** Snap within this many screen px of a target (callers divide by the zoom). */
export const SNAP_RADIUS_PX = 12;

/**
 * Visit every stroke that may lie within `reach` of (`x`, `y`), more than
 * once if it likes; the snapper measures each. A spatial-index query, not a
 * scan (`StrokeIndex.forEachNear`).
 */
export type SnapSource = (
  x: number,
  y: number,
  reach: number,
  visit: (stroke: Stroke) => void,
) => void;

const NO_TARGETS = new Float64Array(0);

/** Snap targets per points array: computed on first sight, dropped with the array. */
const cache = new WeakMap<readonly number[], Float64Array>();

/** The points a stroke offers to snap to, `x, y, x, y, …`, page px. */
export function snapTargets(stroke: Pick<Stroke, "shape" | "pts">): Float64Array {
  if (stroke.shape === undefined) return NO_TARGETS;
  let targets = cache.get(stroke.pts);
  if (!targets) {
    targets = targetsOf(stroke.shape, stroke.pts);
    cache.set(stroke.pts, targets);
  }
  return targets;
}

function targetsOf(kind: ShapeKind, pts: readonly number[]): Float64Array {
  const S = POINT_STRIDE;
  const n = Math.floor(pts.length / S);
  if (n === 0) return NO_TARGETS;
  if (kind === "arrow" && isWholeArrow(pts)) {
    return Float64Array.of(
      pts[0],
      pts[1],
      pts[S],
      pts[S + 1],
      (pts[0] + pts[S]) / 2,
      (pts[1] + pts[S + 1]) / 2,
    );
  }
  const closed = n > 2 && pts[0] === pts[(n - 1) * S] && pts[1] === pts[(n - 1) * S + 1];
  const distinct = closed ? n - 1 : n;
  const curved =
    kind === "circle" || kind === "ellipse" || kind === "roundrect" || kind === "cloud";
  if (!curved && distinct <= MAX_CORNERS) {
    // Every vertex, then the middle of every side (a closed outline's last
    // side runs back to its first vertex).
    const sides = closed ? distinct : distinct - 1;
    const out = new Float64Array(2 * (distinct + sides));
    for (let i = 0; i < distinct; i++) {
      out[2 * i] = pts[i * S];
      out[2 * i + 1] = pts[i * S + 1];
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % distinct;
      out[2 * (distinct + i)] = (pts[i * S] + pts[j * S]) / 2;
      out[2 * (distinct + i) + 1] = (pts[i * S + 1] + pts[j * S + 1]) / 2;
    }
    return out;
  }
  if (!closed) {
    // A curved piece (or a long polyline): where it starts and ends.
    return Float64Array.of(pts[0], pts[1], pts[(n - 1) * S], pts[(n - 1) * S + 1]);
  }
  // A closed curve: its centre, and for circles and ellipses the points
  // furthest left, right, up and down.
  let cx = 0;
  let cy = 0;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (let i = 0; i < distinct; i++) {
    const x = pts[i * S];
    const y = pts[i * S + 1];
    cx += x;
    cy += y;
    if (x < pts[left * S]) left = i;
    if (x > pts[right * S]) right = i;
    if (y < pts[top * S + 1]) top = i;
    if (y > pts[bottom * S + 1]) bottom = i;
  }
  cx /= distinct;
  cy /= distinct;
  if (kind !== "circle" && kind !== "ellipse") return Float64Array.of(cx, cy);
  const out = new Float64Array(10);
  out[0] = cx;
  out[1] = cy;
  [left, right, top, bottom].forEach((i, k) => {
    out[2 + 2 * k] = pts[i * S];
    out[3 + 2 * k] = pts[i * S + 1];
  });
  return out;
}

/** A whole arrow, checked: `[tail, tip, tip, barb, tip, barb]` with a shaft. */
function isWholeArrow(pts: readonly number[]): boolean {
  const S = POINT_STRIDE;
  if (pts.length !== 6 * S) return false;
  const same = (i: number, j: number): boolean =>
    pts[i * S] === pts[j * S] && pts[i * S + 1] === pts[j * S + 1];
  return same(1, 2) && same(1, 4) && !same(0, 1);
}

/**
 * Finds the snap target nearest a point. One per surface; reused for every
 * query, so a query allocates nothing.
 */
export class ShapeSnapper {
  /** The last query's answer: where it snapped to, when `snapped`. */
  readonly hit = { snapped: false, x: 0, y: 0 };
  /** A stroke whose own targets are left out (the shape being edited), if any. */
  exclude: Stroke | null = null;
  /** Strokes measured by the last query, for the performance tests. */
  visited = 0;

  private qx = 0;
  private qy = 0;
  private best = 0;

  constructor(private readonly source: SnapSource) {}

  /**
   * Snap (`x`, `y`) to the nearest target within `radius` page px. True when
   * it snapped; {@link hit} then holds the target.
   */
  snap(x: number, y: number, radius: number): boolean {
    const hit = this.hit;
    hit.snapped = false;
    this.visited = 0;
    if (!(radius > 0) || !Number.isFinite(x + y)) return false;
    this.qx = x;
    this.qy = y;
    this.best = radius * radius;
    this.source(x, y, radius, this.visit);
    return hit.snapped;
  }

  private readonly visit = (stroke: Stroke): void => {
    if (stroke === this.exclude || stroke.shape === undefined) return;
    this.visited++;
    const targets = snapTargets(stroke);
    const hit = this.hit;
    for (let i = 0; i + 1 < targets.length; i += 2) {
      const dx = targets[i] - this.qx;
      const dy = targets[i + 1] - this.qy;
      const d = dx * dx + dy * dy;
      if (d <= this.best) {
        this.best = d;
        hit.snapped = true;
        hit.x = targets[i];
        hit.y = targets[i + 1];
      }
    }
  };
}

/**
 * Where the pen must be for a shape held at `from` (and being turned and
 * scaled about `pivot` to follow the pen, `transformShape`) to carry its
 * point `v0` onto `target`. The transform takes `v0 - pivot` to
 * `(v0 - pivot) · (to - pivot) / (from - pivot)` as complex numbers, so the
 * pen position is solved exactly. `null` when `v0` sits on the pivot.
 */
export function penForPoint(
  pivot: { x: number; y: number },
  from: { x: number; y: number },
  v0: { x: number; y: number },
  target: { x: number; y: number },
): { x: number; y: number } | null {
  // to - pivot = (target - pivot) · (from - pivot) / (v0 - pivot)
  const ax = target.x - pivot.x;
  const ay = target.y - pivot.y;
  const bx = from.x - pivot.x;
  const by = from.y - pivot.y;
  const cx = v0.x - pivot.x;
  const cy = v0.y - pivot.y;
  const c2 = cx * cx + cy * cy;
  if (!(c2 > 1e-9)) return null;
  // (a · b) / c, complex.
  const px = ax * bx - ay * by;
  const py = ax * by + ay * bx;
  return {
    x: pivot.x + (px * cx + py * cy) / c2,
    y: pivot.y + (py * cx - px * cy) / c2,
  };
}

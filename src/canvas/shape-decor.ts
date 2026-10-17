/**
 * The geometry of a shape's style (`model/shape-style`): rounded corners,
 * arrowheads and dash patterns. The renderer turns it into canvas paths, the
 * same for the page, thumbnails, the AI page render and PDF export.
 *
 * Pure: no DOM, no canvas. Outlines are lists of path operations, so they
 * can be tested by their numbers.
 */

import { POINT_STRIDE, type ArrowHead, type ShapeDash } from "../model/document";

export interface Pt {
  x: number;
  y: number;
}

/** A path operation, as `Path2D` takes it: move, line, `arcTo`, close. */
export type OutlineOp =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "A"; x1: number; y1: number; x2: number; y2: number; r: number }
  | { op: "Z" };

/** The points of a flat `[x, y, p, …]` array, whole points only. */
export function pointsOf(pts: readonly number[]): Pt[] {
  const out: Pt[] = [];
  const usable = pts.length - (pts.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

/** Drop points that repeat the one before (they have no direction). */
function distinct(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push(p);
  }
  return out;
}

/**
 * The radius a corner at `at`, between edges to `prev` and `next`, can take:
 * at most `radius`, and small enough that the curve leaves each edge no
 * further than halfway along it, so two rounded corners never overlap.
 */
export function cornerRadius(prev: Pt, at: Pt, next: Pt, radius: number): number {
  const ax = prev.x - at.x;
  const ay = prev.y - at.y;
  const bx = next.x - at.x;
  const by = next.y - at.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (!(la > 0) || !(lb > 0) || !(radius > 0)) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  // The angle between the two edges at the corner; π is a straight run.
  const angle = Math.acos(cos);
  if (angle < 1e-3 || Math.PI - angle < 1e-3) return 0;
  const tanHalf = Math.tan(angle / 2);
  // How far from the corner the curve meets each edge, for this radius.
  const reach = Math.min(radius / tanHalf, la / 2, lb / 2);
  return reach * tanHalf;
}

/**
 * A shape's outline with its corners rounded by `radius` (page px). A closed
 * loop (first point repeated last) rounds every corner, the seam included;
 * an open one keeps its two ends sharp. A radius of 0 gives the polyline.
 */
export function outlineOps(pts: readonly number[], radius: number, closed: boolean): OutlineOp[] {
  let points = distinct(pointsOf(pts));
  if (closed && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.5) points = points.slice(0, -1);
  }
  const n = points.length;
  if (n === 0) return [];
  if (n === 1 || !(radius > 0)) {
    const ops: OutlineOp[] = points.map((p, i) => ({ op: i === 0 ? "M" : "L", x: p.x, y: p.y }));
    if (closed && n > 2) ops.push({ op: "Z" });
    return ops;
  }
  const ops: OutlineOp[] = [];
  if (closed && n > 2) {
    // Start halfway along the last edge, so the first corner is rounded too.
    const a = points[n - 1];
    const b = points[0];
    ops.push({ op: "M", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const at = points[i];
      const next = points[(i + 1) % n];
      ops.push(arcOp(prev, at, next, radius));
    }
    ops.push({ op: "Z" });
    return ops;
  }
  ops.push({ op: "M", x: points[0].x, y: points[0].y });
  for (let i = 1; i < n - 1; i++) ops.push(arcOp(points[i - 1], points[i], points[i + 1], radius));
  ops.push({ op: "L", x: points[n - 1].x, y: points[n - 1].y });
  return ops;
}

function arcOp(prev: Pt, at: Pt, next: Pt, radius: number): OutlineOp {
  const r = cornerRadius(prev, at, next, radius);
  if (r <= 0) return { op: "L", x: at.x, y: at.y };
  return { op: "A", x1: at.x, y1: at.y, x2: next.x, y2: next.y, r };
}

/** Longest arrowhead side, page px: kept inside the ink padding tiles redraw by. */
export const HEAD_MAX = 30;
const HEAD_MIN = 10;
const HEAD_FRACTION = 0.18;
const HEAD_ANGLE = (30 * Math.PI) / 180;

/** An arrowhead on the end at `tip` of a line coming from `from`. */
export interface HeadGeometry {
  /** For an open head the V, barb–tip–barb; for a filled one the triangle. */
  points: Pt[];
  filled: boolean;
  /**
   * Where the line should stop: the tip for an open head, the middle of the
   * triangle's base for a filled one, so the line's round cap does not show
   * through the point.
   */
  stop: Pt;
}

/**
 * The head a line of `width` (page px) and `span` long gets at `tip`: its
 * sides grow with the line and the pen, between {@link HEAD_MIN} and
 * {@link HEAD_MAX}, and never past 45 % of the line.
 */
export function arrowHead(
  from: Pt,
  tip: Pt,
  width: number,
  head: ArrowHead,
  span: number,
): HeadGeometry | null {
  const dx = from.x - tip.x;
  const dy = from.y - tip.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !(span > 0)) return null;
  const side = Math.min(
    span * 0.45,
    Math.min(HEAD_MAX, Math.max(HEAD_MIN, HEAD_FRACTION * span, 3 * width)),
  );
  const ux = dx / len;
  const uy = dy / len;
  const barb = (sign: number): Pt => {
    const c = Math.cos(sign * HEAD_ANGLE);
    const s = Math.sin(sign * HEAD_ANGLE);
    return { x: tip.x + side * (ux * c - uy * s), y: tip.y + side * (ux * s + uy * c) };
  };
  const a = barb(1);
  const b = barb(-1);
  if (head === "open") return { points: [a, { ...tip }, b], filled: false, stop: { ...tip } };
  return {
    points: [{ ...tip }, a, b],
    filled: true,
    stop: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/**
 * The canvas dash pattern for a line `width` wide drawn with round caps: a
 * cap adds half the width at each end of a dash, so the stored lengths are
 * what is left after the caps. Dots are zero-length dashes, which round caps
 * draw as discs.
 */
export function dashPattern(dash: ShapeDash, width: number): number[] {
  const w = Math.max(0.5, width);
  return dash === "dot" ? [0, 2.2 * w] : [2 * w, 3 * w];
}
